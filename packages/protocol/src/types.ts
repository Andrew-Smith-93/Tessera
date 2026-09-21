import type { Rect } from "./geometry.js";

export const PROTOCOL_NAME = "tessera.ipc" as const;
export const PROTOCOL_VERSION = "1.0" as const;
export const MAX_FRAME_SIZE = 16 * 1024 * 1024; // 16 MB = 16,777,216 bytes

export type ProtocolName = typeof PROTOCOL_NAME;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export type MessageType = "request" | "response" | "event";

export enum ProtocolErrorCode {
  INVALID_ENVELOPE = "INVALID_ENVELOPE",
  UNSUPPORTED_PROTOCOL_VERSION = "UNSUPPORTED_PROTOCOL_VERSION",
  UNKNOWN_METHOD = "UNKNOWN_METHOD",
  INVALID_PARAMS = "INVALID_PARAMS",
  METHOD_NOT_FOUND = "METHOD_NOT_FOUND",
  CAPABILITY_NOT_NEGOTIATED = "CAPABILITY_NOT_NEGOTIATED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  FRAME_TOO_LARGE = "FRAME_TOO_LARGE",
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
  version: ProtocolVersion;
  id: string;
  type: MessageType;
}

export interface ProtocolRequest<TParams = Record<string, unknown>> extends BaseEnvelope {
  type: "request";
  method: string;
  params?: TParams;
}

export interface ProtocolResponse<TResult = unknown> extends BaseEnvelope {
  type: "response";
  replyTo: string;
  ok: boolean;
  result?: TResult;
  error?: ProtocolErrorData;
}

export interface ProtocolEvent<TData = unknown> extends BaseEnvelope {
  type: "event";
  event: string;
  data: TData;
}

export type ProtocolEnvelope = ProtocolRequest | ProtocolResponse | ProtocolEvent;

// ==========================================
// V1 Method Parameters & Result Types
// ==========================================

export interface HelloParams {
  clientName: string;
  clientVersion: string;
  requestedCapabilities?: string[];
}

export interface HelloResult {
  serverName: string;
  serverVersion: string;
  protocolVersion: ProtocolVersion;
  capabilities: string[];
}

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
  outputAffinity?: string;
}

export interface GetScreenOrderParams {
  outputId: string;
}

export interface GetScreenOrderResult {
  outputId: string;
  orderedWindowIds: string[];
  persistentOrder: string[];
}

export interface ConfigGetResult {
  config: Record<string, unknown>;
}

export interface ConfigSetParams {
  config: Record<string, unknown>;
}

export interface ConfigSetResult {
  success: boolean;
  applied: Record<string, unknown>;
}

export interface RuntimeReconcileParams {
  forceScreenId?: string;
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
  durationMs?: number;
}

export interface RuntimeReconcileResult {
  transaction: ProtocolTransaction | null;
}

export interface RuntimeDiagnosticsResult {
  diagnostics: Record<string, unknown>;
}

export interface TraceDumpParams {
  limit?: number;
}

export interface ProtocolTraceEntry {
  tick: number;
  timestamp?: number;
  event: Record<string, unknown>;
}

export interface TraceDumpResult {
  entries: ProtocolTraceEntry[];
}

export interface TraceClearResult {
  cleared: number;
}

// ==========================================
// V1 Event Data Types
// ==========================================

export interface RuntimeReadyEventData {
  timestamp: number;
  engineVersion: string;
}

export interface RuntimeStateChangedEventData {
  tick: number;
  dirtyScreens: string[];
}

export interface RuntimeTransactionCommittedEventData {
  transaction: ProtocolTransaction;
}

export interface RuntimeTopologyChangedEventData {
  screens: ProtocolRetainedScreen[];
}

export interface ConfigChangedEventData {
  config: Record<string, unknown>;
}
