import type {
  Rect,
  RuntimeWindowId
} from "@tessera/protocol";
import {
  solveMasterStack,
  solveBalancedGrid,
  solveLayout,
  solveTree,
  insertWindow
} from "@tessera/layout-core";
import type {
  WindowRuleInput,
  WindowClassificationResult
} from "@tessera/rules-engine";
import {
  type RetainedWindowState,
  type RetainedScreenState,
  type GeometryOperation,
  type ReconciliationTransaction,
  type CoordinatorConfig,
  type CoordinatorDiagnostics,
  type NormalizedWindowInput,
  type NormalizedScreenInput,
  type NormalizedEvent,
  type Clock,
  SystemClock,
  DEFAULT_GEOMETRY_TOLERANCE_PX,
  DEFAULT_ECHO_EXPIRY_MS,
  rectEqualsWithTolerance
} from "./coordinator-types.js";
import { getOrCreateRuleEngine } from "./qml-rules-compat.js";
import { resolveScreenAffinity } from "./screen-affinity.js";
import { TraceRecorder } from "./trace-recorder.js";

interface InFlightEcho {
  readonly target: Rect;
  readonly epoch: number;
  readonly timestamp: number;
}

export class RuntimeCoordinator {
  private readonly windows = new Map<RuntimeWindowId, RetainedWindowState>();
  private readonly screens = new Map<string, RetainedScreenState>();
  private readonly inFlightEchoes = new Map<RuntimeWindowId, InFlightEcho>();
  private readonly dirtyScreenIds = new Set<string>();
  private readonly pendingReasons = new Set<string>();
  private readonly clock: Clock;
  private readonly traceRecorder: TraceRecorder;

  private config: CoordinatorConfig;
  private currentEpoch = 0;

  // Diagnostics counters
  private totalNormalizedEvents = 0;
  private totalReconciliationTransactions = 0;
  private totalLayoutComputations = 0;
  private totalGeometryWrites = 0;
  private skippedIdenticalWrites = 0;
  private suppressedGeometryEchoes = 0;
  private lastTransactionReasons: string[] = [];
  private lastAffectedScreenIds: string[] = [];

  constructor(
    initialConfig?: Partial<CoordinatorConfig>,
    clock: Clock = new SystemClock(),
    traceRecorder: TraceRecorder = new TraceRecorder()
  ) {
    this.clock = clock;
    this.traceRecorder = traceRecorder;
    this.config = {
      enableTiling: initialConfig?.enableTiling ?? true,
      defaultLayout: initialConfig?.defaultLayout ?? "master-stack",
      gapInner: initialConfig?.gapInner ?? 8,
      gapOuter: initialConfig?.gapOuter ?? 10,
      masterRatio: initialConfig?.masterRatio ?? 0.50,
      masterCount: initialConfig?.masterCount ?? 1,
      ignoreMinimized: initialConfig?.ignoreMinimized ?? true,
      gameWindowPolicy: initialConfig?.gameWindowPolicy ?? "floating",
      floatFilter: initialConfig?.floatFilter ?? "tessera,tessera-settings,tessera_settings.py",
      customRules: initialConfig?.customRules ?? "[]",
      customGamePatterns: initialConfig?.customGamePatterns ?? [],
      geometryTolerancePx: initialConfig?.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX,
      echoExpiryMs: initialConfig?.echoExpiryMs ?? DEFAULT_ECHO_EXPIRY_MS
    };
  }

  public getConfig(): CoordinatorConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<CoordinatorConfig>): void {
    this.config = { ...this.config, ...updates };
    this.invalidateAllScreens("GlobalConfigChanged");
  }

  public getRetainedWindow(id: RuntimeWindowId): RetainedWindowState | undefined {
    return this.windows.get(id);
  }

  public getRetainedWindows(): readonly RetainedWindowState[] {
    return Array.from(this.windows.values());
  }

  public getRetainedScreen(outputId: string): RetainedScreenState | undefined {
    return this.screens.get(outputId);
  }

  public getRetainedScreens(): readonly RetainedScreenState[] {
    return Array.from(this.screens.values());
  }

  public getOrCreateScreen(input: NormalizedScreenInput): RetainedScreenState {
    let screen = this.screens.get(input.outputId);
    if (!screen) {
      screen = {
        outputId: input.outputId,
        name: input.name || input.outputId,
        geometry: { ...input.geometry },
        usableArea: { ...input.usableArea },
        activeDesktopId: input.activeDesktopId || "1",
        activeActivityId: input.activeActivityId,
        activeLayout: this.config.defaultLayout,
        masterCount: this.config.masterCount,
        masterRatio: this.config.masterRatio,
        gaps: { inner: this.config.gapInner, outer: this.config.gapOuter },
        orderedWindowIds: [],
        persistentOrder: [],
        dirtyReasons: new Set(),
        latestCommittedEpoch: 0
      };
      this.screens.set(input.outputId, screen);
    } else {
      if (input.name) screen.name = input.name;
      screen.geometry = { ...input.geometry };
      screen.usableArea = { ...input.usableArea };
      if (input.activeDesktopId) screen.activeDesktopId = input.activeDesktopId;
      if (input.activeActivityId) screen.activeActivityId = input.activeActivityId;
    }
    return screen;
  }

  public markScreenDirty(outputId: string, reason: string): void {
    const screen = this.screens.get(outputId);
    if (screen) {
      screen.dirtyReasons.add(reason);
      this.dirtyScreenIds.add(outputId);
    }
    this.pendingReasons.add(reason);
  }

  public invalidateAllScreens(reason: string): void {
    for (const screen of this.screens.values()) {
      screen.dirtyReasons.add(reason);
      this.dirtyScreenIds.add(screen.outputId);
    }
    this.pendingReasons.add(reason);
  }

  private classifyWindow(input: NormalizedWindowInput, screen?: RetainedScreenState): WindowClassificationResult {
    const ruleInput: WindowRuleInput = {
      windowId: input.id,
      resourceClass: input.resourceClass,
      resourceName: input.resourceName,
      appId: input.appId,
      desktopFileName: input.desktopFileName,
      title: input.title,
      caption: input.title,
      windowRole: input.role,
      role: input.role,
      managed: input.managed !== undefined ? input.managed : true,
      normalWindow: input.normalWindow !== undefined ? input.normalWindow : true,
      dialog: Boolean(input.dialog),
      transient: Boolean(input.transient),
      fullScreen: Boolean(input.fullScreen),
      noBorder: Boolean(input.noBorder),
      maximizeMode: input.maximizeMode ?? 0,
      minimized: Boolean(input.minimized),
      frameGeometry: input.frameGeometry,
      outputGeometry: input.outputGeometry || screen?.geometry,
      outputUsableArea: input.outputUsableArea || screen?.usableArea,
      desktopWindow: Boolean(input.desktopWindow),
      dock: Boolean(input.dock),
      splash: Boolean(input.splash),
      notification: Boolean(input.notification),
      onScreenDisplay: Boolean(input.onScreenDisplay),
      popupMenu: Boolean(input.popupMenu),
      tooltip: Boolean(input.tooltip),
      specialWindow: Boolean(input.specialWindow)
    };

    const engine = getOrCreateRuleEngine({
      gameWindowPolicy: this.config.gameWindowPolicy,
      userFilterString: this.config.floatFilter,
      customRules: this.config.customRules,
      customGamePatterns: this.config.customGamePatterns
    });

    return engine.classify(ruleInput);
  }

  /**
   * Primary event ingestion entrypoint. Normalizes and updates state.
   */
  public ingestEvent(event: NormalizedEvent): { dirty: boolean; affectedScreens: string[]; isEcho: boolean } {
    this.totalNormalizedEvents++;
    this.traceRecorder.recordEvent(event, this.clock.now());

    switch (event.type) {
      case "WindowDiscovered": {
        const winInput = event.window;
        let outputId = winInput.outputId || "default";

        // If screen not known or no outputId given, resolve screen affinity
        if (!this.screens.has(outputId) && this.screens.size > 0) {
          const screensList = Array.from(this.screens.values()).map(s => ({
            outputId: s.outputId,
            name: s.name,
            geometry: s.geometry,
            usableArea: s.usableArea
          }));
          outputId = resolveScreenAffinity({
            explicitOutputId: winInput.outputId,
            frameGeometry: winInput.frameGeometry,
            previousOutputId: winInput.outputAffinity,
            screens: screensList
          });
        }

        const screen = this.screens.get(outputId);
        const classification = this.classifyWindow(winInput, screen);
        const tileable = classification.classification === "tiled";
        const geom = winInput.frameGeometry || { x: 0, y: 0, width: 800, height: 600 };

        const retained: RetainedWindowState = {
          id: winInput.id,
          resourceClass: winInput.resourceClass || "",
          resourceName: winInput.resourceName || "",
          appId: winInput.appId || "",
          desktopFileName: winInput.desktopFileName || "",
          title: winInput.title || "",
          role: winInput.role || "",
          outputId,
          desktopId: winInput.desktopId || "1",
          activityId: winInput.activityId,
          minimized: Boolean(winInput.minimized),
          fullScreen: Boolean(winInput.fullScreen),
          noBorder: Boolean(winInput.noBorder),
          maximizeMode: winInput.maximizeMode ?? 0,
          frameGeometry: { ...geom },
          outputGeometry: winInput.outputGeometry,
          classification: classification.classification,
          tileable,
          isManualFloating: Boolean(winInput.isManualFloating),
          isDragging: Boolean(winInput.isDragging),
          lastObservedGeometry: { ...geom },
          lastRequestedGeometry: null,
          lastAppliedTransactionEpoch: 0,
          currentDesiredTiledGeometry: null,
          preMinimizeGeometry: null,
          isPreTiled: Boolean(winInput.isPreTiled),
          outputAffinity: winInput.outputAffinity || outputId
        };

        this.windows.set(winInput.id, retained);

        // Update screen ordering
        if (screen) {
          if (!screen.persistentOrder.includes(winInput.id)) {
            screen.persistentOrder.push(winInput.id);
          }
        }

        this.markScreenDirty(outputId, "WindowDiscovered");
        return { dirty: true, affectedScreens: [outputId], isEcho: false };
      }

      case "WindowRemoved": {
        const retained = this.windows.get(event.windowId);
        const outputId = retained ? retained.outputId : undefined;
        this.windows.delete(event.windowId);
        this.inFlightEchoes.delete(event.windowId);

        // Remove from all screens' persistent and ordered lists
        const affected: string[] = [];
        for (const screen of this.screens.values()) {
          const idx = screen.persistentOrder.indexOf(event.windowId);
          if (idx !== -1) {
            screen.persistentOrder.splice(idx, 1);
            screen.dirtyReasons.add("WindowRemoved");
            this.dirtyScreenIds.add(screen.outputId);
            affected.push(screen.outputId);
          }
          const oIdx = screen.orderedWindowIds.indexOf(event.windowId);
          if (oIdx !== -1) {
            screen.orderedWindowIds.splice(oIdx, 1);
          }
        }

        if (outputId && !affected.includes(outputId)) {
          this.markScreenDirty(outputId, "WindowRemoved");
          affected.push(outputId);
        }

        this.pendingReasons.add("WindowRemoved");
        return { dirty: affected.length > 0, affectedScreens: affected, isEcho: false };
      }

      case "WindowGeometryChanged": {
        const echoCheck = this.checkAndHandleEcho(event.windowId, event.geometry, event.timestamp);
        if (echoCheck.isEcho) {
          return { dirty: false, affectedScreens: [], isEcho: true };
        }

        const win = this.windows.get(event.windowId);
        if (!win) {
          return { dirty: false, affectedScreens: [], isEcho: false };
        }

        win.lastObservedGeometry = { ...event.geometry };
        win.frameGeometry = { ...event.geometry };

        // Check if geometry change alters borderless / fullscreen-like classification
        const screen = this.screens.get(win.outputId);
        const prevTileable = win.tileable;
        const prevClass = win.classification;
        const newClassResult = this.classifyWindow({
          id: win.id,
          resourceClass: win.resourceClass,
          title: win.title,
          noBorder: win.noBorder,
          maximizeMode: win.maximizeMode,
          fullScreen: win.fullScreen,
          minimized: win.minimized,
          frameGeometry: event.geometry,
          outputGeometry: screen?.geometry,
          outputUsableArea: screen?.usableArea
        }, screen);

        win.classification = newClassResult.classification;
        win.tileable = (newClassResult.classification === "tiled");

        if (prevTileable !== win.tileable || prevClass !== win.classification) {
          this.markScreenDirty(win.outputId, "TileabilityChanged");
          return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
        }

        // Genuine geometry change that did not alter classification
        this.markScreenDirty(win.outputId, "WindowGeometryChanged");
        return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
      }

      case "WindowStateChanged": {
        const win = this.windows.get(event.windowId);
        if (!win) return { dirty: false, affectedScreens: [], isEcho: false };

        const prevTileable = win.tileable;
        const prevClass = win.classification;

        if (event.updates.resourceClass !== undefined) win.resourceClass = event.updates.resourceClass;
        if (event.updates.title !== undefined) win.title = event.updates.title;
        if (event.updates.frameGeometry !== undefined) {
          win.frameGeometry = { ...event.updates.frameGeometry };
          win.lastObservedGeometry = { ...event.updates.frameGeometry };
        }
        if (event.updates.minimized !== undefined) {
          if (event.updates.minimized && !win.minimized) {
            win.preMinimizeGeometry = { ...win.frameGeometry };
          }
          win.minimized = event.updates.minimized;
        }
        if (event.updates.fullScreen !== undefined) win.fullScreen = event.updates.fullScreen;
        if (event.updates.noBorder !== undefined) win.noBorder = event.updates.noBorder;
        if (event.updates.maximizeMode !== undefined) win.maximizeMode = event.updates.maximizeMode;
        if (event.updates.isManualFloating !== undefined) win.isManualFloating = event.updates.isManualFloating;
        if (event.updates.isDragging !== undefined) win.isDragging = event.updates.isDragging;
        if (event.updates.isPreTiled !== undefined) win.isPreTiled = event.updates.isPreTiled;
        if (event.updates.outputAffinity !== undefined) win.outputAffinity = event.updates.outputAffinity;

        const screen = this.screens.get(win.outputId);
        const newClassResult = this.classifyWindow({
          id: win.id,
          resourceClass: win.resourceClass,
          title: win.title,
          noBorder: win.noBorder,
          maximizeMode: win.maximizeMode,
          fullScreen: win.fullScreen,
          minimized: win.minimized,
          frameGeometry: win.frameGeometry,
          outputGeometry: screen?.geometry,
          outputUsableArea: screen?.usableArea
        }, screen);

        win.classification = newClassResult.classification;
        win.tileable = (newClassResult.classification === "tiled");

        const changed = (prevTileable !== win.tileable) || (prevClass !== win.classification) || event.updates.minimized !== undefined;
        if (changed) {
          const reason = win.fullScreen ? "WindowFullscreenEntered" : (!win.fullScreen && prevClass === "fullscreen" ? "WindowFullscreenExited" : "WindowStateChanged");
          this.markScreenDirty(win.outputId, reason);
          return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
        }

        return { dirty: false, affectedScreens: [], isEcho: false };
      }

      case "WindowMovedOutput": {
        const win = this.windows.get(event.windowId);
        if (win) {
          win.outputId = event.toOutputId;
          win.outputAffinity = event.toOutputId;
        }

        // Clean up from old screen persistent order and add to new screen
        const oldScreen = this.screens.get(event.fromOutputId);
        if (oldScreen) {
          const idx = oldScreen.persistentOrder.indexOf(event.windowId);
          if (idx !== -1) oldScreen.persistentOrder.splice(idx, 1);
          oldScreen.dirtyReasons.add("WindowMovedOutputSource");
          this.dirtyScreenIds.add(oldScreen.outputId);
        }

        const newScreen = this.screens.get(event.toOutputId);
        if (newScreen) {
          if (!newScreen.persistentOrder.includes(event.windowId)) {
            newScreen.persistentOrder.push(event.windowId);
          }
          newScreen.dirtyReasons.add("WindowMovedOutputTarget");
          this.dirtyScreenIds.add(newScreen.outputId);
        }

        this.pendingReasons.add("WindowMovedOutput");
        return { dirty: true, affectedScreens: [event.fromOutputId, event.toOutputId], isEcho: false };
      }

      case "WindowMovedDesktop": {
        const win = this.windows.get(event.windowId);
        if (win) {
          win.desktopId = event.toDesktopId;
          this.markScreenDirty(win.outputId, "WindowMovedDesktop");
          return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
        }
        return { dirty: false, affectedScreens: [], isEcho: false };
      }

      case "ScreenTopologyChanged": {
        const seenIds = new Set<string>();
        for (const s of event.screens) {
          seenIds.add(s.outputId);
          this.getOrCreateScreen(s);
        }
        // Remove screens that no longer exist
        for (const existingId of this.screens.keys()) {
          if (!seenIds.has(existingId)) {
            this.screens.delete(existingId);
            this.dirtyScreenIds.delete(existingId);
          }
        }

        // Relocate any windows assigned to removed screens
        const remainingScreens = Array.from(this.screens.values()).map(s => ({
          outputId: s.outputId,
          name: s.name,
          geometry: s.geometry,
          usableArea: s.usableArea
        }));

        if (remainingScreens.length > 0) {
          for (const win of this.windows.values()) {
            if (!this.screens.has(win.outputId)) {
              const newOutputId = resolveScreenAffinity({
                explicitOutputId: undefined,
                frameGeometry: win.frameGeometry,
                previousOutputId: win.outputAffinity,
                screens: remainingScreens
              });
              win.outputId = newOutputId;
              win.outputAffinity = newOutputId;
              const targetScreen = this.screens.get(newOutputId);
              if (targetScreen && !targetScreen.persistentOrder.includes(win.id)) {
                targetScreen.persistentOrder.push(win.id);
              }
            }
          }
        }

        this.invalidateAllScreens("ScreenTopologyChanged");
        return { dirty: true, affectedScreens: Array.from(this.screens.keys()), isEcho: false };
      }

      case "ScreenLayoutChanged": {
        const screen = this.screens.get(event.outputId);
        if (screen) {
          screen.activeLayout = event.layout;
          this.markScreenDirty(event.outputId, "ScreenLayoutChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        return { dirty: false, affectedScreens: [], isEcho: false };
      }

      case "ScreenMasterConfigChanged": {
        const screen = this.screens.get(event.outputId);
        if (screen) {
          if (event.count !== undefined) screen.masterCount = Math.max(0, event.count);
          if (event.ratio !== undefined) screen.masterRatio = Math.max(0.10, Math.min(0.90, event.ratio));
          this.markScreenDirty(event.outputId, "ScreenMasterConfigChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        return { dirty: false, affectedScreens: [], isEcho: false };
      }

      case "ScreenGapsChanged": {
        const screen = this.screens.get(event.outputId);
        if (screen) {
          screen.gaps = { ...event.gaps };
          this.markScreenDirty(event.outputId, "ScreenGapsChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        return { dirty: false, affectedScreens: [], isEcho: false };
      }

      case "GlobalConfigChanged": {
        this.updateConfig(event.config);
        return { dirty: true, affectedScreens: Array.from(this.screens.keys()), isEcho: false };
      }
    }
  }

  /**
   * Geometry echo detection and suppression.
   */
  public checkAndHandleEcho(
    windowId: RuntimeWindowId,
    newGeometry: Rect,
    timestamp: number = this.clock.now()
  ): { isEcho: boolean } {
    const entry = this.inFlightEchoes.get(windowId);
    if (!entry) return { isEcho: false };

    const elapsed = timestamp - entry.timestamp;
    const maxAge = this.config.echoExpiryMs ?? DEFAULT_ECHO_EXPIRY_MS;
    if (elapsed > maxAge) {
      this.inFlightEchoes.delete(windowId);
      return { isEcho: false };
    }

    const tolerance = this.config.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX;
    if (rectEqualsWithTolerance(entry.target, newGeometry, tolerance)) {
      this.inFlightEchoes.delete(windowId);
      this.suppressedGeometryEchoes++;
      const win = this.windows.get(windowId);
      if (win) {
        win.lastObservedGeometry = { ...newGeometry };
        win.frameGeometry = { ...newGeometry };
      }
      return { isEcho: true };
    }

    // Geometry does not match the requested target; keep or delete?
    // A mismatch indicates real user intervention or WM constraint. Do not suppress.
    return { isEcho: false };
  }

  /**
   * Records a programmatic geometry assignment to filter its subsequent echo.
   */
  public recordCommand(windowId: RuntimeWindowId, target: Rect, epoch: number): void {
    this.inFlightEchoes.set(windowId, {
      target: { ...target },
      epoch,
      timestamp: this.clock.now()
    });
  }

  /**
   * Determines tileable windows for a screen according to slot persistence.
   */
  public getTileableWindowsForScreen(screen: RetainedScreenState): RetainedWindowState[] {
    const candidateWins: RetainedWindowState[] = [];

    for (const win of this.windows.values()) {
      if (win.outputId !== screen.outputId) continue;
      if (!win.tileable) continue;
      if (win.isManualFloating) continue;
      if (this.config.ignoreMinimized && win.minimized) continue;
      if (win.fullScreen) continue;
      if (win.maximizeMode !== 0) continue; // Maximized windows preserve slot but do not occupy active tile
      candidateWins.push(win);
    }

    // Reconstruct list according to screen.persistentOrder
    const ordered: RetainedWindowState[] = [];
    const remaining = new Set(candidateWins);

    for (const wid of screen.persistentOrder) {
      const match = candidateWins.find(w => w.id === wid);
      if (match) {
        ordered.push(match);
        remaining.delete(match);
      }
    }

    // Append newly arrived windows
    for (const newWin of remaining) {
      ordered.push(newWin);
      if (!screen.persistentOrder.includes(newWin.id)) {
        screen.persistentOrder.push(newWin.id);
      }
    }

    // Update screen ordered IDs
    screen.orderedWindowIds = ordered.map(w => w.id);
    return ordered;
  }

  /**
   * Executes a coalesced reconciliation pass for dirty screens.
   */
  public reconcile(forceScreenId?: string): ReconciliationTransaction | null {
    if (!this.config.enableTiling) {
      this.dirtyScreenIds.clear();
      this.pendingReasons.clear();
      return null;
    }

    const screensToReconcile: RetainedScreenState[] = [];
    if (forceScreenId) {
      const scr = this.screens.get(forceScreenId);
      if (scr) screensToReconcile.push(scr);
    } else {
      for (const scrId of this.dirtyScreenIds) {
        const scr = this.screens.get(scrId);
        if (scr) screensToReconcile.push(scr);
      }
    }

    if (screensToReconcile.length === 0) {
      return null;
    }

    const startTime = this.clock.now();
    const epoch = ++this.currentEpoch;
    const reasons = Array.from(this.pendingReasons);
    const affectedScreenIds = screensToReconcile.map(s => s.outputId);
    const operations: GeometryOperation[] = [];
    let skippedWrites = 0;

    const tolerance = this.config.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX;

    for (const screen of screensToReconcile) {
      if (screen.activeLayout === "floating") {
        screen.dirtyReasons.clear();
        this.dirtyScreenIds.delete(screen.outputId);
        continue;
      }

      const area = screen.usableArea;
      if (area.width <= 0 || area.height <= 0) continue;

      const tileableWindows = this.getTileableWindowsForScreen(screen);
      if (tileableWindows.length === 0) {
        screen.dirtyReasons.clear();
        this.dirtyScreenIds.delete(screen.outputId);
        continue;
      }

      this.totalLayoutComputations++;

      const ids = tileableWindows.map(w => w.id);
      let solution = new Map<RuntimeWindowId, Rect>();

      switch (screen.activeLayout as string) {
        case "master-stack":
          solution = solveMasterStack(area, ids, screen.gaps, {
            masterRatio: screen.masterRatio,
            masterCount: screen.masterCount
          });
          break;
        case "balanced-grid":
        case "grid":
          solution = solveBalancedGrid(area, ids, screen.gaps);
          break;
        case "binary-split":
        case "bsp": {
          let root = null;
          for (const wid of ids) {
            root = insertWindow(root, wid);
          }
          solution = solveTree(root, area, screen.gaps);
          break;
        }
        case "columns":
          solution = solveLayout("columns", area, ids, screen.gaps);
          break;
        case "rows":
          solution = solveLayout("rows", area, ids, screen.gaps);
          break;
        case "monocle":
          solution = solveLayout("monocle", area, ids, screen.gaps);
          break;
        default:
          solution = solveMasterStack(area, ids, screen.gaps, {
            masterRatio: screen.masterRatio,
            masterCount: screen.masterCount
          });
          break;
      }

      // Diff desired vs observed geometry
      for (const win of tileableWindows) {
        if (win.isDragging) continue;

        const desiredRect = solution.get(win.id);
        if (!desiredRect) continue;

        win.currentDesiredTiledGeometry = { ...desiredRect };

        const observedRect = win.lastObservedGeometry;
        if (rectEqualsWithTolerance(desiredRect, observedRect, tolerance)) {
          skippedWrites++;
          this.skippedIdenticalWrites++;
        } else {
          operations.push({
            windowId: win.id,
            targetRect: { ...desiredRect },
            previousRect: { ...observedRect }
          });
          this.totalGeometryWrites++;
          win.lastRequestedGeometry = { ...desiredRect };
          win.lastAppliedTransactionEpoch = epoch;
          this.recordCommand(win.id, desiredRect, epoch);
        }
      }

      screen.latestCommittedEpoch = epoch;
      screen.dirtyReasons.clear();
      this.dirtyScreenIds.delete(screen.outputId);
    }

    this.pendingReasons.clear();
    this.totalReconciliationTransactions++;
    this.lastTransactionReasons = reasons;
    this.lastAffectedScreenIds = affectedScreenIds;

    const durationMs = this.clock.now() - startTime;

    return {
      epoch,
      reasons,
      affectedScreens: affectedScreenIds,
      operations,
      skippedWrites,
      durationMs
    };
  }

  public getSavedTiledGeometry(windowId: RuntimeWindowId): Rect | null {
    const win = this.windows.get(windowId);
    return win?.currentDesiredTiledGeometry ? { ...win.currentDesiredTiledGeometry } : null;
  }

  public setSavedTiledGeometry(windowId: RuntimeWindowId, rect: Rect | null): void {
    const win = this.windows.get(windowId);
    if (win) {
      win.currentDesiredTiledGeometry = rect ? { ...rect } : null;
    }
  }

  public getPreMinimizeGeometry(windowId: RuntimeWindowId): Rect | null {
    const win = this.windows.get(windowId);
    return win?.preMinimizeGeometry ? { ...win.preMinimizeGeometry } : null;
  }

  public setPreMinimizeGeometry(windowId: RuntimeWindowId, rect: Rect | null): void {
    const win = this.windows.get(windowId);
    if (win) {
      win.preMinimizeGeometry = rect ? { ...rect } : null;
    }
  }

  public isPreTiled(windowId: RuntimeWindowId): boolean {
    return Boolean(this.windows.get(windowId)?.isPreTiled);
  }

  public setPreTiled(windowId: RuntimeWindowId, val: boolean): void {
    const win = this.windows.get(windowId);
    if (win) {
      win.isPreTiled = val;
    }
  }

  public getOutputAffinity(windowId: RuntimeWindowId): string | undefined {
    const win = this.windows.get(windowId);
    return win?.outputAffinity || win?.outputId;
  }

  public setOutputAffinity(windowId: RuntimeWindowId, outputId: string): void {
    const win = this.windows.get(windowId);
    if (win) {
      win.outputAffinity = outputId;
    }
  }

  public handleMinimize(
    windowId: RuntimeWindowId,
    isMinimized: boolean,
    currentGeom?: Rect
  ): { dirty: boolean; affectedScreens: string[]; isEcho: boolean } {
    const win = this.windows.get(windowId);
    if (win && isMinimized) {
      win.preMinimizeGeometry = currentGeom ? { ...currentGeom } : { ...win.frameGeometry };
    }
    return this.ingestEvent({
      type: "WindowStateChanged",
      windowId,
      updates: {
        minimized: isMinimized,
        ...(currentGeom ? { frameGeometry: currentGeom } : {})
      }
    });
  }

  public handleTopologyChange(screens: NormalizedScreenInput[]): ReconciliationTransaction | null {
    this.ingestEvent({
      type: "ScreenTopologyChanged",
      screens
    });
    return this.reconcile();
  }

  public getClock(): Clock {
    return this.clock;
  }

  public getTraceRecorder(): TraceRecorder {
    return this.traceRecorder;
  }

  public isManualFloating(windowId: RuntimeWindowId): boolean {
    return Boolean(this.windows.get(windowId)?.isManualFloating);
  }

  public setManualFloating(
    windowId: RuntimeWindowId,
    val: boolean
  ): { dirty: boolean; affectedScreens: string[]; isEcho: boolean } {
    const win = this.windows.get(windowId);
    if (win) {
      win.isManualFloating = val;
    }
    return this.ingestEvent({
      type: "WindowStateChanged",
      windowId,
      updates: { isManualFloating: val }
    });
  }

  public swapWindowOrder(
    outputId: string,
    forward: boolean
  ): { dirty: boolean; affectedScreens: string[]; isEcho: boolean } {
    const screen = this.screens.get(outputId);
    if (!screen || screen.persistentOrder.length < 2) {
      return { dirty: false, affectedScreens: [], isEcho: false };
    }
    const order = [...screen.persistentOrder];
    if (forward) {
      const first = order.shift()!;
      order.push(first);
    } else {
      const last = order.pop()!;
      order.unshift(last);
    }
    screen.persistentOrder = order;
    this.markScreenDirty(outputId, "WindowOrderSwapped");
    return { dirty: true, affectedScreens: [outputId], isEcho: false };
  }

  public getDiagnostics(): CoordinatorDiagnostics {
    return {
      totalNormalizedEvents: this.totalNormalizedEvents,
      totalReconciliationTransactions: this.totalReconciliationTransactions,
      totalLayoutComputations: this.totalLayoutComputations,
      totalGeometryWrites: this.totalGeometryWrites,
      skippedIdenticalWrites: this.skippedIdenticalWrites,
      suppressedGeometryEchoes: this.suppressedGeometryEchoes,
      lastTransactionReasons: [...this.lastTransactionReasons],
      lastAffectedScreenIds: [...this.lastAffectedScreenIds],
      retainedWindowCount: this.windows.size,
      retainedScreenCount: this.screens.size
    };
  }
}
