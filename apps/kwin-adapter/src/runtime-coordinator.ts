import type {
  Rect,
  RuntimeWindowId
} from "@tessera/protocol";
import {
  solvePrimaryStack,
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
  type WorkspaceLayoutState,
  type WorkspaceScopeKey,
  getWorkspaceScopeKey,
  GLOBAL_DESKTOP_SCOPE,
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
  private readonly workspaces = new Map<WorkspaceScopeKey, WorkspaceLayoutState>();
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
    const effRatio = initialConfig?.primaryRegionRatio !== undefined
      ? initialConfig.primaryRegionRatio
      : (initialConfig?.masterRatio ?? 0.50);
    const effCount = initialConfig?.primaryRegionCount !== undefined
      ? initialConfig.primaryRegionCount
      : (initialConfig?.masterCount ?? 1);

    this.config = {
      enableTiling: initialConfig?.enableTiling ?? true,
      defaultLayout: initialConfig?.defaultLayout ?? "master-stack",
      gapInner: initialConfig?.gapInner ?? 8,
      gapOuter: initialConfig?.gapOuter ?? 10,
      primaryRegionRatio: effRatio,
      primaryRegionCount: effCount,
      masterRatio: effRatio,
      masterCount: effCount,
      perDesktopLayout: initialConfig?.perDesktopLayout ?? true,
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
    const effRatio = updates.primaryRegionRatio !== undefined
      ? updates.primaryRegionRatio
      : (updates.masterRatio !== undefined ? updates.masterRatio : this.config.masterRatio);
    const effCount = updates.primaryRegionCount !== undefined
      ? updates.primaryRegionCount
      : (updates.masterCount !== undefined ? updates.masterCount : this.config.masterCount);

    this.config = {
      ...this.config,
      ...updates,
      primaryRegionRatio: effRatio,
      primaryRegionCount: effCount,
      masterRatio: effRatio,
      masterCount: effCount
    };
    this.invalidateAllScreens("GlobalConfigChanged");
  }

  public getWorkspaceScopeKey(outputId: string, desktopId: string = "1"): WorkspaceScopeKey {
    return getWorkspaceScopeKey(outputId, desktopId);
  }

  public getEffectiveDesktopId(desktopId: string = "1"): string {
    if (this.config.perDesktopLayout === false) {
      return GLOBAL_DESKTOP_SCOPE;
    }
    return desktopId;
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

  public getOrCreateWorkspace(outputId: string, desktopId: string = "1"): WorkspaceLayoutState {
    const effDeskId = this.getEffectiveDesktopId(desktopId);
    const key = getWorkspaceScopeKey(outputId, effDeskId);
    let ws = this.workspaces.get(key);
    if (!ws) {
      ws = {
        scopeKey: key,
        outputId,
        desktopId: effDeskId,
        activeLayout: this.config.defaultLayout,
        primaryRegionCount: this.config.primaryRegionCount ?? this.config.masterCount,
        primaryRegionRatio: this.config.primaryRegionRatio ?? this.config.masterRatio,
        gaps: { inner: this.config.gapInner, outer: this.config.gapOuter },
        orderedSlotWindowIds: []
      };
      this.workspaces.set(key, ws);
    }
    return ws;
  }

  public getWorkspace(outputId: string, desktopId: string = "1"): WorkspaceLayoutState | undefined {
    const effDeskId = this.getEffectiveDesktopId(desktopId);
    return this.workspaces.get(getWorkspaceScopeKey(outputId, effDeskId));
  }

  public getOrCreateScreen(input: NormalizedScreenInput): RetainedScreenState {
    let screen = this.screens.get(input.outputId);
    const activeDesktopId = input.activeDesktopId || "1";
    this.getOrCreateWorkspace(input.outputId, activeDesktopId);

    if (!screen) {
      const self = this;
      const newScreen: RetainedScreenState = {
        outputId: input.outputId,
        name: input.name || input.outputId,
        geometry: { ...input.geometry },
        usableArea: { ...input.usableArea },
        activeDesktopId,
        activeActivityId: input.activeActivityId,
        get activeLayout() {
          return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).activeLayout;
        },
        set activeLayout(l) {
          self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).activeLayout = l;
        },
        get masterCount() {
          return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionCount;
        },
        set masterCount(c) {
          self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionCount = c;
        },
        get masterRatio() {
          return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionRatio;
        },
        set masterRatio(r) {
          self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionRatio = r;
        },
        get primaryRegionCount() {
          return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionCount;
        },
        set primaryRegionCount(c) {
          self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionCount = c;
        },
        get primaryRegionRatio() {
          return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionRatio;
        },
        set primaryRegionRatio(r) {
          self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).primaryRegionRatio = r;
        },
        get gaps() {
          return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).gaps;
        },
        set gaps(g) {
          self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).gaps = g;
        },
        _orderedWindowIds: [] as RuntimeWindowId[],
        get orderedWindowIds() {
          return this._orderedWindowIds || [];
        },
        set orderedWindowIds(wids: RuntimeWindowId[]) {
          this._orderedWindowIds = wids;
        },
        get persistentOrder() {
          return self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).orderedSlotWindowIds;
        },
        set persistentOrder(wids: RuntimeWindowId[]) {
          self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).orderedSlotWindowIds = wids;
        },
        dirtyReasons: new Set(),
        latestCommittedEpoch: 0
      };
      this.screens.set(input.outputId, newScreen);
      screen = newScreen;
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
        const desktopId = winInput.desktopId || "1";

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

        const deskIds = (winInput.desktopIds && winInput.desktopIds.length > 0)
          ? winInput.desktopIds
          : [desktopId];
        const isSticky = Boolean(winInput.onAllDesktops);
        const activities = (winInput.activities && winInput.activities.length > 0)
          ? [...winInput.activities]
          : (winInput.activityId ? [winInput.activityId] : []);

        const retained: RetainedWindowState = {
          id: winInput.id,
          resourceClass: winInput.resourceClass || "",
          resourceName: winInput.resourceName || "",
          appId: winInput.appId || "",
          desktopFileName: winInput.desktopFileName || "",
          title: winInput.title || "",
          role: winInput.role || "",
          outputId,
          desktopId,
          desktopIds: [...deskIds],
          onAllDesktops: isSticky,
          activityId: winInput.activityId || (activities[0] || undefined),
          activities,
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

        // Update scoped workspace slot ordering across all assigned desktops or global scope
        if (this.config.perDesktopLayout === false) {
          const ws = this.getOrCreateWorkspace(outputId, GLOBAL_DESKTOP_SCOPE);
          if (!ws.orderedSlotWindowIds.includes(winInput.id)) {
            ws.orderedSlotWindowIds.push(winInput.id);
          }
        } else if (isSticky) {
          const scr = this.screens.get(outputId);
          const activeDesk = scr ? scr.activeDesktopId : desktopId;
          const ws = this.getOrCreateWorkspace(outputId, activeDesk);
          if (!ws.orderedSlotWindowIds.includes(winInput.id)) {
            ws.orderedSlotWindowIds.push(winInput.id);
          }
        } else {
          for (const dId of deskIds) {
            const ws = this.getOrCreateWorkspace(outputId, dId);
            if (!ws.orderedSlotWindowIds.includes(winInput.id)) {
              ws.orderedSlotWindowIds.push(winInput.id);
            }
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

        // Remove from all workspace slot orderings
        const affected: string[] = [];
        for (const ws of this.workspaces.values()) {
          const idx = ws.orderedSlotWindowIds.indexOf(event.windowId);
          if (idx !== -1) {
            ws.orderedSlotWindowIds.splice(idx, 1);
            if (!affected.includes(ws.outputId)) {
              this.markScreenDirty(ws.outputId, "WindowRemoved");
              affected.push(ws.outputId);
            }
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
        if (event.updates.onAllDesktops !== undefined) win.onAllDesktops = event.updates.onAllDesktops;
        if (event.updates.desktopIds !== undefined) win.desktopIds = [...event.updates.desktopIds];
        if (event.updates.activities !== undefined) win.activities = [...event.updates.activities];

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
        const deskId = win ? win.desktopId : "1";
        if (win) {
          win.outputId = event.toOutputId;
          win.outputAffinity = event.toOutputId;
        }

        // Clean up from old workspaces on source output
        for (const ws of this.workspaces.values()) {
          if (ws.outputId === event.fromOutputId) {
            const idx = ws.orderedSlotWindowIds.indexOf(event.windowId);
            if (idx !== -1) ws.orderedSlotWindowIds.splice(idx, 1);
          }
        }
        const oldScreen = this.screens.get(event.fromOutputId);
        if (oldScreen) {
          oldScreen.dirtyReasons.add("WindowMovedOutputSource");
          this.dirtyScreenIds.add(oldScreen.outputId);
        }

        // Add to new workspace(s) on target output
        const targetDesks = (win && win.desktopIds && win.desktopIds.length > 0) ? win.desktopIds : [deskId];
        if (this.config.perDesktopLayout === false) {
          const newWs = this.getOrCreateWorkspace(event.toOutputId, GLOBAL_DESKTOP_SCOPE);
          if (!newWs.orderedSlotWindowIds.includes(event.windowId)) {
            newWs.orderedSlotWindowIds.push(event.windowId);
          }
        } else if (win && win.onAllDesktops) {
          const newScr = this.screens.get(event.toOutputId);
          const actDesk = newScr ? newScr.activeDesktopId : deskId;
          const newWs = this.getOrCreateWorkspace(event.toOutputId, actDesk);
          if (!newWs.orderedSlotWindowIds.includes(event.windowId)) {
            newWs.orderedSlotWindowIds.push(event.windowId);
          }
        } else {
          for (const dId of targetDesks) {
            const newWs = this.getOrCreateWorkspace(event.toOutputId, dId);
            if (!newWs.orderedSlotWindowIds.includes(event.windowId)) {
              newWs.orderedSlotWindowIds.push(event.windowId);
            }
          }
        }

        const newScreen = this.screens.get(event.toOutputId);
        if (newScreen) {
          newScreen.dirtyReasons.add("WindowMovedOutputTarget");
          this.dirtyScreenIds.add(newScreen.outputId);
        }

        this.pendingReasons.add("WindowMovedOutput");
        return { dirty: true, affectedScreens: [event.fromOutputId, event.toOutputId], isEcho: false };
      }

      case "WindowMovedDesktop": {
        const win = this.windows.get(event.windowId);
        if (win) {
          const oldDeskId = event.fromDesktopId;
          const newDeskId = event.toDesktopId;
          win.desktopId = newDeskId;
          win.desktopIds = [newDeskId];
          win.onAllDesktops = false;

          const oldWs = this.getWorkspace(win.outputId, oldDeskId);
          if (oldWs) {
            const idx = oldWs.orderedSlotWindowIds.indexOf(event.windowId);
            if (idx !== -1) oldWs.orderedSlotWindowIds.splice(idx, 1);
          }

          const newWs = this.getOrCreateWorkspace(win.outputId, newDeskId);
          if (!newWs.orderedSlotWindowIds.includes(event.windowId)) {
            newWs.orderedSlotWindowIds.push(event.windowId);
          }

          this.markScreenDirty(win.outputId, "WindowMovedDesktop");
          return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
        }
        return { dirty: false, affectedScreens: [], isEcho: false };
      }

      case "WindowDesktopsChanged": {
        const win = this.windows.get(event.windowId);
        if (!win) return { dirty: false, affectedScreens: [], isEcho: false };

        const newDesks = [...event.desktopIds];
        const newSticky = event.onAllDesktops !== undefined ? Boolean(event.onAllDesktops) : win.onAllDesktops;
        win.desktopIds = newDesks;
        win.onAllDesktops = newSticky;
        if (newDesks.length > 0) {
          win.desktopId = newDesks[0];
        }

        // Reconcile workspace memberships on win.outputId
        for (const ws of this.workspaces.values()) {
          if (ws.outputId !== win.outputId) continue;
          const inMembership = newSticky || newDesks.includes(ws.desktopId) || (!this.config.perDesktopLayout && ws.desktopId === GLOBAL_DESKTOP_SCOPE);
          const idx = ws.orderedSlotWindowIds.indexOf(event.windowId);
          if (inMembership && idx === -1) {
            ws.orderedSlotWindowIds.push(event.windowId);
          } else if (!inMembership && idx !== -1) {
            ws.orderedSlotWindowIds.splice(idx, 1);
          }
        }

        // Also ensure all new desktops have workspace objects created and populated
        if (this.config.perDesktopLayout !== false && !newSticky) {
          for (const dId of newDesks) {
            const ws = this.getOrCreateWorkspace(win.outputId, dId);
            if (!ws.orderedSlotWindowIds.includes(event.windowId)) {
              ws.orderedSlotWindowIds.push(event.windowId);
            }
          }
        }

        this.markScreenDirty(win.outputId, "WindowDesktopsChanged");
        return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
      }

      case "WindowActivitiesChanged": {
        const win = this.windows.get(event.windowId);
        if (!win) return { dirty: false, affectedScreens: [], isEcho: false };
        win.activities = [...event.activities];
        if (event.activities.length > 0) {
          win.activityId = event.activities[0];
        }
        return { dirty: false, affectedScreens: [], isEcho: false };
      }

      case "ScreenDesktopChanged": {
        const screen = this.screens.get(event.outputId);
        if (screen) {
          screen.activeDesktopId = event.toDesktopId;
          // Ensure sticky windows participate in the newly active desktop's workspace
          const targetWs = this.getOrCreateWorkspace(event.outputId, event.toDesktopId);
          for (const win of this.windows.values()) {
            if (win.outputId === event.outputId && win.onAllDesktops) {
              if (!targetWs.orderedSlotWindowIds.includes(win.id)) {
                targetWs.orderedSlotWindowIds.push(win.id);
              }
            }
          }
          this.markScreenDirty(event.outputId, "ScreenDesktopChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
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
              const targetWs = this.getOrCreateWorkspace(newOutputId, win.desktopId);
              if (!targetWs.orderedSlotWindowIds.includes(win.id)) {
                targetWs.orderedSlotWindowIds.push(win.id);
              }
            }
          }
        }

        this.invalidateAllScreens("ScreenTopologyChanged");
        return { dirty: true, affectedScreens: Array.from(this.screens.keys()), isEcho: false };
      }

      case "ScreenLayoutChanged": {
        const screen = this.screens.get(event.outputId);
        const deskId = event.desktopId || (screen ? screen.activeDesktopId : "1");
        const ws = this.getOrCreateWorkspace(event.outputId, deskId);
        ws.activeLayout = event.layout;
        this.markScreenDirty(event.outputId, "ScreenLayoutChanged");
        return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
      }

      case "WorkspaceLayoutChanged": {
        const ws = this.getOrCreateWorkspace(event.outputId, event.desktopId);
        ws.activeLayout = event.layout;
        this.markScreenDirty(event.outputId, "WorkspaceLayoutChanged");
        return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
      }

      case "ScreenMasterConfigChanged": {
        const screen = this.screens.get(event.outputId);
        const deskId = event.desktopId || (screen ? screen.activeDesktopId : "1");
        const ws = this.getOrCreateWorkspace(event.outputId, deskId);
        if (event.count !== undefined) ws.primaryRegionCount = Math.max(0, event.count);
        if (event.ratio !== undefined) ws.primaryRegionRatio = Math.max(0.10, Math.min(0.90, event.ratio));
        this.markScreenDirty(event.outputId, "ScreenMasterConfigChanged");
        return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
      }

      case "WorkspacePrimaryConfigChanged": {
        const ws = this.getOrCreateWorkspace(event.outputId, event.desktopId);
        if (event.count !== undefined) ws.primaryRegionCount = Math.max(0, event.count);
        if (event.ratio !== undefined) ws.primaryRegionRatio = Math.max(0.10, Math.min(0.90, event.ratio));
        this.markScreenDirty(event.outputId, "WorkspacePrimaryConfigChanged");
        return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
      }

      case "ScreenGapsChanged": {
        const screen = this.screens.get(event.outputId);
        const deskId = event.desktopId || (screen ? screen.activeDesktopId : "1");
        const ws = this.getOrCreateWorkspace(event.outputId, deskId);
        ws.gaps = { ...event.gaps };
        this.markScreenDirty(event.outputId, "ScreenGapsChanged");
        return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
      }

      case "WorkspaceGapsChanged": {
        const ws = this.getOrCreateWorkspace(event.outputId, event.desktopId);
        ws.gaps = { ...event.gaps };
        this.markScreenDirty(event.outputId, "WorkspaceGapsChanged");
        return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
      }

      case "GlobalConfigChanged": {
        this.updateConfig(event.config);
        return { dirty: true, affectedScreens: Array.from(this.screens.keys()), isEcho: false };
      }

      case "WindowSnapCommitted": {
        const win = this.windows.get(event.windowId);
        if (!win) return { dirty: false, affectedScreens: [], isEcho: false };

        const targetScreen = this.screens.get(event.outputId);
        const oldOutputId = win.outputId;
        const oldDeskId = win.desktopId;
        const newDeskId = event.desktopId || (targetScreen ? targetScreen.activeDesktopId : oldDeskId);

        win.outputId = event.outputId;
        win.desktopId = newDeskId;
        win.outputAffinity = event.outputId;
        win.isDragging = false;
        win.isManualFloating = false;
        win.tileable = true;
        win.classification = "tiled";
        win.currentDesiredTiledGeometry = { ...event.targetRect };
        this.setSavedTiledGeometry(event.windowId, event.targetRect);

        // Remove from old workspace if changed
        if (oldOutputId !== event.outputId || oldDeskId !== newDeskId) {
          const oldWs = this.getWorkspace(oldOutputId, oldDeskId);
          if (oldWs) {
            const oIdx = oldWs.orderedSlotWindowIds.indexOf(event.windowId);
            if (oIdx !== -1) oldWs.orderedSlotWindowIds.splice(oIdx, 1);
          }
        }

        const targetWs = this.getOrCreateWorkspace(event.outputId, newDeskId);
        const curIdx = targetWs.orderedSlotWindowIds.indexOf(event.windowId);
        if (curIdx !== -1) targetWs.orderedSlotWindowIds.splice(curIdx, 1);

        if (event.slotIndex === 0) {
          targetWs.orderedSlotWindowIds.unshift(event.windowId);
        } else if (event.slotIndex !== undefined && event.slotIndex > 0) {
          targetWs.orderedSlotWindowIds.splice(event.slotIndex, 0, event.windowId);
        } else {
          targetWs.orderedSlotWindowIds.push(event.windowId);
        }

        this.markScreenDirty(event.outputId, "WindowSnapCommitted");
        const affected = [event.outputId];
        if (oldOutputId && oldOutputId !== event.outputId) {
          this.markScreenDirty(oldOutputId, "WindowSnapCommittedSource");
          affected.push(oldOutputId);
        }
        return { dirty: true, affectedScreens: affected, isEcho: false };
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
   * Determines tileable windows for a screen according to scoped workspace slot persistence.
   */
  public getTileableWindowsForScreen(screen: RetainedScreenState): RetainedWindowState[] {
    const desktopId = screen.activeDesktopId || "1";
    const ws = this.getOrCreateWorkspace(screen.outputId, desktopId);
    const candidateWins: RetainedWindowState[] = [];

    for (const win of this.windows.values()) {
      if (win.outputId !== screen.outputId) continue;
      const belongsToDesktop = this.config.perDesktopLayout === false ||
        win.onAllDesktops ||
        (win.desktopIds && win.desktopIds.length > 0 ? win.desktopIds.includes(desktopId) : win.desktopId === desktopId);
      if (!belongsToDesktop) continue;
      if (!win.tileable) continue;
      if (win.isManualFloating) continue;
      if (this.config.ignoreMinimized && win.minimized) continue;
      if (win.fullScreen) continue;
      if (win.maximizeMode !== 0) continue; // Maximized windows preserve slot but do not occupy active tile
      candidateWins.push(win);
    }

    // Reconstruct list according to ws.orderedSlotWindowIds
    const ordered: RetainedWindowState[] = [];
    const remaining = new Set(candidateWins);

    for (const wid of ws.orderedSlotWindowIds) {
      const match = candidateWins.find(w => w.id === wid);
      if (match) {
        ordered.push(match);
        remaining.delete(match);
      }
    }

    // Append newly arrived windows
    for (const newWin of remaining) {
      ordered.push(newWin);
      if (!ws.orderedSlotWindowIds.includes(newWin.id)) {
        ws.orderedSlotWindowIds.push(newWin.id);
      }
    }

    // Keep screen compat properties in sync
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
        case "primary-stack":
        case "master-stack":
          solution = solvePrimaryStack(area, ids, screen.gaps, {
            primaryRegionRatio: screen.primaryRegionRatio,
            primaryRegionCount: screen.primaryRegionCount,
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
          solution = solveBalancedGrid(area, ids, screen.gaps);
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

  /**
   * Commits a window into a prospective snap target geometry and screen slot.
   * Produces exactly 1 geometry operation if the window moves or resizes,
   * arms inFlightEchoes for suppression of the compositor echo,
   * or skips the write (0 operations) if the window is already at targetRect.
   * Unaffected screens produce 0 writes.
   */
  public applySnapCommit(
    windowId: RuntimeWindowId,
    outputId: string,
    targetRect: Rect,
    slotIndex?: number
  ): ReconciliationTransaction | null {
    this.ingestEvent({
      type: "WindowSnapCommitted",
      windowId,
      outputId,
      targetRect,
      slotIndex
    });

    const win = this.windows.get(windowId);
    if (!win) return null;

    const screen = this.screens.get(outputId);
    if (!screen) return null;

    const tolerance = this.config.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX;
    const observedRect = win.lastObservedGeometry;

    if (
      rectEqualsWithTolerance(targetRect, observedRect, tolerance) ||
      (win.lastRequestedGeometry && rectEqualsWithTolerance(targetRect, win.lastRequestedGeometry, tolerance))
    ) {
      this.skippedIdenticalWrites++;
      screen.dirtyReasons.clear();
      this.dirtyScreenIds.delete(outputId);
      return null;
    }

    const epoch = ++this.currentEpoch;
    const op: GeometryOperation = {
      windowId: win.id,
      targetRect: { ...targetRect },
      previousRect: { ...observedRect }
    };
    this.totalGeometryWrites++;
    win.lastRequestedGeometry = { ...targetRect };
    win.lastAppliedTransactionEpoch = epoch;
    this.recordCommand(win.id, targetRect, epoch);

    screen.latestCommittedEpoch = epoch;
    screen.dirtyReasons.clear();
    this.dirtyScreenIds.delete(outputId);

    const tx: ReconciliationTransaction = {
      epoch,
      reasons: ["SnapCommitted"],
      affectedScreens: [outputId],
      operations: [op],
      skippedWrites: 0
    };
    this.totalReconciliationTransactions++;
    this.lastTransactionReasons = ["SnapCommitted"];
    this.lastAffectedScreenIds = [outputId];
    return tx;
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
    forward: boolean,
    desktopId?: string
  ): { dirty: boolean; affectedScreens: string[]; isEcho: boolean } {
    const screen = this.screens.get(outputId);
    const deskId = desktopId || (screen ? screen.activeDesktopId : "1");
    const ws = this.getOrCreateWorkspace(outputId, deskId);
    if (ws.orderedSlotWindowIds.length < 2) {
      return { dirty: false, affectedScreens: [], isEcho: false };
    }
    const order = [...ws.orderedSlotWindowIds];
    if (forward) {
      const first = order.shift()!;
      order.push(first);
    } else {
      const last = order.pop()!;
      order.unshift(last);
    }
    ws.orderedSlotWindowIds = order;
    this.markScreenDirty(outputId, "WindowOrderSwapped");
    return { dirty: true, affectedScreens: [outputId], isEcho: false };
  }

  public moveWindowToSlot(
    windowId: RuntimeWindowId,
    targetSlotIndex: number
  ): { dirty: boolean; affectedScreens: string[]; isEcho: boolean } {
    const win = this.windows.get(windowId);
    if (!win) return { dirty: false, affectedScreens: [], isEcho: false };

    const ws = this.getOrCreateWorkspace(win.outputId, win.desktopId);
    const curIdx = ws.orderedSlotWindowIds.indexOf(windowId);
    if (curIdx === -1) return { dirty: false, affectedScreens: [], isEcho: false };

    ws.orderedSlotWindowIds.splice(curIdx, 1);
    const boundedSlot = Math.max(0, Math.min(targetSlotIndex, ws.orderedSlotWindowIds.length));
    ws.orderedSlotWindowIds.splice(boundedSlot, 0, windowId);

    this.markScreenDirty(win.outputId, "WindowSlotMoved");
    return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
  }

  public moveWindowToFirstSlot(
    windowId: RuntimeWindowId
  ): { dirty: boolean; affectedScreens: string[]; isEcho: boolean } {
    return this.moveWindowToSlot(windowId, 0);
  }

  public swapWindowSlots(
    windowIdA: RuntimeWindowId,
    windowIdB: RuntimeWindowId
  ): { dirty: boolean; affectedScreens: string[]; isEcho: boolean } {
    const winA = this.windows.get(windowIdA);
    const winB = this.windows.get(windowIdB);
    if (!winA || !winB || winA.outputId !== winB.outputId || winA.desktopId !== winB.desktopId) {
      return { dirty: false, affectedScreens: [], isEcho: false };
    }

    const ws = this.getOrCreateWorkspace(winA.outputId, winA.desktopId);
    const idxA = ws.orderedSlotWindowIds.indexOf(windowIdA);
    const idxB = ws.orderedSlotWindowIds.indexOf(windowIdB);
    if (idxA === -1 || idxB === -1) {
      return { dirty: false, affectedScreens: [], isEcho: false };
    }

    ws.orderedSlotWindowIds[idxA] = windowIdB;
    ws.orderedSlotWindowIds[idxB] = windowIdA;

    this.markScreenDirty(winA.outputId, "WindowSlotsSwapped");
    return { dirty: true, affectedScreens: [winA.outputId], isEcho: false };
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
