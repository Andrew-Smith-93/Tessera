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

interface WorkspaceLayoutOverride {
  layout?: string;
  ratio?: number;
  primaryCount?: number;
}

const WORKSPACE_LAYOUT_VERSION = 1;
const WORKSPACE_LAYOUT_MAX_ENTRIES = 50;
const WORKSPACE_LAYOUT_MAX_BYTES = 65_536;
const VALID_WORKSPACE_LAYOUTS = new Set([
  "balanced-grid",
  "primary-stack",
  "binary-split",
  "columns",
  "rows",
  "monocle",
  "floating"
]);
const UNSAFE_SCOPE_PARTS = new Set(["__proto__", "prototype", "constructor"]);

export class RuntimeCoordinator {
  private readonly windows = new Map<RuntimeWindowId, RetainedWindowState>();
  private readonly screens = new Map<string, RetainedScreenState>();
  private readonly workspaces = new Map<WorkspaceScopeKey, WorkspaceLayoutState>();
  private readonly inFlightEchoes = new Map<RuntimeWindowId, InFlightEcho>();
  private readonly dirtyScreenIds = new Set<string>();
  private readonly pendingReasons = new Set<string>();
  private readonly workspaceLayoutOverrides = new Map<WorkspaceScopeKey, WorkspaceLayoutOverride>();
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
  private workspaceLayoutConfigError: string | null = null;

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
      defaultLayout: initialConfig?.defaultLayout ?? "balanced-grid",
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
      workspaceLayoutsJson: initialConfig?.workspaceLayoutsJson ?? "{\"version\":1,\"scopes\":{}}",
      customGamePatterns: initialConfig?.customGamePatterns ?? [],
      geometryTolerancePx: initialConfig?.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX,
      echoExpiryMs: initialConfig?.echoExpiryMs ?? DEFAULT_ECHO_EXPIRY_MS
    };
    this.loadWorkspaceLayoutsJson(initialConfig?.workspaceLayoutsJson);
  }

  public getConfig(): CoordinatorConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<CoordinatorConfig>): void {
    const previousPerDesktopLayout = this.config.perDesktopLayout;
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
    if (previousPerDesktopLayout !== this.config.perDesktopLayout) {
      this.rebuildWorkspaceMemberships();
    }
    if (updates.workspaceLayoutsJson !== undefined) {
      this.loadWorkspaceLayoutsJson(updates.workspaceLayoutsJson);
    }
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
      const override = this.workspaceLayoutOverrides.get(key) ||
        this.workspaceLayoutOverrides.get(getWorkspaceScopeKey("*", effDeskId));
      ws = {
        scopeKey: key,
        outputId,
        desktopId: effDeskId,
        activeLayout: (override?.layout as WorkspaceLayoutState["activeLayout"]) || this.config.defaultLayout,
        primaryRegionCount: override?.primaryCount ?? this.config.primaryRegionCount ?? this.config.masterCount,
        primaryRegionRatio: override?.ratio ?? this.config.primaryRegionRatio ?? this.config.masterRatio,
        gaps: { inner: this.config.gapInner, outer: this.config.gapOuter },
        orderedSlotWindowIds: []
      };
      this.workspaces.set(key, ws);
    }
    return ws;
  }

  public getWorkspaceLayoutConfigError(): string | null {
    return this.workspaceLayoutConfigError;
  }

  public loadWorkspaceLayoutsJson(serialized?: string): boolean {
    this.workspaceLayoutOverrides.clear();
    this.workspaceLayoutConfigError = null;
    // Only `undefined` means "no configuration provided" — default to empty scopes.
    // null and empty string are explicit invalid inputs that must be rejected.
    if (serialized === undefined) {
      this.config.workspaceLayoutsJson = '{"version":1,"scopes":{}}';
      this.applyWorkspaceLayoutOverrides();
      return true;
    }
    const effectiveSerialized = serialized;

    try {
      if (this.utf8ByteLength(effectiveSerialized) > WORKSPACE_LAYOUT_MAX_BYTES) {
        throw new Error("workspace layout configuration exceeds 64 KiB");
      }
      this.assertNoDuplicateJsonKeys(effectiveSerialized);
      const parsed = JSON.parse(effectiveSerialized) as any;
      let scopes: Record<string, any>;
      let requireCanonicalEncoding = true;

      // First-pass builds stored an unversioned scope map. Accept it once and
      // normalize it in memory so upgrading does not discard user overrides.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
          !Object.prototype.hasOwnProperty.call(parsed, "version") &&
          !Object.prototype.hasOwnProperty.call(parsed, "scopes")) {
        scopes = parsed;
        requireCanonicalEncoding = false;
      } else {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("workspace layout configuration must be an object");
        }
        if (parsed.version !== WORKSPACE_LAYOUT_VERSION) {
          throw new Error(`unsupported workspace layout version '${String(parsed.version)}'`);
        }
        if (!parsed.scopes || typeof parsed.scopes !== "object" || Array.isArray(parsed.scopes)) {
          throw new Error("workspace layout scopes must be an object");
        }
        if (Object.keys(parsed).some(key => key !== "version" && key !== "scopes")) {
          throw new Error("workspace layout root contains unknown fields");
        }
        scopes = parsed.scopes;
      }

      const scopeKeys = Object.keys(scopes);
      if (scopeKeys.length > WORKSPACE_LAYOUT_MAX_ENTRIES) {
        throw new Error("workspace layout configuration exceeds 50 scopes");
      }

      const canonicalScopes: Record<string, WorkspaceLayoutOverride> = {};
      for (const scopeKey of scopeKeys) {
        const parts = scopeKey.split("//");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          throw new Error(`invalid workspace scope '${scopeKey}'`);
        }
        const outputId = decodeURIComponent(parts[0]);
        const desktopId = decodeURIComponent(parts[1]);
        if (UNSAFE_SCOPE_PARTS.has(outputId) || UNSAFE_SCOPE_PARTS.has(desktopId)) {
          throw new Error(`unsafe workspace scope '${scopeKey}'`);
        }
        const canonicalKey = getWorkspaceScopeKey(outputId, desktopId);
        if (canonicalKey !== scopeKey) {
          throw new Error(`non-canonical workspace scope '${scopeKey}'`);
        }

        const raw = scopes[scopeKey];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new Error(`workspace scope '${scopeKey}' must be an object`);
        }
        if (Object.keys(raw).some(key => !["layout", "ratio", "primaryCount"].includes(key))) {
          throw new Error(`workspace scope '${scopeKey}' contains unknown fields`);
        }

        const override: WorkspaceLayoutOverride = {};
        if (raw.layout !== undefined) {
          const layout = raw.layout === "master-stack" ? "primary-stack" : raw.layout;
          if (typeof layout !== "string" || !VALID_WORKSPACE_LAYOUTS.has(layout)) {
            throw new Error(`invalid layout in workspace scope '${scopeKey}'`);
          }
          override.layout = layout;
        }
        if (raw.ratio !== undefined) {
          if (typeof raw.ratio !== "number" || !Number.isFinite(raw.ratio) || raw.ratio < 0.10 || raw.ratio > 0.90) {
            throw new Error(`invalid ratio in workspace scope '${scopeKey}'`);
          }
          override.ratio = raw.ratio;
        }
        if (raw.primaryCount !== undefined) {
          if (!Number.isInteger(raw.primaryCount) || raw.primaryCount < 0 || raw.primaryCount > 10) {
            throw new Error(`invalid primaryCount in workspace scope '${scopeKey}'`);
          }
          override.primaryCount = raw.primaryCount;
        }
        canonicalScopes[canonicalKey] = override;
      }

      const canonical = this.canonicalWorkspaceLayoutJson(canonicalScopes);
      if (requireCanonicalEncoding) {
        if (canonical !== effectiveSerialized) {
          throw new Error("workspace layout configuration is not canonically serialized");
        }
      }

      this.config.workspaceLayoutsJson = canonical;

      for (const key of Object.keys(canonicalScopes).sort()) {
        this.workspaceLayoutOverrides.set(key, canonicalScopes[key]);
      }
      this.applyWorkspaceLayoutOverrides();
      return true;
    } catch (error) {
      this.workspaceLayoutConfigError = error instanceof Error ? error.message : String(error);
      this.config.workspaceLayoutsJson = '{"version":1,"scopes":{}}';
      this.applyWorkspaceLayoutOverrides();
      return false;
    }
  }

  private canonicalWorkspaceLayoutJson(scopes: Record<string, WorkspaceLayoutOverride>): string {
    const orderedScopes: Record<string, WorkspaceLayoutOverride> = {};
    for (const key of Object.keys(scopes).sort()) {
      const value = scopes[key];
      const orderedValue: WorkspaceLayoutOverride = {};
      if (value.layout !== undefined) orderedValue.layout = value.layout;
      if (value.ratio !== undefined) orderedValue.ratio = value.ratio;
      if (value.primaryCount !== undefined) orderedValue.primaryCount = value.primaryCount;
      orderedScopes[key] = orderedValue;
    }
    return JSON.stringify({ version: WORKSPACE_LAYOUT_VERSION, scopes: orderedScopes });
  }

  private utf8ByteLength(value: string): number {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length &&
               value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    }
    return bytes;
  }

  private assertNoDuplicateJsonKeys(serialized: string): void {
    let offset = 0;
    const skipWhitespace = (): void => {
      while (offset < serialized.length && /\s/.test(serialized[offset])) offset++;
    };
    const parseString = (): string => {
      const start = offset;
      if (serialized[offset] !== '"') throw new Error("invalid JSON string");
      offset++;
      let escaped = false;
      while (offset < serialized.length) {
        const char = serialized[offset++];
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          return JSON.parse(serialized.slice(start, offset)) as string;
        }
      }
      throw new Error("unterminated JSON string");
    };
    const parseValue = (): void => {
      skipWhitespace();
      if (serialized[offset] === "{") {
        parseObject();
      } else if (serialized[offset] === "[") {
        offset++;
        skipWhitespace();
        if (serialized[offset] === "]") {
          offset++;
          return;
        }
        while (offset < serialized.length) {
          parseValue();
          skipWhitespace();
          if (serialized[offset] === "]") {
            offset++;
            return;
          }
          if (serialized[offset] !== ",") throw new Error("invalid JSON array");
          offset++;
        }
      } else if (serialized[offset] === '"') {
        parseString();
      } else {
        const start = offset;
        while (offset < serialized.length && !/[\s,\]}]/.test(serialized[offset])) offset++;
        if (offset === start) throw new Error("invalid JSON value");
      }
    };
    const parseObject = (): void => {
      const keys = new Set<string>();
      offset++;
      skipWhitespace();
      if (serialized[offset] === "}") {
        offset++;
        return;
      }
      while (offset < serialized.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new Error(`duplicate JSON key '${key}'`);
        keys.add(key);
        skipWhitespace();
        if (serialized[offset] !== ":") throw new Error("invalid JSON object");
        offset++;
        parseValue();
        skipWhitespace();
        if (serialized[offset] === "}") {
          offset++;
          return;
        }
        if (serialized[offset] !== ",") throw new Error("invalid JSON object");
        offset++;
      }
    };

    parseValue();
    skipWhitespace();
    if (offset !== serialized.length) throw new Error("trailing JSON content");
  }

  private applyWorkspaceLayoutOverrides(): void {
    for (const ws of this.workspaces.values()) {
      const override = this.workspaceLayoutOverrides.get(ws.scopeKey) ||
        this.workspaceLayoutOverrides.get(getWorkspaceScopeKey("*", ws.desktopId));
      ws.activeLayout = (override?.layout as WorkspaceLayoutState["activeLayout"]) || this.config.defaultLayout;
      ws.primaryRegionCount = override?.primaryCount ?? this.config.primaryRegionCount ?? this.config.masterCount;
      ws.primaryRegionRatio = override?.ratio ?? this.config.primaryRegionRatio ?? this.config.masterRatio;
    }
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
      screen.activeActivityId = input.activeActivityId;
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

  private removeWindowFromOutputWorkspaces(windowId: RuntimeWindowId, outputId: string): void {
    for (const ws of this.workspaces.values()) {
      if (ws.outputId !== outputId) continue;
      let idx = ws.orderedSlotWindowIds.indexOf(windowId);
      while (idx !== -1) {
        ws.orderedSlotWindowIds.splice(idx, 1);
        idx = ws.orderedSlotWindowIds.indexOf(windowId);
      }
    }
  }

  private addWindowToApplicableWorkspaces(
    win: RetainedWindowState,
    outputId: string = win.outputId,
    activeDesktopId?: string
  ): void {
    const desktopIds = win.desktopIds.length > 0 ? win.desktopIds : [win.desktopId || "1"];
    let targets: string[];
    if (this.config.perDesktopLayout === false) {
      targets = [GLOBAL_DESKTOP_SCOPE];
    } else if (win.onAllDesktops) {
      const screen = this.screens.get(outputId);
      targets = [activeDesktopId || screen?.activeDesktopId || win.desktopId || "1"];
    } else {
      targets = [...new Set(desktopIds)];
    }

    for (const desktopId of targets) {
      const ws = this.getOrCreateWorkspace(outputId, desktopId);
      if (!ws.orderedSlotWindowIds.includes(win.id)) {
        ws.orderedSlotWindowIds.push(win.id);
      }
    }
  }

  private rebuildWorkspaceMemberships(): void {
    for (const ws of this.workspaces.values()) {
      ws.orderedSlotWindowIds = [];
    }
    for (const win of this.windows.values()) {
      this.addWindowToApplicableWorkspaces(win);
    }
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

        this.addWindowToApplicableWorkspaces(retained, outputId);

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
        const prevManualFloating = win.isManualFloating;
        const prevMinimized = win.minimized;
        const prevFullScreen = win.fullScreen;
        const prevMaximizeMode = win.maximizeMode;
        let membershipChanged = false;

        if (event.updates.resourceClass !== undefined) win.resourceClass = event.updates.resourceClass;
        if (event.updates.resourceName !== undefined) win.resourceName = event.updates.resourceName;
        if (event.updates.appId !== undefined) win.appId = event.updates.appId;
        if (event.updates.desktopFileName !== undefined) win.desktopFileName = event.updates.desktopFileName;
        if (event.updates.title !== undefined) win.title = event.updates.title;
        if (event.updates.role !== undefined) win.role = event.updates.role;
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
        if (event.updates.fullScreen !== undefined) {
          win.fullScreen = event.updates.fullScreen;
        }
        if (event.updates.noBorder !== undefined) {
          win.noBorder = event.updates.noBorder;
        }
        if (event.updates.maximizeMode !== undefined) {
          win.maximizeMode = event.updates.maximizeMode;
        }
        if (event.updates.isManualFloating !== undefined) {
          win.isManualFloating = event.updates.isManualFloating;
        }
        if (event.updates.isDragging !== undefined) {
          win.isDragging = event.updates.isDragging;
        }
        if (event.updates.isPreTiled !== undefined) {
          win.isPreTiled = event.updates.isPreTiled;
        }
        if (event.updates.outputAffinity !== undefined) {
          win.outputAffinity = event.updates.outputAffinity;
        }
        if (event.updates.onAllDesktops !== undefined && event.updates.onAllDesktops !== win.onAllDesktops) {
          win.onAllDesktops = event.updates.onAllDesktops;
          membershipChanged = true;
        }
        if (event.updates.desktopIds !== undefined) {
          const nextDesktopIds = [...event.updates.desktopIds];
          if (nextDesktopIds.length !== win.desktopIds.length ||
              nextDesktopIds.some(id => !win.desktopIds.includes(id))) {
            membershipChanged = true;
          }
          win.desktopIds = nextDesktopIds;
          if (nextDesktopIds.length > 0) win.desktopId = nextDesktopIds[0];
        }
        if (event.updates.activities !== undefined) {
          const nextActivities = [...event.updates.activities];
          win.activities = nextActivities;
          win.activityId = nextActivities[0];
        }

        if (membershipChanged) {
          this.removeWindowFromOutputWorkspaces(win.id, win.outputId);
          this.addWindowToApplicableWorkspaces(win);
        }

        const screen = this.screens.get(win.outputId);
        const newClassResult = this.classifyWindow({
          id: win.id,
          resourceClass: win.resourceClass,
          resourceName: win.resourceName,
          appId: win.appId,
          desktopFileName: win.desktopFileName,
          title: win.title,
          role: win.role,
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

        const layoutAffectingStateChanged =
          (prevTileable !== win.tileable) ||
          (prevClass !== win.classification) ||
          (prevManualFloating !== win.isManualFloating) ||
          (prevMinimized !== win.minimized) ||
          (prevFullScreen !== win.fullScreen) ||
          (prevMaximizeMode !== win.maximizeMode) ||
          membershipChanged;

        if (layoutAffectingStateChanged) {
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

        // Clean up every prior scope on the source output before reindexing the
        // window on the destination output.
        this.removeWindowFromOutputWorkspaces(event.windowId, event.fromOutputId);
        const oldScreen = this.screens.get(event.fromOutputId);
        if (oldScreen) {
          oldScreen.dirtyReasons.add("WindowMovedOutputSource");
          this.dirtyScreenIds.add(oldScreen.outputId);
        }

        if (win) this.addWindowToApplicableWorkspaces(win, event.toOutputId);

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
          const newDeskId = event.toDesktopId;
          win.desktopId = newDeskId;
          win.desktopIds = [newDeskId];
          win.onAllDesktops = false;

          this.removeWindowFromOutputWorkspaces(event.windowId, win.outputId);
          this.addWindowToApplicableWorkspaces(win);

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
        const unchanged = newSticky === win.onAllDesktops &&
          newDesks.length === win.desktopIds.length &&
          newDesks.every(id => win.desktopIds.includes(id));
        if (unchanged) return { dirty: false, affectedScreens: [], isEcho: false };
        win.desktopIds = newDesks;
        win.onAllDesktops = newSticky;
        if (newDesks.length > 0) {
          win.desktopId = newDesks[0];
        }

        // Reconcile workspace memberships on win.outputId. Sticky windows are
        // represented only in the currently active desktop scope, preventing
        // visited desktops from accumulating stale copies.
        const activeDesktopId = this.screens.get(win.outputId)?.activeDesktopId || win.desktopId;
        for (const ws of this.workspaces.values()) {
          if (ws.outputId !== win.outputId) continue;
          const inMembership = this.config.perDesktopLayout === false
            ? ws.desktopId === GLOBAL_DESKTOP_SCOPE
            : (newSticky ? ws.desktopId === activeDesktopId : newDesks.includes(ws.desktopId));
          const idx = ws.orderedSlotWindowIds.indexOf(event.windowId);
          if (inMembership && idx === -1) {
            ws.orderedSlotWindowIds.push(event.windowId);
          } else if (!inMembership && idx !== -1) {
            ws.orderedSlotWindowIds.splice(idx, 1);
          }
        }

        // Also ensure all new desktops have workspace objects created and populated
        this.addWindowToApplicableWorkspaces(win, win.outputId, activeDesktopId);

        this.markScreenDirty(win.outputId, "WindowDesktopsChanged");
        return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
      }

      case "WindowActivitiesChanged": {
        const win = this.windows.get(event.windowId);
        if (!win) return { dirty: false, affectedScreens: [], isEcho: false };
        const unchanged = event.activities.length === win.activities.length &&
          event.activities.every(id => win.activities.includes(id));
        if (unchanged) return { dirty: false, affectedScreens: [], isEcho: false };
        win.activities = [...event.activities];
        win.activityId = event.activities.length > 0 ? event.activities[0] : undefined;
        this.markScreenDirty(win.outputId, "WindowActivitiesChanged");
        return { dirty: true, affectedScreens: [win.outputId], isEcho: false };
      }

      case "ScreenDesktopChanged": {
        const screen = this.screens.get(event.outputId);
        if (screen) {
          if (screen.activeDesktopId === event.toDesktopId) {
            return { dirty: false, affectedScreens: [], isEcho: false };
          }
          screen.activeDesktopId = event.toDesktopId;
          // Move each sticky membership to exactly the newly active desktop scope.
          for (const win of this.windows.values()) {
            if (win.outputId === event.outputId && win.onAllDesktops) {
              this.removeWindowFromOutputWorkspaces(win.id, event.outputId);
              this.addWindowToApplicableWorkspaces(win, event.outputId, event.toDesktopId);
            }
          }
          this.markScreenDirty(event.outputId, "ScreenDesktopChanged");
          return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
        }
        return { dirty: false, affectedScreens: [], isEcho: false };
      }

      case "ScreenTopologyChanged": {
        const seenIds = new Set<string>();
        const affectedIds = new Set<string>();
        for (const s of event.screens) {
          seenIds.add(s.outputId);
          const existing = this.screens.get(s.outputId);
          const changed = !existing ||
            existing.name !== (s.name || s.outputId) ||
            !rectEqualsWithTolerance(existing.geometry, s.geometry, 0) ||
            !rectEqualsWithTolerance(existing.usableArea, s.usableArea, 0) ||
            existing.activeDesktopId !== (s.activeDesktopId || "1") ||
            existing.activeActivityId !== s.activeActivityId;
          this.getOrCreateScreen(s);
          if (changed) affectedIds.add(s.outputId);
        }

        for (const win of this.windows.values()) {
          if (win.onAllDesktops && affectedIds.has(win.outputId)) {
            this.removeWindowFromOutputWorkspaces(win.id, win.outputId);
            this.addWindowToApplicableWorkspaces(win);
          }
        }
        // Remove screens that no longer exist
        for (const existingId of this.screens.keys()) {
          if (!seenIds.has(existingId)) {
            affectedIds.add(existingId);
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
              const oldOutputId = win.outputId;
              const newOutputId = resolveScreenAffinity({
                explicitOutputId: undefined,
                frameGeometry: win.frameGeometry,
                previousOutputId: win.outputAffinity,
                screens: remainingScreens
              });
              this.removeWindowFromOutputWorkspaces(win.id, oldOutputId);
              win.outputId = newOutputId;
              win.outputAffinity = newOutputId;
              this.addWindowToApplicableWorkspaces(win, newOutputId);
              affectedIds.add(newOutputId);
            }
          }
        }


        for (const [key, ws] of this.workspaces.entries()) {
          if (!seenIds.has(ws.outputId)) this.workspaces.delete(key);
        }

        const liveAffectedIds = Array.from(affectedIds).filter(id => this.screens.has(id));
        for (const outputId of liveAffectedIds) {
          this.markScreenDirty(outputId, "ScreenTopologyChanged");
        }
        if (affectedIds.size > 0) this.pendingReasons.add("ScreenTopologyChanged");
        return {
          dirty: affectedIds.size > 0,
          affectedScreens: Array.from(affectedIds),
          isEcho: false
        };
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
        const isCrossOutput = oldOutputId !== event.outputId;

        // Sticky windows always track the target screen's active desktop.
        // Non-sticky windows adopt explicit event.desktopId if provided, or preserve their desktopId.
        const targetDesktopId = win.onAllDesktops
          ? (targetScreen?.activeDesktopId || win.desktopId || "1")
          : (event.desktopId || win.desktopId || "1");

        // Clean up old workspace memberships
        if (isCrossOutput) {
          this.removeWindowFromOutputWorkspaces(event.windowId, oldOutputId);
        }

        const currentDesktops = win.desktopIds.length > 0 ? win.desktopIds : (win.desktopId ? [win.desktopId] : ["1"]);
        const isExplicitNewDesktop = Boolean(!win.onAllDesktops && event.desktopId && !currentDesktops.includes(event.desktopId));

        if (isExplicitNewDesktop) {
          // Explicit target desktop specified: clean any stale source memberships on target output
          this.removeWindowFromOutputWorkspaces(event.windowId, event.outputId);
          win.desktopId = event.desktopId!;
          win.desktopIds = [event.desktopId!];
        } else if (!win.onAllDesktops && event.desktopId) {
          win.desktopId = event.desktopId;
        } else if (win.onAllDesktops) {
          // Sticky window: ensure it is only in the target screen's active desktop workspace
          this.removeWindowFromOutputWorkspaces(event.windowId, event.outputId);
        }

        win.outputId = event.outputId;
        win.outputAffinity = event.outputId;
        win.isDragging = false;
        win.isManualFloating = false;
        win.tileable = true;
        win.classification = "tiled";
        win.currentDesiredTiledGeometry = { ...event.targetRect };
        this.setSavedTiledGeometry(event.windowId, event.targetRect);

        // Populate applicable workspaces
        this.addWindowToApplicableWorkspaces(win, event.outputId, targetDesktopId);

        // Position window at target slot in target workspace without duplicates
        const targetWs = this.getOrCreateWorkspace(event.outputId, targetDesktopId);
        let curIdx = targetWs.orderedSlotWindowIds.indexOf(event.windowId);
        while (curIdx !== -1) {
          targetWs.orderedSlotWindowIds.splice(curIdx, 1);
          curIdx = targetWs.orderedSlotWindowIds.indexOf(event.windowId);
        }

        const boundedSlot = (event.slotIndex !== undefined && event.slotIndex >= 0)
          ? Math.min(event.slotIndex, targetWs.orderedSlotWindowIds.length)
          : targetWs.orderedSlotWindowIds.length;
        targetWs.orderedSlotWindowIds.splice(boundedSlot, 0, event.windowId);

        this.markScreenDirty(event.outputId, "WindowSnapCommitted");
        const affected = [event.outputId];
        if (isCrossOutput && oldOutputId) {
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
   * Clears an in-flight command record if the programmatic geometry assignment failed or was rolled back.
   */
  public clearRecordedCommand(windowId: RuntimeWindowId): void {
    this.inFlightEchoes.delete(windowId);
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
      const belongsToActivity = !screen.activeActivityId ||
        win.activities.length === 0 ||
        win.activities.includes(screen.activeActivityId);
      if (!belongsToActivity) continue;
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
   * or skips the write (0 operations) if the window is already at targetRect.
   * Unaffected screens produce 0 writes.
   * Echo suppression is armed solely by the commit boundary when geometry is written.
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
