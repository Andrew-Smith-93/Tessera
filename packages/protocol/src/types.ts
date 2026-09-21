import type { Rect } from "./geometry.js";
import type { LayoutAlgorithm } from "./commands.js";

export const PROTOCOL_NAME = "tessera.ipc" as const;
export const PROTOCOL_MAJOR_VERSION = 1 as const;
export const PROTOCOL_MINOR_VERSION = 0 as const;
export const SUPPORTED_MINOR_VERSIONS: readonly number[] = [0] as const;

// Conservative Security and Resource Limits
export const MAX_FRAME_SIZE = 16 * 1024 * 1024; // 16 MB = 16,777,216 bytes
export const MAX_NESTING_DEPTH = 32;
export const MAX_STRING_LENGTH = 65536; // 64 KB
export const MAX_ARRAY_LENGTH = 10000;
export const MAX_OUTSTANDING_REQUESTS = 1000;
export const MAX_SUBSCRIPTION_COUNT = 100;

export type ProtocolName = typeof PROTOCOL_NAME;

export type MessageKind = "request" | "response" | "event";

export enum ProtocolErrorCode {
  INVALID_ENVELOPE = "INVALID_ENVELOPE",
  UNSUPPORTED_MAJOR_VERSION = "UNSUPPORTED_MAJOR_VERSION",
  UNSUPPORTED_MINOR_VERSION = "UNSUPPORTED_MINOR_VERSION",
  CAPABILITY_NOT_NEGOTIATED = "CAPABILITY_NOT_NEGOTIATED",
  UNKNOWN_METHOD = "UNKNOWN_METHOD",
  INVALID_PAYLOAD = "INVALID_PAYLOAD",
  FRAME_TOO_LARGE = "FRAME_TOO_LARGE",
  CONFIG_VALIDATION_FAILED = "CONFIG_VALIDATION_FAILED",
  REVISION_CONFLICT = "REVISION_CONFLICT",
  WINDOW_NOT_FOUND = "WINDOW_NOT_FOUND",
  OUTPUT_NOT_FOUND = "OUTPUT_NOT_FOUND",
  TRACE_DISABLED = "TRACE_DISABLED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DECODE_ERROR = "DECODE_ERROR"
}

export type ProtocolCapability =
  | "state.inspect"
  | "config.mutate"
  | "runtime.control"
  | "trace.inspect";

export const V1_CAPABILITIES: readonly ProtocolCapability[] = [
  "state.inspect",
  "config.mutate",
  "runtime.control",
  "trace.inspect"
] as const;

export interface ProtocolErrorData {
  code: ProtocolErrorCode | string;
  message: string;
  details?: unknown;
}

export interface BaseEnvelope {
  protocol: ProtocolName;
  majorVersion: number;
  minorVersion: number;
  kind: MessageKind;
  id: string;
  metadata?: Record<string, unknown>;
}

export interface ProtocolRequest<TParams = Record<string, unknown>> extends BaseEnvelope {
  kind: "request";
  method: string;
  params?: TParams;
}

export interface ProtocolResponse<TResult = unknown> extends BaseEnvelope {
  kind: "response";
  replyTo: string;
  ok: boolean;
  result?: TResult;
  error?: ProtocolErrorData;
}

export interface ProtocolEvent<TData = unknown> extends BaseEnvelope {
  kind: "event";
  event: string;
  data: TData;
}

export type ProtocolEnvelope = ProtocolRequest | ProtocolResponse | ProtocolEvent;

// ==========================================
// Handshake: system.hello
// ==========================================

export interface HelloParams {
  clientName: string;
  clientVersion: string;
  minMajor?: number;
  maxMajor?: number;
  minMinor?: number;
  maxMinor?: number;
  requestedCapabilities?: string[];
}

export interface ResourceLimits {
  maxFrameSize: number;
  maxNestingDepth: number;
  maxStringLength: number;
  maxArrayLength: number;
  maxOutstandingRequests: number;
  maxSubscriptionCount: number;
}

export interface HelloResult {
  serverName: string;
  serverVersion: string;
  negotiatedMajor: number;
  negotiatedMinor: number;
  capabilities: string[];
  maxFrameSize: number;
  limits: ResourceLimits;
}

// ==========================================
// State Queries
// ==========================================

export interface ProtocolRetainedScreen {
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

export interface ProtocolRetainedWindow {
  id: string;
  title?: string;
  resourceClass: string;
  resourceName?: string;
  appId?: string;
  desktopFileName?: string;
  role?: string;
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
  outputAffinity?: string;
}

export interface StateSnapshotResult {
  revision: number;
  screens: ProtocolRetainedScreen[];
  windows: ProtocolRetainedWindow[];
  config: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}

export interface StateDiagnosticsResult {
  diagnostics: Record<string, unknown>;
}

export interface StateCapabilitiesResult {
  capabilities: string[];
  adapterCapabilities: number;
}

// ==========================================
// Configuration
// ==========================================

export interface ConfigGetResult {
  config: Record<string, unknown>;
  revision: number;
}

export interface ConfigValidatePatchParams {
  patch: Record<string, unknown>;
}

export interface ConfigValidatePatchResult {
  valid: boolean;
  errors?: string[];
}

export interface ConfigApplyPatchParams {
  patch: Record<string, unknown>;
  expectedRevision?: number;
  idempotencyKey?: string;
}

export interface ConfigApplyPatchResult {
  acknowledged: boolean;
  commandId: string;
  stateRevision: number;
}

// ==========================================
// Runtime Commands (Asynchronous Queue)
// ==========================================

export interface RuntimeRequestReconcileParams {
  forceScreenId?: string;
  expectedRevision?: number;
  idempotencyKey?: string;
}

export interface RuntimeSetLayoutParams {
  outputId: string;
  layout: LayoutAlgorithm | string;
  expectedRevision?: number;
  idempotencyKey?: string;
}

export interface RuntimeSetMasterCountParams {
  outputId: string;
  count: number;
  expectedRevision?: number;
  idempotencyKey?: string;
}

export interface RuntimeSetMasterRatioParams {
  outputId: string;
  ratio: number;
  expectedRevision?: number;
  idempotencyKey?: string;
}

export interface RuntimeSetWindowFloatingParams {
  windowId: string;
  floating: boolean;
  expectedRevision?: number;
  idempotencyKey?: string;
}

export interface RuntimeCommandAckResult {
  acknowledged: boolean;
  commandId: string;
  stateRevision: number;
}

export interface RuntimeVersionResult {
  engineVersion: string;
  protocolMajor: number;
  protocolMinor: number;
}

// ==========================================
// Trace & Diagnostic Support
// ==========================================

export interface TraceGetRecentParams {
  limit?: number;
}

export interface ProtocolTraceEntry {
  tick: number;
  timestamp?: number;
  event: Record<string, unknown>;
}

export interface TraceGetRecentResult {
  entries: ProtocolTraceEntry[];
}

export interface TraceClearRecentResult {
  cleared: number;
}

// ==========================================
// Events
// ==========================================

export interface RuntimeReadyEventData {
  timestamp: number;
  engineVersion: string;
}

export interface RuntimeStateChangedEventData {
  tick: number;
  stateRevision: number;
  dirtyScreens: string[];
}

export interface ProtocolGeometryOperation {
  windowId: string;
  targetRect: Rect;
  previousRect?: Rect;
}

export interface ProtocolTransaction {
  epoch: number;
  tick?: number;
  reasons: string[];
  affectedScreens: string[];
  operations: ProtocolGeometryOperation[];
  skippedWrites: number;
}

export interface RuntimeTransactionCommittedEventData {
  transaction: ProtocolTransaction;
}

export interface RuntimeConfigurationChangedEventData {
  config: Record<string, unknown>;
  revision: number;
}

export interface RuntimeCapabilitiesChangedEventData {
  capabilities: string[];
}

export interface RuntimeWarningEventData {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}
