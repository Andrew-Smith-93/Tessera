import type {
  Rect,
  RuntimeWindowId,
  LayoutAlgorithm,
  WindowClassification,
  GapConfig
} from "@tessera/protocol";
import type { GameWindowPolicy, CustomRule } from "@tessera/rules-engine";

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }
}

export class LogicalClock implements Clock {
  private currentTick: number;

  constructor(initialTick: number = 0) {
    this.currentTick = initialTick;
  }

  public now(): number {
    return this.currentTick;
  }

  public advance(delta: number = 1): number {
    this.currentTick += delta;
    return this.currentTick;
  }

  public set(tick: number): void {
    this.currentTick = tick;
  }
}

export const DEFAULT_GEOMETRY_TOLERANCE_PX = 1;
export const DEFAULT_ECHO_EXPIRY_MS = 500;

export function rectEqualsWithTolerance(
  a: Rect,
  b: Rect,
  tolerance: number = DEFAULT_GEOMETRY_TOLERANCE_PX
): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

export const GLOBAL_DESKTOP_SCOPE = "__global__";

export interface RetainedWindowState {
  readonly id: RuntimeWindowId;
  resourceClass: string;
  resourceName: string;
  appId: string;
  desktopFileName: string;
  title: string;
  role: string;
  outputId: string;
  desktopId: string;
  desktopIds: string[];
  onAllDesktops: boolean;
  activityId?: string;
  activities: string[];
  minimized: boolean;
  fullScreen: boolean;
  noBorder: boolean;
  maximizeMode: number;
  frameGeometry: Rect;
  outputGeometry?: Rect;
  classification: WindowClassification;
  tileable: boolean;
  isManualFloating: boolean;
  isDragging: boolean;
  slotIndex?: number;
  lastObservedGeometry: Rect;
  lastRequestedGeometry: Rect | null;
  lastAppliedTransactionEpoch: number;
  currentDesiredTiledGeometry?: Rect | null;
  preMinimizeGeometry?: Rect | null;
  isPreTiled?: boolean;
  outputAffinity?: string;
}

export type WorkspaceScopeKey = string; // "${encodeURIComponent(outputId)}//${encodeURIComponent(desktopId)}"

export function getWorkspaceScopeKey(outputId: string, desktopId: string = "1"): WorkspaceScopeKey {
  return `${encodeURIComponent(outputId)}//${encodeURIComponent(desktopId)}`;
}

export interface WorkspaceLayoutState {
  readonly scopeKey: WorkspaceScopeKey;
  readonly outputId: string;
  readonly desktopId: string;
  activeLayout: LayoutAlgorithm;
  primaryRegionCount: number;
  primaryRegionRatio: number;
  gaps: GapConfig;
  orderedSlotWindowIds: RuntimeWindowId[];
}

export interface RetainedScreenState {
  readonly outputId: string;
  name: string;
  geometry: Rect;
  usableArea: Rect;
  activeDesktopId: string;
  activeActivityId?: string;
  // Compat getters/fields for active desktop's layout state
  activeLayout: LayoutAlgorithm;
  masterCount: number;
  masterRatio: number;
  primaryRegionCount: number;
  primaryRegionRatio: number;
  gaps: GapConfig;
  orderedWindowIds: RuntimeWindowId[];
  _orderedWindowIds?: RuntimeWindowId[];
  persistentOrder: RuntimeWindowId[];
  dirtyReasons: Set<string>;
  latestCommittedEpoch: number;
}

export interface GeometryOperation {
  readonly windowId: RuntimeWindowId;
  readonly targetRect: Rect;
  readonly previousRect?: Rect;
}

export interface ReconciliationTransaction {
  readonly epoch: number;
  readonly reasons: readonly string[];
  readonly affectedScreens: readonly string[];
  readonly operations: readonly GeometryOperation[];
  readonly skippedWrites: number;
  readonly durationMs?: number;
}

export interface CoordinatorConfig {
  enableTiling: boolean;
  defaultLayout: LayoutAlgorithm;
  gapInner: number;
  gapOuter: number;
  primaryRegionRatio?: number;
  primaryRegionCount?: number;
  masterRatio: number;
  masterCount: number;
  perDesktopLayout?: boolean;
  ignoreMinimized: boolean;
  gameWindowPolicy: GameWindowPolicy;
  floatFilter?: string;
  customRules?: CustomRule[] | string;
  customGamePatterns?: string[];
  geometryTolerancePx?: number;
  echoExpiryMs?: number;
}

export interface CoordinatorDiagnostics {
  totalNormalizedEvents: number;
  totalReconciliationTransactions: number;
  totalLayoutComputations: number;
  totalGeometryWrites: number;
  skippedIdenticalWrites: number;
  suppressedGeometryEchoes: number;
  lastTransactionReasons: string[];
  lastAffectedScreenIds: string[];
  retainedWindowCount: number;
  retainedScreenCount: number;
}

export interface NormalizedWindowInput {
  id: RuntimeWindowId;
  resourceClass?: string;
  resourceName?: string;
  appId?: string;
  desktopFileName?: string;
  title?: string;
  role?: string;
  outputId?: string;
  desktopId?: string;
  desktopIds?: string[];
  onAllDesktops?: boolean;
  activityId?: string;
  activities?: string[];
  minimized?: boolean;
  fullScreen?: boolean;
  noBorder?: boolean;
  maximizeMode?: number;
  frameGeometry?: Rect;
  outputGeometry?: Rect;
  outputUsableArea?: Rect;
  managed?: boolean;
  normalWindow?: boolean;
  dialog?: boolean;
  transient?: boolean;
  desktopWindow?: boolean;
  dock?: boolean;
  splash?: boolean;
  notification?: boolean;
  onScreenDisplay?: boolean;
  popupMenu?: boolean;
  tooltip?: boolean;
  specialWindow?: boolean;
  isManualFloating?: boolean;
  isDragging?: boolean;
  isPreTiled?: boolean;
  outputAffinity?: string;
}

export interface NormalizedScreenInput {
  outputId: string;
  name?: string;
  geometry: Rect;
  usableArea: Rect;
  activeDesktopId?: string;
  activeActivityId?: string;
}

export type NormalizedEvent =
  | { type: "WindowDiscovered"; window: NormalizedWindowInput }
  | { type: "WindowRemoved"; windowId: RuntimeWindowId }
  | { type: "WindowGeometryChanged"; windowId: RuntimeWindowId; geometry: Rect; timestamp?: number }
  | { type: "WindowStateChanged"; windowId: RuntimeWindowId; updates: Partial<NormalizedWindowInput> }
  | { type: "WindowMovedOutput"; windowId: RuntimeWindowId; fromOutputId: string; toOutputId: string }
  | { type: "WindowMovedDesktop"; windowId: RuntimeWindowId; fromDesktopId: string; toDesktopId: string }
  | { type: "WindowDesktopsChanged"; windowId: RuntimeWindowId; desktopIds: string[]; onAllDesktops?: boolean }
  | { type: "WindowActivitiesChanged"; windowId: RuntimeWindowId; activities: string[] }
  | { type: "ScreenDesktopChanged"; outputId: string; toDesktopId: string }
  | { type: "ScreenTopologyChanged"; screens: NormalizedScreenInput[] }
  | { type: "ScreenLayoutChanged"; outputId: string; layout: LayoutAlgorithm; desktopId?: string }
  | { type: "ScreenMasterConfigChanged"; outputId: string; count?: number; ratio?: number; desktopId?: string }
  | { type: "ScreenGapsChanged"; outputId: string; gaps: GapConfig; desktopId?: string }
  | { type: "WorkspaceLayoutChanged"; outputId: string; desktopId: string; layout: LayoutAlgorithm }
  | { type: "WorkspacePrimaryConfigChanged"; outputId: string; desktopId: string; count?: number; ratio?: number }
  | { type: "WorkspaceGapsChanged"; outputId: string; desktopId: string; gaps: GapConfig }
  | { type: "GlobalConfigChanged"; config: Partial<CoordinatorConfig> }
  | { type: "WindowSnapCommitted"; windowId: RuntimeWindowId; outputId: string; targetRect: Rect; slotIndex?: number; timestamp?: number; desktopId?: string };
