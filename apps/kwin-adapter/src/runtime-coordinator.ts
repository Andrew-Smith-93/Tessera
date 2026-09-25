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
  WindowClassificationResult,
  CustomRule
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
import {
  getOrCreateRuleEngine,
  validateCustomRules,
  resetRuleEngineState,
  recordCustomRules
} from "./qml-rules-compat.js";
import { resolveScreenAffinity } from "./screen-affinity.js";
import { computeSnapZones } from "./snap-zones.js";
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

function resolveSafeActiveLayout(_layout: unknown): WorkspaceLayoutState["activeLayout"] {
  // All legacy algorithms (primary-stack, monocle, floating, binary-split,
  // columns, rows) deliberately migrate to the canonical active layout.
  // Note: supported gameWindowPolicy is distinct and handled per window.
  return "balanced-grid";
}

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
  private lastCustomRuleErrors: string[] = [];
  private lastValidCustomRules: CustomRule[] = [];
  private hasPriorValidRules = false;

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
      defaultLayout: resolveSafeActiveLayout(initialConfig?.defaultLayout),
      gapInner: initialConfig?.gapInner ?? 8,
      gapOuter: initialConfig?.gapOuter ?? 10,
      primaryRegionRatio: effRatio,
      primaryRegionCount: effCount,
      masterRatio: effRatio,
      masterCount: effCount,
      perDesktopLayout: initialConfig?.perDesktopLayout ?? true,
      ignoreMinimized: initialConfig?.ignoreMinimized ?? true,
      gameWindowPolicy: initialConfig?.gameWindowPolicy ?? "floating",
      floatFilter: initialConfig?.floatFilter ?? "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1",
      customRules: initialConfig?.customRules ?? "[]",
      workspaceLayoutsJson: initialConfig?.workspaceLayoutsJson ?? "{\"version\":1,\"scopes\":{}}",
      customGamePatterns: initialConfig?.customGamePatterns ?? [],
      geometryTolerancePx: initialConfig?.geometryTolerancePx ?? DEFAULT_GEOMETRY_TOLERANCE_PX,
      echoExpiryMs: initialConfig?.echoExpiryMs ?? DEFAULT_ECHO_EXPIRY_MS
    };
    if (initialConfig?.customRules !== undefined) {
      const val = validateCustomRules(initialConfig.customRules);
      if (val.valid) {
        this.lastValidCustomRules = [...val.rules];
        this.hasPriorValidRules = val.rules.length > 0;
        this.lastCustomRuleErrors = [];
        recordCustomRules(val.rules);
      } else {
        this.lastCustomRuleErrors = [...val.errors];
        this.lastValidCustomRules = [];
        this.hasPriorValidRules = false;
      }
    }
    this.loadWorkspaceLayoutsJson(initialConfig?.workspaceLayoutsJson);
  }

  public getConfig(): CoordinatorConfig {
    return { ...this.config };
  }

  public getLastCustomRuleErrors(): string[] {
    return [...this.lastCustomRuleErrors];
  }

  public validateCustomRules(rules: unknown) {
    return validateCustomRules(rules);
  }

  public getLastValidCustomRules(): CustomRule[] {
    return [...this.lastValidCustomRules];
  }

  public hasPriorValidCustomRules(): boolean {
    return this.hasPriorValidRules && this.lastValidCustomRules.length > 0;
  }

  public resetRuleEngineState(): void {
    resetRuleEngineState();
    this.lastCustomRuleErrors = [];
    this.lastValidCustomRules = [];
    this.hasPriorValidRules = false;
  }

  public updateConfig(updates: Partial<CoordinatorConfig>): void {
    const previousPerDesktopLayout = this.config.perDesktopLayout;
    const effRatio = updates.primaryRegionRatio !== undefined
      ? updates.primaryRegionRatio
      : (updates.masterRatio !== undefined ? updates.masterRatio : this.config.masterRatio);
    const effCount = updates.primaryRegionCount !== undefined
      ? updates.primaryRegionCount
      : (updates.masterCount !== undefined ? updates.masterCount : this.config.masterCount);

    if (updates.customRules !== undefined) {
      const val = validateCustomRules(updates.customRules);
      if (val.valid) {
        this.lastValidCustomRules = [...val.rules];
        if (val.rules.length > 0) {
          this.hasPriorValidRules = true;
        } else if (updates.customRules === "[]" || (Array.isArray(updates.customRules) && updates.customRules.length === 0)) {
          this.hasPriorValidRules = false;
        }
        this.lastCustomRuleErrors = [];
        recordCustomRules(val.rules);
      } else {
        this.lastCustomRuleErrors = [...val.errors];
      }
    }

    this.config = Object.assign(
      {},
      this.config,
      updates,
      {
        defaultLayout: updates.defaultLayout !== undefined ? resolveSafeActiveLayout(updates.defaultLayout) : this.config.defaultLayout,
        primaryRegionRatio: effRatio,
        primaryRegionCount: effCount,
        masterRatio: effRatio,
        masterCount: effCount
      }
    );
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
        activeLayout: resolveSafeActiveLayout(override?.layout || this.config.defaultLayout),
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
      ws.activeLayout = resolveSafeActiveLayout(override?.layout || this.config.defaultLayout);
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
          self.getOrCreateWorkspace(input.outputId, this.activeDesktopId).activeLayout = resolveSafeActiveLayout(l);
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
      customRules: this.lastValidCustomRules,
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
          unachievableAttempts: 0,
          lastAttemptObservedGeometry: null,
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
          win.lastRequestedGeometry = null;
          win.unachievableAttempts = 0;
          win.lastAttemptObservedGeometry = null;
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
          win.lastRequestedGeometry = null;
          win.unachievableAttempts = 0;
          win.lastAttemptObservedGeometry = null;
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
        ws.activeLayout = resolveSafeActiveLayout(event.layout);
        this.markScreenDirty(event.outputId, "ScreenLayoutChanged");
        return { dirty: true, affectedScreens: [event.outputId], isEcho: false };
      }

      case "WorkspaceLayoutChanged": {
        const ws = this.getOrCreateWorkspace(event.outputId, event.desktopId);
        ws.activeLayout = resolveSafeActiveLayout(event.layout);
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
        win.snapRegion = event.snapRegion;
        win.currentDesiredTiledGeometry = { ...event.targetRect };
        win.customTiledGeometry = null;
        win.isExplicitSnap = true;
        win.snapEpoch = this.totalNormalizedEvents;
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
    const exactMatch = rectEqualsWithTolerance(entry.target, newGeometry, tolerance);
    // Allow discrete size hint / character cell increment tolerance (same origin, dimension delta <= 32px)
    const clampedMatch =
      Math.abs(newGeometry.x - entry.target.x) <= tolerance &&
      Math.abs(newGeometry.y - entry.target.y) <= tolerance &&
      Math.abs(newGeometry.width - entry.target.width) <= 32 &&
      Math.abs(newGeometry.height - entry.target.height) <= 32;

    if (exactMatch || clampedMatch) {
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
   * Checks whether an in-flight command is currently recorded for the window.
   */
  public hasRecordedCommand(windowId: RuntimeWindowId): boolean {
    return this.inFlightEchoes.has(windowId);
  }

  /**
   * Retrieves an in-flight command record if present.
   */
  public getRecordedCommand(windowId: RuntimeWindowId): InFlightEcho | undefined {
    return this.inFlightEchoes.get(windowId);
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

  private resolveRegionOccupancy(
    _screen: RetainedScreenState,
    tileableWindows: readonly RetainedWindowState[],
    area: Rect,
    gaps: { inner: number; outer: number }
  ): Map<RuntimeWindowId, Rect> {
    const solution = new Map<RuntimeWindowId, Rect>();
    const zones = computeSnapZones(area, gaps.outer, gaps.inner);
    const zoneMap = new Map<string, Rect>();
    for (const z of zones) {
      zoneMap.set(z.id, z.targetRect);
    }

    // Register pillar split sub-zones in zoneMap for pure 3-pillar occupancy
    const leftPillar = zoneMap.get("left-pillar");
    const rightPillar = zoneMap.get("right-pillar");
    const hh = Math.floor((area.height - gaps.outer * 2 - gaps.inner) / 2);
    if (leftPillar) {
      const topH = hh;
      const botY = leftPillar.y + topH + gaps.inner;
      zoneMap.set("left-pillar-top", {
        x: leftPillar.x,
        y: leftPillar.y,
        width: leftPillar.width,
        height: topH
      });
      zoneMap.set("left-pillar-bottom", {
        x: leftPillar.x,
        y: botY,
        width: leftPillar.width,
        height: Math.max(30, (leftPillar.y + leftPillar.height) - botY)
      });
    }
    if (rightPillar) {
      const topH = hh;
      const botY = rightPillar.y + topH + gaps.inner;
      zoneMap.set("right-pillar-top", {
        x: rightPillar.x,
        y: rightPillar.y,
        width: rightPillar.width,
        height: topH
      });
      zoneMap.set("right-pillar-bottom", {
        x: rightPillar.x,
        y: botY,
        width: rightPillar.width,
        height: Math.max(30, (rightPillar.y + rightPillar.height) - botY)
      });
    }

    // Bounds validation for custom geometry
    const validateCustomGeometry = (customRect: Rect): Rect | null => {
      if (!customRect || customRect.width <= 0 || customRect.height <= 0) {
        return null;
      }
      if (
        customRect.x + customRect.width <= area.x ||
        customRect.x >= area.x + area.width ||
        customRect.y + customRect.height <= area.y ||
        customRect.y >= area.y + area.height
      ) {
        return null;
      }
      const minW = Math.min(60, area.width);
      const minH = Math.min(40, area.height);
      const x = Math.max(area.x, Math.min(area.x + area.width - minW, customRect.x));
      const y = Math.max(area.y, Math.min(area.y + area.height - minH, customRect.y));
      const maxW = area.x + area.width - x;
      const maxH = area.y + area.height - y;
      const width = Math.max(minW, Math.min(maxW, customRect.width));
      const height = Math.max(minH, Math.min(maxH, customRect.height));
      return { x, y, width, height };
    };

    // Step 1: Infer or assign candidate regions for each window
    interface WindowCandidate {
      win: RetainedWindowState;
      region: string;
      customRect?: Rect;
      priority: number;
      snapEpoch: number;
    }
    const candidates: WindowCandidate[] = [];

    const hasRightSnap = tileableWindows.some(w => Boolean(w.snapRegion && (w.snapRegion.includes("right") || w.snapRegion.includes("pillar-2"))));
    const hasLeftSnap = tileableWindows.some(w => Boolean(w.snapRegion && (w.snapRegion.includes("left") || w.snapRegion.includes("pillar-0"))));

    for (const win of tileableWindows) {
      if (win.customTiledGeometry) {
        const validated = validateCustomGeometry(win.customTiledGeometry);
        if (!validated) {
          win.customTiledGeometry = null;
        } else {
          win.customTiledGeometry = validated;
          candidates.push({
            win,
            region: win.snapRegion || "custom",
            customRect: validated,
            priority: 2,
            snapEpoch: win.snapEpoch || 0
          });
          continue;
        }
      }

      if (win.snapRegion && zoneMap.has(win.snapRegion)) {
        candidates.push({
          win,
          region: win.snapRegion,
          priority: win.isExplicitSnap ? 1 : 0.5,
          snapEpoch: win.snapEpoch || 0
        });
        continue;
      }

      // Infer region from observed geometry or existing slot
      const geom = win.currentDesiredTiledGeometry || win.frameGeometry;
      let inferred = "left-half";
      if (geom && geom.width > 50 && geom.height > 50) {
        const cx = geom.x + geom.width / 2;
        const cy = geom.y + geom.height / 2;
        const isTall = geom.height >= area.height * 0.70;
        const isFullWidth = geom.width >= area.width * 0.80;
        if (isFullWidth) {
          inferred = hasRightSnap ? "left-half" : (hasLeftSnap ? "right-half" : "left-half");
        } else if (isTall) {
          if (cx < area.x + area.width * 0.33) {
            inferred = "left-pillar";
          } else if (cx > area.x + area.width * 0.66) {
            inferred = "right-pillar";
          } else if (geom.width < area.width * 0.40) {
            inferred = "center-pillar";
          } else if (cx < area.x + area.width * 0.5) {
            inferred = "left-half";
          } else {
            inferred = "right-half";
          }
        } else {
          if (cx < area.x + area.width * 0.5) {
            inferred = (cy < area.y + area.height * 0.5) ? "top-left" : "bottom-left";
          } else {
            inferred = (cy < area.y + area.height * 0.5) ? "top-right" : "bottom-right";
          }
        }
      } else {
        const occupiedRegions = new Set(candidates.map(c => c.region));
        if (!occupiedRegions.has("left-half") && !occupiedRegions.has("top-left") && !occupiedRegions.has("bottom-left")) {
          inferred = "left-half";
        } else if (!occupiedRegions.has("right-half") && !occupiedRegions.has("top-right") && !occupiedRegions.has("bottom-right")) {
          inferred = "right-half";
        } else if (!occupiedRegions.has("top-right")) {
          inferred = "top-right";
        } else if (!occupiedRegions.has("bottom-right")) {
          inferred = "bottom-right";
        }
      }

      win.snapRegion = inferred;
      candidates.push({
        win,
        region: inferred,
        priority: 0,
        snapEpoch: 0
      });
    }

    // Step 2: Deterministic cross-family geometric collision resolution
    const rectsOverlap = (r1: Rect, r2: Rect): boolean => {
      const xOverlap = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
      const yOverlap = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
      return (xOverlap * yOverlap) > 100;
    };

    // Sort candidates so higher priority windows (custom, then explicit snap, then newest) are prioritized
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (b.snapEpoch || 0) - (a.snapEpoch || 0);
    });

    const getRegionPreferences = (region: string): string[] => {
      switch (region) {
        case "left-half":
          return [
            "left-half", "left-pillar",
            "top-left", "bottom-left",
            "right-half", "right-pillar",
            "top-right", "bottom-right",
            "center-pillar", "center-top", "center-bottom"
          ];
        case "right-half":
          return [
            "right-half", "right-pillar",
            "top-right", "bottom-right",
            "left-half", "left-pillar",
            "top-left", "bottom-left",
            "center-pillar", "center-top", "center-bottom"
          ];
        case "top-left":
          return [
            "top-left", "left-pillar-top",
            "bottom-left", "left-pillar-bottom",
            "left-pillar", "left-half",
            "center-bottom", "right-pillar",
            "right-half", "top-right", "bottom-right",
            "right-pillar-top", "right-pillar-bottom",
            "center-pillar", "center-top"
          ];
        case "bottom-left":
          return [
            "bottom-left", "left-pillar-bottom",
            "top-left", "left-pillar-top",
            "left-pillar", "left-half",
            "center-top", "right-pillar",
            "right-half", "bottom-right", "top-right",
            "right-pillar-bottom", "right-pillar-top",
            "center-pillar", "center-bottom"
          ];
        case "top-right":
          return [
            "top-right", "right-pillar-top",
            "bottom-right", "right-pillar-bottom",
            "right-pillar", "right-half",
            "center-bottom", "left-pillar",
            "left-half", "top-left", "bottom-left",
            "left-pillar-top", "left-pillar-bottom",
            "center-pillar", "center-top"
          ];
        case "bottom-right":
          return [
            "bottom-right", "right-pillar-bottom",
            "top-right", "right-pillar-top",
            "right-pillar", "right-half",
            "center-top", "left-pillar",
            "left-half", "bottom-left", "top-left",
            "left-pillar-bottom", "left-pillar-top",
            "center-pillar", "center-bottom"
          ];
        case "left-pillar":
          return [
            "left-pillar",
            "center-pillar", "right-pillar",
            "center-top", "center-bottom",
            "left-half", "right-half",
            "top-left", "bottom-left",
            "top-right", "bottom-right"
          ];
        case "right-pillar":
          return [
            "right-pillar",
            "center-pillar", "left-pillar",
            "center-top", "center-bottom",
            "right-half", "left-half",
            "top-right", "bottom-right",
            "top-left", "bottom-left"
          ];
        case "center-pillar":
          return [
            "center-pillar", "center-top", "center-bottom",
            "left-pillar", "right-pillar",
            "left-half", "right-half",
            "top-left", "bottom-left",
            "top-right", "bottom-right"
          ];
        case "center-top":
          return [
            "center-top", "center-bottom",
            "left-pillar-top", "right-pillar-top",
            "left-pillar", "right-pillar",
            "top-left", "top-right",
            "left-pillar-bottom", "right-pillar-bottom",
            "center-pillar", "left-half", "right-half",
            "bottom-left", "bottom-right"
          ];
        case "center-bottom":
          return [
            "center-bottom", "center-top",
            "left-pillar-bottom", "right-pillar-bottom",
            "left-pillar", "right-pillar",
            "bottom-left", "bottom-right",
            "left-pillar-top", "right-pillar-top",
            "center-pillar", "left-half", "right-half",
            "top-left", "top-right"
          ];
        default:
          return [region];
      }
    };

    const accepted: WindowCandidate[] = [];

    const adaptPeersForCenter = (centerRegion: string) => {
      // Protect accepted[0] (the newest requested target) from being remapped by peers
      for (let i = 1; i < accepted.length; i++) {
        const a = accepted[i];
        if (centerRegion === "center-top" || centerRegion === "center-pillar") {
          if (a.region === "top-left") a.region = "left-pillar-top";
          if (a.region === "top-right") a.region = "right-pillar-top";
          if (a.region === "left-half") a.region = "left-pillar";
          if (a.region === "right-half") a.region = "right-pillar";
        }
        if (centerRegion === "center-bottom" || centerRegion === "center-pillar") {
          if (a.region === "bottom-left") a.region = "left-pillar-bottom";
          if (a.region === "bottom-right") a.region = "right-pillar-bottom";
          if (a.region === "left-half") a.region = "left-pillar";
          if (a.region === "right-half") a.region = "right-pillar";
        }
      }
    };

    for (const cand of candidates) {
      if (accepted.length === 0) {
        accepted.push(cand);
        if (!cand.win.isExplicitSnap) {
          cand.win.snapRegion = cand.region;
        }
        continue;
      }

      // Check customRect if present
      if (cand.customRect) {
        const collidesWithAccepted = accepted.some(a => {
          const aRect = a.customRect || zoneMap.get(a.region) || area;
          return rectsOverlap(cand.customRect!, aRect);
        });
        if (!collidesWithAccepted) {
          accepted.push(cand);
          continue;
        }
        cand.customRect = undefined;
        cand.win.customTiledGeometry = null;
      }

      // Intentional center split: if a window wants center-pillar (or center-top/center-bottom)
      // and another window already occupies center
      if (cand.region === "center-pillar") {
        const existingFull = accepted.find(a => a.region === "center-pillar");
        if (existingFull) {
          existingFull.region = "center-top";
          cand.region = "center-bottom";
          adaptPeersForCenter("center-top");
          adaptPeersForCenter("center-bottom");
          accepted.push(cand);
          continue;
        }
        const existingTop = accepted.find(a => a.region === "center-top");
        const existingBottom = accepted.find(a => a.region === "center-bottom");
        if (existingTop && !existingBottom) {
          const rRect = zoneMap.get("center-bottom");
          if (rRect && !accepted.some(a => rectsOverlap(rRect, a.customRect || zoneMap.get(a.region) || area))) {
            cand.region = "center-bottom";
            adaptPeersForCenter("center-bottom");
            accepted.push(cand);
            continue;
          }
        }
        if (existingBottom && !existingTop) {
          const rRect = zoneMap.get("center-top");
          if (rRect && !accepted.some(a => rectsOverlap(rRect, a.customRect || zoneMap.get(a.region) || area))) {
            cand.region = "center-top";
            adaptPeersForCenter("center-top");
            accepted.push(cand);
            continue;
          }
        }
      } else if (cand.region === "center-top") {
        const existingFull = accepted.find(a => a.region === "center-pillar");
        if (existingFull) {
          existingFull.region = "center-bottom";
          cand.region = "center-top";
          adaptPeersForCenter("center-top");
          adaptPeersForCenter("center-bottom");
          accepted.push(cand);
          continue;
        }
      } else if (cand.region === "center-bottom") {
        const existingFull = accepted.find(a => a.region === "center-pillar");
        if (existingFull) {
          existingFull.region = "center-top";
          cand.region = "center-bottom";
          adaptPeersForCenter("center-top");
          adaptPeersForCenter("center-bottom");
          accepted.push(cand);
          continue;
        }
      }

      const prefs = getRegionPreferences(cand.region);

      // Pass 1: find an unoccupied region in prefs that does NOT overlap any accepted window
      let chosen: string | null = null;
      for (const r of prefs) {
        const rRect = zoneMap.get(r);
        if (!rRect) continue;
        const isOccupied = accepted.some(a => a.region === r);
        if (isOccupied) continue;

        const collidesWithAny = accepted.some(a => {
          const aRect = a.customRect || zoneMap.get(a.region) || area;
          return rectsOverlap(rRect, aRect);
        });
        if (!collidesWithAny) {
          chosen = r;
          break;
        }
      }

      // Pass 2: find a region in prefs where sharing does NOT overlap any OTHER accepted window
      // AND does not subdivide accepted[0] (the newest requested target) if other accepted windows exist
      if (!chosen) {
        for (const r of prefs) {
          const rRect = zoneMap.get(r);
          if (!rRect) continue;

          // If there are multiple accepted windows, protect accepted[0] from subdivision
          if (accepted.length > 1) {
            const newest = accepted[0];
            const newestRect = newest.customRect || zoneMap.get(newest.region) || area;
            if (r === newest.region || rectsOverlap(rRect, newestRect)) {
              continue; // Protect the newest accepted target from subdivision
            }
          }

          const collidesWithOther = accepted.some(a => {
            if (a.region === r) return false; // same region will be sliced!
            const aRect = a.customRect || zoneMap.get(a.region) || area;
            return rectsOverlap(rRect, aRect);
          });
          if (!collidesWithOther) {
            chosen = r;
            break;
          }
        }
      }

      // Pass 2 fallback: if no region in prefs avoided subdividing accepted[0],
      // try sharing with one of the older accepted windows
      if (!chosen && accepted.length > 1) {
        const newest = accepted[0];
        const newestRect = newest.customRect || zoneMap.get(newest.region) || area;
        for (let i = 1; i < accepted.length; i++) {
          const older = accepted[i];
          const olderRect = older.customRect || zoneMap.get(older.region) || area;
          if (!rectsOverlap(olderRect, newestRect) && older.region !== newest.region) {
            chosen = older.region;
            break;
          }
        }
      }

      // Pass 3: fail-safe
      if (!chosen) {
        if (accepted.length > 1) {
          chosen = accepted[accepted.length - 1].region;
        } else {
          chosen = accepted[0].region;
        }
      }

      cand.region = chosen;
      if (chosen && chosen.startsWith("center")) {
        adaptPeersForCenter(chosen);
      }
      if (!cand.win.isExplicitSnap) {
        cand.win.snapRegion = chosen;
      }
      accepted.push(cand);
    }

    // Step 4: Final geometry allocation with overcrowding guards and non-zero/non-negative guarantees
    const finalGroups = new Map<string, WindowCandidate[]>();
    for (const cand of candidates) {
      if (!finalGroups.has(cand.region)) finalGroups.set(cand.region, []);
      finalGroups.get(cand.region)!.push(cand);
    }

    for (const [region, cands] of finalGroups.entries()) {
      if (cands.length === 1) {
        const cand = cands[0];
        if (cand.customRect) {
          solution.set(cand.win.id, cand.customRect);
        } else if (zoneMap.has(region)) {
          solution.set(cand.win.id, zoneMap.get(region)!);
        }
      } else {
        const baseRect = zoneMap.get(region) || area;
        const count = cands.length;
        const totalGaps = (count - 1) * gaps.inner;
        const availableH = Math.max(0, baseRect.height - totalGaps);
        const minH = Math.min(30, Math.floor(baseRect.height / count));
        const rawSliceH = Math.floor(availableH / count);
        const sliceH = Math.max(minH, rawSliceH);

        for (let i = 0; i < count; i++) {
          const cand = cands[i];
          let y = baseRect.y + i * (sliceH + gaps.inner);
          if (y + sliceH > baseRect.y + baseRect.height) {
            y = Math.max(baseRect.y, baseRect.y + baseRect.height - sliceH);
          }
          const h = (i === count - 1)
            ? Math.max(minH, (baseRect.y + baseRect.height) - y)
            : sliceH;

          solution.set(cand.win.id, {
            x: Math.max(area.x, baseRect.x),
            y: Math.max(area.y, y),
            width: Math.max(40, baseRect.width),
            height: Math.max(minH, h)
          });
        }
      }
    }

    return solution;
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

      const hasRegionWindows = tileableWindows.some(w => Boolean(w.snapRegion) || Boolean(w.customTiledGeometry));
      if (hasRegionWindows) {
        solution = this.resolveRegionOccupancy(screen, tileableWindows, area, screen.gaps);
      } else {
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
      }

      // Diff desired vs observed geometry
      for (const win of tileableWindows) {
        if (win.isDragging) continue;

        const desiredRect = solution.get(win.id);
        if (!desiredRect) continue;

        win.currentDesiredTiledGeometry = { ...desiredRect };

        const observedRect = win.lastObservedGeometry;
        const exactMatch = rectEqualsWithTolerance(desiredRect, observedRect, tolerance);
        const targetAlreadyRequested =
          Boolean(win.lastRequestedGeometry) &&
          rectEqualsWithTolerance(desiredRect, win.lastRequestedGeometry!, tolerance);

        const originMatches =
          Math.abs(desiredRect.x - observedRect.x) <= tolerance &&
          Math.abs(desiredRect.y - observedRect.y) <= tolerance;

        const smallClampedSettle =
          targetAlreadyRequested &&
          originMatches &&
          Math.abs(desiredRect.width - observedRect.width) <= 32 &&
          Math.abs(desiredRect.height - observedRect.height) <= 32;

        const responseIsStable =
          Boolean(win.lastAttemptObservedGeometry) &&
          rectEqualsWithTolerance(observedRect, win.lastAttemptObservedGeometry!, tolerance);

        const maxRetries = originMatches ? 1 : 2;
        const stableUnachieved =
          targetAlreadyRequested &&
          responseIsStable &&
          (win.unachievableAttempts ?? 0) >= maxRetries;

        if (exactMatch || smallClampedSettle || stableUnachieved) {
          if (exactMatch) {
            win.unachievableAttempts = 0;
            win.lastAttemptObservedGeometry = null;
          }
          skippedWrites++;
          this.skippedIdenticalWrites++;
        } else {
          operations.push({
            windowId: win.id,
            targetRect: { ...desiredRect },
            previousRect: { ...observedRect }
          });
          this.totalGeometryWrites++;
          if (targetAlreadyRequested && responseIsStable) {
            win.unachievableAttempts = (win.unachievableAttempts || 0) + 1;
          } else {
            win.unachievableAttempts = 1;
          }
          win.lastAttemptObservedGeometry = { ...observedRect };
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

  public getCustomTiledGeometry(windowId: RuntimeWindowId): Rect | null {
    const win = this.windows.get(windowId);
    return win?.customTiledGeometry ? { ...win.customTiledGeometry } : null;
  }

  public setCustomTiledGeometry(windowId: RuntimeWindowId, rect: Rect | null): void {
    const win = this.windows.get(windowId);
    if (win) {
      win.customTiledGeometry = rect ? { ...rect } : null;
      if (rect) {
        win.currentDesiredTiledGeometry = { ...rect };
        this.setSavedTiledGeometry(windowId, rect);
        this.markScreenDirty(win.outputId, "CustomGeometrySet");
      }
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
    const updates: { minimized: boolean; frameGeometry?: Rect } = {
      minimized: isMinimized
    };
    if (currentGeom) {
      updates.frameGeometry = currentGeom;
    }
    return this.ingestEvent({
      type: "WindowStateChanged",
      windowId,
      updates
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
