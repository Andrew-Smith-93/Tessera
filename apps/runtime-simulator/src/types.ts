import type { Rect, Point, RuntimeWindowId, LayoutAlgorithm } from "@tessera/protocol";
import type {
  CoordinatorConfig,
  NormalizedWindowInput,
  NormalizedScreenInput
} from "@tessera/kwin-adapter";

export const TRACE_SCHEMA_VERSION = "1.0.0";

export type TraceEventType =
  | "window-discovered"
  | "window-removed"
  | "geometry-change"
  | "fullscreen-change"
  | "no-border-change"
  | "maximize-change"
  | "minimize-change"
  | "output-move"
  | "desktop-move"
  | "screen-added"
  | "screen-removed"
  | "screen-geometry-change"
  | "layout-change"
  | "gap-change"
  | "master-count-change"
  | "master-ratio-change"
  | "rules-config-change"
  | "cursor-position-update"
  | "snap-preview"
  | "snap-commit"
  | "flush"
  | "advance-clock";

export interface TraceEvent {
  tick?: number;
  type: TraceEventType;
  window?: NormalizedWindowInput;
  windowId?: RuntimeWindowId;
  geometry?: Rect;
  fullScreen?: boolean;
  noBorder?: boolean;
  maximizeMode?: number;
  minimized?: boolean;
  frameGeometry?: Rect;
  fromOutputId?: string;
  toOutputId?: string;
  fromDesktopId?: string;
  toDesktopId?: string;
  screen?: NormalizedScreenInput;
  outputId?: string;
  layout?: LayoutAlgorithm;
  gapInner?: number;
  gapOuter?: number;
  count?: number;
  ratio?: number;
  config?: Partial<CoordinatorConfig>;
  cursor?: Point;
  zoneIndex?: number;
  deltaTicks?: number;
}

export type SimulatedEchoMode =
  | "immediate"
  | "delayed"
  | "missing"
  | "mismatched"
  | "duplicate";

export interface TraceFixture {
  schemaVersion: string;
  name?: string;
  description?: string;
  initialConfig?: Partial<CoordinatorConfig>;
  initialScreens?: NormalizedScreenInput[];
  initialWindows?: NormalizedWindowInput[];
  echoMode?: SimulatedEchoMode;
  echoDelayTicks?: number;
  events: TraceEvent[];
  expected?: {
    digest?: string;
    transactions?: number;
    layoutComputations?: number;
    geometryWrites?: number;
    suppressedEchoes?: number;
  };
}

export interface SerializableRetainedScreen {
  outputId: string;
  name: string;
  geometry: Rect;
  usableArea: Rect;
  activeLayout: string;
  masterCount: number;
  masterRatio: number;
  gaps: { inner: number; outer: number };
  orderedWindowIds: string[];
  persistentOrder: string[];
}

export interface SerializableRetainedWindow {
  id: string;
  resourceClass: string;
  outputId: string;
  classification: string;
  tileable: boolean;
  minimized: boolean;
  fullScreen: boolean;
  noBorder: boolean;
  maximizeMode: number;
  isManualFloating: boolean;
  frameGeometry: Rect;
  desiredGeometry: Rect | null;
  preMinimizeGeometry: Rect | null;
  outputAffinity: string | undefined;
}

export interface SerializableGeometryOperation {
  windowId: string;
  targetRect: Rect;
  previousRect?: Rect;
}

export interface SerializableTransaction {
  epoch: number;
  tick: number;
  reasons: string[];
  affectedScreens: string[];
  operations: SerializableGeometryOperation[];
  skippedWrites: number;
}

export interface InvariantViolation {
  code: string;
  message: string;
  entityId?: string;
}

export interface InvariantResult {
  passed: boolean;
  violations: InvariantViolation[];
}

export interface SimulationDiagnostics {
  totalEvents: number;
  totalTransactions: number;
  totalLayoutComputations: number;
  totalGeometryWrites: number;
  skippedWrites: number;
  suppressedEchoes: number;
  previewOnlyOperations: number;
  committedSnapOperations: number;
  unaffectedScreensRecomputed: number;
}

export interface SimulationResult {
  schemaVersion: string;
  fixtureName?: string;
  finalTick: number;
  retainedScreens: SerializableRetainedScreen[];
  retainedWindows: SerializableRetainedWindow[];
  transactions: SerializableTransaction[];
  diagnostics: SimulationDiagnostics;
  invariants: InvariantResult;
  digest: string;
}
