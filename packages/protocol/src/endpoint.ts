import {
  PROTOCOL_NAME,
  PROTOCOL_MAJOR_VERSION,
  PROTOCOL_MINOR_VERSION,
  MAX_FRAME_SIZE,
  MAX_NESTING_DEPTH,
  MAX_STRING_LENGTH,
  MAX_ARRAY_LENGTH,
  MAX_OUTSTANDING_REQUESTS,
  MAX_SUBSCRIPTION_COUNT,
  MAX_QUEUE_LENGTH,
  MAX_IDEMPOTENCY_CACHE_SIZE,
  ProtocolErrorCode,
  V1_CAPABILITIES,
  type ProtocolCapability,
  type ProtocolRequest,
  type ProtocolResponse,
  type ProtocolEvent,
  type HelloParams,
  type HelloResult,
  type ResourceLimits,
  type SystemSubscribeParams,
  type SystemSubscribeResult,
  type SystemUnsubscribeParams,
  type SystemUnsubscribeResult,
  type ProtocolRetainedScreen,
  type ProtocolRetainedWindow,
  type StateSnapshotResult,
  type StateDiagnosticsResult,
  type StateCapabilitiesResult,
  type ConfigGetResult,
  type ConfigValidatePatchResult,
  type ConfigApplyPatchParams,
  type RuntimeRequestReconcileParams,
  type RuntimeSetLayoutParams,
  type RuntimeSetMasterCountParams,
  type RuntimeSetMasterRatioParams,
  type RuntimeSetWindowFloatingParams,
  type RuntimeCommandAckResult,
  type RuntimeVersionResult,
  type TraceGetRecentParams,
  type TraceGetRecentResult,
  type TraceClearRecentResult,
  type ProtocolTransaction
} from "./types.js";
import { createProtocolError, ProtocolError } from "./errors.js";
import { validateMethodParams } from "./validator.js";
import { encodeFrame, StreamingFrameDecoder } from "./codec.js";

export interface CoordinatorRuntimeTarget {
  getRetainedScreens(): readonly ProtocolRetainedScreen[];
  getRetainedWindows(): readonly ProtocolRetainedWindow[];
  getRetainedScreen(outputId: string): ProtocolRetainedScreen | null | undefined;
  reconcile(forceScreenId?: string): ProtocolTransaction | null | undefined;
  getDiagnostics(): Record<string, unknown>;
  getConfig?(): Record<string, unknown>;
  updateConfig?(config: Record<string, unknown>): void;
  getTraceRecorder?(): {
    isEnabled(): boolean;
    getEntries(): Array<{ tick: number; timestamp?: number; event: Record<string, unknown> }>;
    clear(): number;
  } | null | undefined;
  setLayout?(outputId: string, layout: string): void;
  setMasterCount?(outputId: string, count: number): void;
  setMasterRatio?(outputId: string, ratio: number): void;
  setWindowFloating?(windowId: string, floating: boolean): void;
  getCapabilities?(): number;
}

export interface ServerSession {
  clientId: string;
  clientName?: string;
  clientVersion?: string;
  negotiatedMajor: number;
  negotiatedMinor: number;
  negotiatedCapabilities: Set<string>;
  helloCompleted: boolean;
  decoder: StreamingFrameDecoder;
  subscriptions: Set<string>;
  outstandingRequests: number;
  eventCallback?: (event: ProtocolEvent, frameBytes: Uint8Array) => void;
}

export interface QueuedCommand {
  id: string;
  method: string;
  params: Record<string, unknown>;
  idempotencyKey?: string;
  clientId: string;
}

interface IdempotencyRecord {
  clientId: string;
  method: string;
  key: string;
  payloadHash: string;
  response: RuntimeCommandAckResult;
}

const REDACTION_FIELD_KEYS = new Set([
  "title",
  "resourceClass",
  "resourceName",
  "appId",
  "desktopFileName",
  "role"
]);

/**
 * Centralized outbound redaction sanitizer applied before serialization.
 */
export function sanitizeOutboundPayload(payload: unknown, redact: boolean): unknown {
  if (!redact || payload === null || typeof payload !== "object") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(item => sanitizeOutboundPayload(item, redact));
  }

  const record = payload as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (REDACTION_FIELD_KEYS.has(key)) {
      if (key === "title") {
        // Redacted title is omitted or masked
        output[key] = undefined;
      } else {
        output[key] = "[REDACTED]";
      }
    } else {
      output[key] = sanitizeOutboundPayload(value, redact);
    }
  }

  return output;
}

function computeCanonicalPayloadHash(params: Record<string, unknown>): string {
  const sortedKeys = Object.keys(params).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    normalized[key] = params[key];
  }
  const str = JSON.stringify(normalized);
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0");
}

export class ReferenceServer {
  private readonly runtime: CoordinatorRuntimeTarget;
  private readonly serverVersion: string;
  private readonly sessions = new Map<string, ServerSession>();

  private currentRevision = 1;
  private nextRevision = 1;
  private commandQueue: QueuedCommand[] = [];
  private idempotencyStore = new Map<string, IdempotencyRecord>();
  private idempotencyKeyOrder: string[] = [];

  // Deterministic monotonic sequence counters
  private responseSeq = 0;
  private eventSeq = 0;
  private commandSeq = 0;
  private correlationSeq = 0;
  private tick = 0;

  constructor(runtime: CoordinatorRuntimeTarget, options?: { serverVersion?: string }) {
    this.runtime = runtime;
    this.serverVersion = options?.serverVersion ?? "1.0.0";
  }

  public getSession(clientId: string): ServerSession {
    let session = this.sessions.get(clientId);
    if (!session) {
      session = {
        clientId,
        negotiatedMajor: 0,
        negotiatedMinor: 0,
        negotiatedCapabilities: new Set(),
        helloCompleted: false,
        decoder: new StreamingFrameDecoder(),
        subscriptions: new Set(),
        outstandingRequests: 0
      };
      this.sessions.set(clientId, session);
    }
    return session;
  }

  public registerSessionCallback(
    clientId: string,
    callback: (event: ProtocolEvent, frameBytes: Uint8Array) => void
  ): void {
    const session = this.getSession(clientId);
    session.eventCallback = callback;
  }

  public removeSession(clientId: string): void {
    const session = this.sessions.get(clientId);
    if (session) {
      session.subscriptions.clear();
      session.eventCallback = undefined;
      session.decoder.reset();
      this.sessions.delete(clientId);
    }
  }

  public getCurrentRevision(): number {
    return this.currentRevision;
  }

  public getPendingCommandCount(): number {
    return this.commandQueue.length;
  }

  /**
   * Advances the runtime state: processes all queued commands in FIFO order,
   * performs reconciliation, updates revision, and emits transactions.
   */
  public advance(): { processedCommands: number; transaction: ProtocolTransaction | null } {
    this.tick++;
    const count = this.commandQueue.length;
    let forceReconcile = false;

    while (this.commandQueue.length > 0) {
      const cmd = this.commandQueue.shift()!;
      switch (cmd.method) {
        case "config.applyPatch": {
          const patch = (cmd.params.patch ?? {}) as Record<string, unknown>;
          if (this.runtime.updateConfig) {
            this.runtime.updateConfig(patch);
          }
          forceReconcile = true;
          this.emitEvent("runtime.configurationChanged", {
            config: this.runtime.getConfig ? this.runtime.getConfig() : {},
            revision: this.nextRevision
          });
          break;
        }

        case "runtime.setLayout": {
          if (this.runtime.setLayout) {
            this.runtime.setLayout(cmd.params.outputId as string, cmd.params.layout as string);
          }
          forceReconcile = true;
          break;
        }

        case "runtime.setMasterCount": {
          if (this.runtime.setMasterCount) {
            this.runtime.setMasterCount(cmd.params.outputId as string, cmd.params.count as number);
          }
          forceReconcile = true;
          break;
        }

        case "runtime.setMasterRatio": {
          if (this.runtime.setMasterRatio) {
            this.runtime.setMasterRatio(cmd.params.outputId as string, cmd.params.ratio as number);
          }
          forceReconcile = true;
          break;
        }

        case "runtime.setWindowFloating": {
          if (this.runtime.setWindowFloating) {
            this.runtime.setWindowFloating(cmd.params.windowId as string, cmd.params.floating as boolean);
          }
          forceReconcile = true;
          break;
        }

        case "runtime.requestReconcile": {
          forceReconcile = true;
          break;
        }
      }
    }

    this.currentRevision = this.nextRevision;

    let transaction: ProtocolTransaction | null = null;
    if (forceReconcile) {
      const tx = this.runtime.reconcile();
      if (tx) {
        transaction = {
          epoch: tx.epoch,
          tick: this.tick,
          reasons: [...tx.reasons],
          affectedScreens: [...tx.affectedScreens],
          operations: tx.operations.map(op => ({
            windowId: op.windowId,
            targetRect: { ...op.targetRect },
            previousRect: op.previousRect ? { ...op.previousRect } : undefined
          })),
          skippedWrites: tx.skippedWrites
        };

        this.emitEvent("runtime.transactionCommitted", { transaction });
      }
    }

    return { processedCommands: count, transaction };
  }

  /**
   * Dispatches a typed ProtocolRequest and returns a ProtocolResponse.
   */
  public async handleRequest(request: ProtocolRequest, clientId = "default"): Promise<ProtocolResponse> {
    const session = this.getSession(clientId);

    if (session.outstandingRequests >= MAX_OUTSTANDING_REQUESTS) {
      return this.createErrorResponse(
        request.id,
        createProtocolError(
          ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED,
          `Session exceeded maximum outstanding request limit of ${MAX_OUTSTANDING_REQUESTS}`
        )
      );
    }

    session.outstandingRequests++;

    try {
      // 1. Handle system.hello (handshake)
      if (request.method === "system.hello") {
        const validation = validateMethodParams("system.hello", request.params);
        if (!validation.valid && validation.error) {
          return this.createErrorResponse(request.id, validation.error);
        }

        const params = (request.params ?? {}) as unknown as HelloParams;

        // Check major version compatibility
        const minMajor = params.minMajor ?? PROTOCOL_MAJOR_VERSION;
        const maxMajor = params.maxMajor ?? PROTOCOL_MAJOR_VERSION;
        if (minMajor > PROTOCOL_MAJOR_VERSION || maxMajor < PROTOCOL_MAJOR_VERSION) {
          return this.createErrorResponse(
            request.id,
            createProtocolError(
              ProtocolErrorCode.UNSUPPORTED_MAJOR_VERSION,
              `Client requested major version range [${minMajor}..${maxMajor}], server supports ${PROTOCOL_MAJOR_VERSION}`
            )
          );
        }

        // Check minor version compatibility
        const minMinor = params.minMinor ?? 0;
        const maxMinor = params.maxMinor ?? 0;
        if (minMinor > PROTOCOL_MINOR_VERSION) {
          return this.createErrorResponse(
            request.id,
            createProtocolError(
              ProtocolErrorCode.UNSUPPORTED_MINOR_VERSION,
              `Client requested minimum minor version ${minMinor}, server supports up to ${PROTOCOL_MINOR_VERSION}`
            )
          );
        }

        // Negotiate highest mutually supported minor version
        const negotiatedMinor = Math.min(maxMinor, PROTOCOL_MINOR_VERSION);

        // Negotiate capabilities
        const requested = new Set(params.requestedCapabilities ?? V1_CAPABILITIES);
        const granted: string[] = [];
        session.negotiatedCapabilities.clear();

        for (const cap of V1_CAPABILITIES) {
          if (requested.has(cap)) {
            granted.push(cap);
            session.negotiatedCapabilities.add(cap);
          }
        }

        session.clientName = params.clientName;
        session.clientVersion = params.clientVersion;
        session.negotiatedMajor = PROTOCOL_MAJOR_VERSION;
        session.negotiatedMinor = negotiatedMinor;
        session.helloCompleted = true;

        const limits: ResourceLimits = {
          maxFrameSize: MAX_FRAME_SIZE,
          maxNestingDepth: MAX_NESTING_DEPTH,
          maxStringLength: MAX_STRING_LENGTH,
          maxArrayLength: MAX_ARRAY_LENGTH,
          maxOutstandingRequests: MAX_OUTSTANDING_REQUESTS,
          maxSubscriptionCount: MAX_SUBSCRIPTION_COUNT
        };

        const helloResult: HelloResult = {
          serverName: "tessera-runtime",
          serverVersion: this.serverVersion,
          negotiatedMajor: PROTOCOL_MAJOR_VERSION,
          negotiatedMinor,
          capabilities: granted,
          maxFrameSize: MAX_FRAME_SIZE,
          limits
        };

        return this.createSuccessResponse(request.id, helloResult);
      }

      // 2. Enforce handshake completion before other methods
      if (!session.helloCompleted) {
        return this.createErrorResponse(
          request.id,
          createProtocolError(
            ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED,
            `Method "${request.method}" cannot be invoked before completing system.hello handshake`
          )
        );
      }

      // 3. Subscriptions (system.subscribe and system.unsubscribe)
      if (request.method === "system.subscribe") {
        const validation = validateMethodParams("system.subscribe", request.params);
        if (!validation.valid && validation.error) {
          return this.createErrorResponse(request.id, validation.error);
        }

        const p = (request.params ?? {}) as SystemSubscribeParams;
        const requestedEvents = p.events ?? p.channels ?? [];

        if (session.subscriptions.size + requestedEvents.length > MAX_SUBSCRIPTION_COUNT) {
          return this.createErrorResponse(
            request.id,
            createProtocolError(
              ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED,
              `Session exceeded maximum subscription limit of ${MAX_SUBSCRIPTION_COUNT}`
            )
          );
        }

        for (const evt of requestedEvents) {
          session.subscriptions.add(evt);
        }

        const res: SystemSubscribeResult = {
          subscribed: Array.from(session.subscriptions)
        };
        return this.createSuccessResponse(request.id, res);
      }

      if (request.method === "system.unsubscribe") {
        const validation = validateMethodParams("system.unsubscribe", request.params);
        if (!validation.valid && validation.error) {
          return this.createErrorResponse(request.id, validation.error);
        }

        const p = (request.params ?? {}) as SystemUnsubscribeParams;
        const targetEvents = p.events ?? p.channels ?? [];

        for (const evt of targetEvents) {
          session.subscriptions.delete(evt);
        }

        const res: SystemUnsubscribeResult = {
          subscribed: Array.from(session.subscriptions)
        };
        return this.createSuccessResponse(request.id, res);
      }

      // 4. Enforce capabilities for all other methods
      const requiredCap = this.getRequiredCapability(request.method);
      if (requiredCap && !session.negotiatedCapabilities.has(requiredCap)) {
        return this.createErrorResponse(
          request.id,
          createProtocolError(
            ProtocolErrorCode.CAPABILITY_NOT_NEGOTIATED,
            `Method "${request.method}" requires capability "${requiredCap}", which was not negotiated via system.hello`
          )
        );
      }

      // 5. Dispatch specific V1 methods
      switch (request.method) {
        case "state.getSnapshot": {
          const cfg = this.runtime.getConfig ? this.runtime.getConfig() : {};
          const shouldRedact = Boolean(cfg.redactIdentities);

          const screens: ProtocolRetainedScreen[] = this.runtime.getRetainedScreens().map(s => ({
            outputId: s.outputId,
            name: s.name,
            geometry: { ...s.geometry },
            usableArea: { ...s.usableArea },
            activeLayout: s.activeLayout,
            masterCount: s.masterCount,
            masterRatio: s.masterRatio,
            gaps: { ...s.gaps },
            orderedWindowIds: [...s.orderedWindowIds],
            persistentOrder: [...s.persistentOrder]
          }));

          const windows: ProtocolRetainedWindow[] = this.runtime.getRetainedWindows().map(w => ({
            id: w.id,
            title: w.title,
            resourceClass: w.resourceClass,
            resourceName: w.resourceName,
            appId: w.appId,
            desktopFileName: w.desktopFileName,
            role: w.role,
            outputId: w.outputId,
            classification: w.classification,
            tileable: w.tileable,
            minimized: w.minimized,
            fullScreen: w.fullScreen,
            noBorder: w.noBorder,
            maximizeMode: w.maximizeMode,
            isManualFloating: w.isManualFloating,
            frameGeometry: { ...w.frameGeometry },
            desiredGeometry: w.desiredGeometry ? { ...w.desiredGeometry } : null,
            preMinimizeGeometry: w.preMinimizeGeometry ? { ...w.preMinimizeGeometry } : null,
            outputAffinity: w.outputAffinity
          }));

          const diag = this.runtime.getDiagnostics();
          const rawResult: StateSnapshotResult = {
            revision: this.currentRevision,
            screens,
            windows,
            config: { ...cfg },
            diagnostics: { ...diag }
          };

          const sanitized = sanitizeOutboundPayload(rawResult, shouldRedact) as StateSnapshotResult;
          return this.createSuccessResponse(request.id, sanitized);
        }

        case "state.getDiagnostics": {
          const cfg = this.runtime.getConfig ? this.runtime.getConfig() : {};
          const shouldRedact = Boolean(cfg.redactIdentities);
          const diag = this.runtime.getDiagnostics();
          const result: StateDiagnosticsResult = {
            diagnostics: sanitizeOutboundPayload(diag, shouldRedact) as Record<string, unknown>
          };
          return this.createSuccessResponse(request.id, result);
        }

        case "state.getCapabilities": {
          const adapterCaps = this.runtime.getCapabilities ? this.runtime.getCapabilities() : 0;
          const result: StateCapabilitiesResult = {
            capabilities: [...V1_CAPABILITIES],
            adapterCapabilities: adapterCaps
          };
          return this.createSuccessResponse(request.id, result);
        }

        case "config.get": {
          const cfg = this.runtime.getConfig ? this.runtime.getConfig() : {};
          const result: ConfigGetResult = {
            config: { ...cfg },
            revision: this.currentRevision
          };
          return this.createSuccessResponse(request.id, result);
        }

        case "config.validatePatch": {
          const validation = validateMethodParams("config.validatePatch", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const result: ConfigValidatePatchResult = { valid: true };
          return this.createSuccessResponse(request.id, result);
        }

        case "config.applyPatch": {
          const validation = validateMethodParams("config.applyPatch", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const p = (request.params ?? {}) as unknown as ConfigApplyPatchParams;
          return this.enqueueCommand("config.applyPatch", p as unknown as Record<string, unknown>, request.id, clientId);
        }

        case "runtime.requestReconcile": {
          const validation = validateMethodParams("runtime.requestReconcile", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const p = (request.params ?? {}) as unknown as RuntimeRequestReconcileParams;
          return this.enqueueCommand("runtime.requestReconcile", p as unknown as Record<string, unknown>, request.id, clientId);
        }

        case "runtime.setLayout": {
          const validation = validateMethodParams("runtime.setLayout", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const p = (request.params ?? {}) as unknown as RuntimeSetLayoutParams;

          // Target output existence validation
          const screens = this.runtime.getRetainedScreens();
          if (!screens.some(s => s.outputId === p.outputId)) {
            return this.createErrorResponse(
              request.id,
              createProtocolError(
                ProtocolErrorCode.OUTPUT_NOT_FOUND,
                `Output "${p.outputId}" not found in active screen topology`
              )
            );
          }

          return this.enqueueCommand("runtime.setLayout", p as unknown as Record<string, unknown>, request.id, clientId);
        }

        case "runtime.setMasterCount": {
          const validation = validateMethodParams("runtime.setMasterCount", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const p = (request.params ?? {}) as unknown as RuntimeSetMasterCountParams;

          const screens = this.runtime.getRetainedScreens();
          if (!screens.some(s => s.outputId === p.outputId)) {
            return this.createErrorResponse(
              request.id,
              createProtocolError(
                ProtocolErrorCode.OUTPUT_NOT_FOUND,
                `Output "${p.outputId}" not found in active screen topology`
              )
            );
          }

          return this.enqueueCommand("runtime.setMasterCount", p as unknown as Record<string, unknown>, request.id, clientId);
        }

        case "runtime.setMasterRatio": {
          const validation = validateMethodParams("runtime.setMasterRatio", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const p = (request.params ?? {}) as unknown as RuntimeSetMasterRatioParams;

          const screens = this.runtime.getRetainedScreens();
          if (!screens.some(s => s.outputId === p.outputId)) {
            return this.createErrorResponse(
              request.id,
              createProtocolError(
                ProtocolErrorCode.OUTPUT_NOT_FOUND,
                `Output "${p.outputId}" not found in active screen topology`
              )
            );
          }

          return this.enqueueCommand("runtime.setMasterRatio", p as unknown as Record<string, unknown>, request.id, clientId);
        }

        case "runtime.setWindowFloating": {
          const validation = validateMethodParams("runtime.setWindowFloating", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const p = (request.params ?? {}) as unknown as RuntimeSetWindowFloatingParams;

          // Target window existence validation
          const windows = this.runtime.getRetainedWindows();
          if (!windows.some(w => w.id === p.windowId)) {
            return this.createErrorResponse(
              request.id,
              createProtocolError(
                ProtocolErrorCode.WINDOW_NOT_FOUND,
                `Window "${p.windowId}" not found in active retained windows`
              )
            );
          }

          return this.enqueueCommand("runtime.setWindowFloating", p as unknown as Record<string, unknown>, request.id, clientId);
        }

        case "runtime.getVersion": {
          const result: RuntimeVersionResult = {
            engineVersion: this.serverVersion,
            protocolMajor: PROTOCOL_MAJOR_VERSION,
            protocolMinor: PROTOCOL_MINOR_VERSION
          };
          return this.createSuccessResponse(request.id, result);
        }

        case "trace.getRecent": {
          const recorder = this.runtime.getTraceRecorder ? this.runtime.getTraceRecorder() : null;
          if (!recorder || !recorder.isEnabled()) {
            return this.createErrorResponse(
              request.id,
              createProtocolError(ProtocolErrorCode.TRACE_DISABLED, "Trace recording is disabled on this runtime")
            );
          }

          const params = (request.params ?? {}) as unknown as TraceGetRecentParams;
          let entries = recorder.getEntries();
          if (params.limit !== undefined && params.limit > 0) {
            entries = entries.slice(-params.limit);
          }

          const cfg = this.runtime.getConfig ? this.runtime.getConfig() : {};
          const shouldRedact = Boolean(cfg.redactIdentities);

          const result: TraceGetRecentResult = {
            entries: entries.map(e => ({
              tick: e.tick ?? 0,
              timestamp: e.timestamp,
              event: sanitizeOutboundPayload(e.event, shouldRedact) as Record<string, unknown>
            }))
          };
          return this.createSuccessResponse(request.id, result);
        }

        case "trace.clearRecent": {
          const recorder = this.runtime.getTraceRecorder ? this.runtime.getTraceRecorder() : null;
          let cleared = 0;
          if (recorder && typeof recorder.clear === "function") {
            cleared = recorder.clear();
          }
          const result: TraceClearRecentResult = { cleared };
          return this.createSuccessResponse(request.id, result);
        }

        default:
          return this.createErrorResponse(
            request.id,
            createProtocolError(
              ProtocolErrorCode.UNKNOWN_METHOD,
              `Method "${request.method}" is not recognized by this protocol server`
            )
          );
      }
    } catch (err: unknown) {
      return this.createInternalErrorResponse(request.id, err);
    } finally {
      session.outstandingRequests--;
    }
  }

  /**
   * Enqueues a mutation command into the asynchronous queue, returning an acknowledgment
   * without running layout or synchronous mutations.
   */
  private enqueueCommand(
    method: string,
    params: Record<string, unknown>,
    requestId: string,
    clientId: string
  ): ProtocolResponse {
    if (this.commandQueue.length >= MAX_QUEUE_LENGTH) {
      return this.createErrorResponse(
        requestId,
        createProtocolError(
          ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED,
          `Command queue limit of ${MAX_QUEUE_LENGTH} exceeded`
        )
      );
    }

    const expectedRevision = typeof params.expectedRevision === "number" ? params.expectedRevision : undefined;
    const idempotencyKey = typeof params.idempotencyKey === "string" ? params.idempotencyKey : undefined;

    // Idempotency check scoped by (client, method, key)
    if (idempotencyKey) {
      const storeKey = `${clientId}::${method}::${idempotencyKey}`;
      const payloadHash = computeCanonicalPayloadHash(params);
      const existing = this.idempotencyStore.get(storeKey);

      if (existing) {
        if (existing.payloadHash === payloadHash) {
          return this.createSuccessResponse(requestId, existing.response);
        }
        return this.createErrorResponse(
          requestId,
          createProtocolError(
            ProtocolErrorCode.IDEMPOTENCY_CONFLICT,
            `Idempotency key "${idempotencyKey}" already reused with different command payload`
          )
        );
      }
    }

    // Revision conflict check
    if (expectedRevision !== undefined && expectedRevision !== this.currentRevision) {
      return this.createErrorResponse(
        requestId,
        createProtocolError(
          ProtocolErrorCode.REVISION_CONFLICT,
          `Expected revision ${expectedRevision} does not match current state revision ${this.currentRevision}`
        )
      );
    }

    this.commandSeq++;
    this.nextRevision++;
    const commandId = `cmd-${this.commandSeq}`;

    this.commandQueue.push({
      id: commandId,
      method,
      params,
      idempotencyKey,
      clientId
    });

    const ack: RuntimeCommandAckResult = {
      acknowledged: true,
      commandId,
      stateRevision: this.nextRevision
    };

    if (idempotencyKey) {
      const storeKey = `${clientId}::${method}::${idempotencyKey}`;
      const payloadHash = computeCanonicalPayloadHash(params);

      // Bound cache using FIFO eviction
      if (this.idempotencyStore.size >= MAX_IDEMPOTENCY_CACHE_SIZE) {
        const oldestKey = this.idempotencyKeyOrder.shift();
        if (oldestKey) {
          this.idempotencyStore.delete(oldestKey);
        }
      }

      this.idempotencyStore.set(storeKey, {
        clientId,
        method,
        key: idempotencyKey,
        payloadHash,
        response: ack
      });
      this.idempotencyKeyOrder.push(storeKey);
    }

    return this.createSuccessResponse(requestId, ack);
  }

  /**
   * Emits an asynchronous protocol event to subscribers that completed handshake.
   */
  public emitEvent(eventName: string, data: unknown): ProtocolEvent {
    this.eventSeq++;
    const cfg = this.runtime.getConfig ? this.runtime.getConfig() : {};
    const shouldRedact = Boolean(cfg.redactIdentities);

    const sanitizedData = sanitizeOutboundPayload(data, shouldRedact);

    const eventMessage: ProtocolEvent = {
      protocol: PROTOCOL_NAME,
      majorVersion: PROTOCOL_MAJOR_VERSION,
      minorVersion: PROTOCOL_MINOR_VERSION,
      id: `evt-${this.eventSeq}`,
      kind: "event",
      event: eventName,
      data: sanitizedData
    };

    const frameBytes = encodeFrame(eventMessage);

    for (const session of this.sessions.values()) {
      if (!session.helloCompleted || !session.eventCallback) {
        continue;
      }
      if (session.subscriptions.has(eventName) || session.subscriptions.has("*")) {
        try {
          session.eventCallback(eventMessage, frameBytes);
        } catch {
          // Suppress callback failure
        }
      }
    }

    return eventMessage;
  }

  /**
   * Wire-level byte processing: decodes frames from client-specific byte stream,
   * processes requests, and returns encoded response frames.
   */
  public async processBytes(chunk: Uint8Array, clientId = "default"): Promise<Uint8Array[]> {
    const session = this.getSession(clientId);
    const decodedResults = session.decoder.push(chunk);
    const outFrames: Uint8Array[] = [];

    for (const res of decodedResults) {
      if (!res.ok) {
        const errResp = this.createErrorResponse("unknown", res.error);
        outFrames.push(encodeFrame(errResp));
        continue;
      }

      const envelope = res.message;
      if (envelope.kind === "request") {
        const resp = await this.handleRequest(envelope as ProtocolRequest, clientId);
        outFrames.push(encodeFrame(resp));
      }
    }

    return outFrames;
  }

  private getRequiredCapability(method: string): ProtocolCapability | null {
    if (method.startsWith("state.") || method === "runtime.getVersion" || method === "config.get") {
      return "state.inspect";
    }
    if (method.startsWith("config.")) {
      return "config.mutate";
    }
    if (method.startsWith("runtime.")) {
      return "runtime.control";
    }
    if (method.startsWith("trace.")) {
      return "trace.inspect";
    }
    return null;
  }

  private createSuccessResponse<T>(replyTo: string, result: T): ProtocolResponse<T> {
    this.responseSeq++;
    return {
      protocol: PROTOCOL_NAME,
      majorVersion: PROTOCOL_MAJOR_VERSION,
      minorVersion: PROTOCOL_MINOR_VERSION,
      id: `resp-${this.responseSeq}`,
      kind: "response",
      replyTo,
      ok: true,
      result
    };
  }

  private createErrorResponse(replyTo: string, error: ProtocolError): ProtocolResponse {
    this.responseSeq++;
    const cfg = this.runtime.getConfig ? this.runtime.getConfig() : {};
    const shouldRedact = Boolean(cfg.redactIdentities);

    const rawErrorData = error.toJSON();
    const sanitizedDetails = sanitizeOutboundPayload(rawErrorData.details, shouldRedact);

    return {
      protocol: PROTOCOL_NAME,
      majorVersion: PROTOCOL_MAJOR_VERSION,
      minorVersion: PROTOCOL_MINOR_VERSION,
      id: `resp-${this.responseSeq}`,
      kind: "response",
      replyTo,
      ok: false,
      error: {
        code: rawErrorData.code,
        message: rawErrorData.message,
        ...(sanitizedDetails !== undefined ? { details: sanitizedDetails } : {})
      }
    };
  }

  private createInternalErrorResponse(replyTo: string, _rawError: unknown): ProtocolResponse {
    void _rawError;
    this.correlationSeq++;
    const correlationId = `err-token-${this.correlationSeq}`;

    return this.createErrorResponse(
      replyTo,
      createProtocolError(
        ProtocolErrorCode.INTERNAL_ERROR,
        "An internal server error occurred",
        { correlationId }
      )
    );
  }
}

export class ReferenceClient {
  private readonly server: ReferenceServer;
  private readonly clientId: string;
  private readonly eventCallbacks = new Map<string, Array<(data: unknown) => void>>();
  private requestSeq = 0;

  constructor(server: ReferenceServer, clientId?: string) {
    this.server = server;
    this.clientId = clientId ?? "client-test";

    this.server.registerSessionCallback(this.clientId, (evt: ProtocolEvent) => {
      const callbacks = this.eventCallbacks.get(evt.event) ?? [];
      for (const cb of callbacks) {
        cb(evt.data);
      }
    });
  }

  public async hello(
    clientName = "tessera-client",
    clientVersion = "1.0.0",
    requestedCapabilities?: string[]
  ): Promise<HelloResult> {
    const resp = await this.sendRequest<HelloResult>("system.hello", {
      clientName,
      clientVersion,
      minMajor: 1,
      maxMajor: 1,
      minMinor: 0,
      maxMinor: 0,
      requestedCapabilities
    });

    // Auto-subscribe to all events for client convenience
    await this.subscribe([
      "runtime.ready",
      "runtime.stateChanged",
      "runtime.transactionCommitted",
      "runtime.configurationChanged",
      "runtime.capabilitiesChanged",
      "runtime.warning"
    ]);

    return resp;
  }

  public async subscribe(events: string[]): Promise<string[]> {
    const res = await this.sendRequest<SystemSubscribeResult>("system.subscribe", { events });
    return res.subscribed;
  }

  public async unsubscribe(events: string[]): Promise<string[]> {
    const res = await this.sendRequest<SystemUnsubscribeResult>("system.unsubscribe", { events });
    return res.subscribed;
  }

  public async sendRequest<TResult>(method: string, params?: unknown): Promise<TResult> {
    this.requestSeq++;
    const req: ProtocolRequest = {
      protocol: PROTOCOL_NAME,
      majorVersion: PROTOCOL_MAJOR_VERSION,
      minorVersion: PROTOCOL_MINOR_VERSION,
      id: `req-${this.requestSeq}`,
      kind: "request",
      method,
      params: (params as Record<string, unknown>) ?? {}
    };

    const resp = await this.server.handleRequest(req, this.clientId);
    if (!resp.ok) {
      const code = (resp.error?.code as ProtocolErrorCode) ?? ProtocolErrorCode.INTERNAL_ERROR;
      const msg = resp.error?.message ?? "Unknown protocol error";
      throw createProtocolError(code, msg, resp.error?.details);
    }

    return resp.result as TResult;
  }

  /**
   * Executes a round-trip using encoded byte framing over the wire simulation.
   */
  public async sendRequestOverWire<TResult>(method: string, params?: unknown): Promise<TResult> {
    this.requestSeq++;
    const req: ProtocolRequest = {
      protocol: PROTOCOL_NAME,
      majorVersion: PROTOCOL_MAJOR_VERSION,
      minorVersion: PROTOCOL_MINOR_VERSION,
      id: `req-${this.requestSeq}`,
      kind: "request",
      method,
      params: (params as Record<string, unknown>) ?? {}
    };

    const requestBytes = encodeFrame(req);
    const responseFrames = await this.server.processBytes(requestBytes, this.clientId);
    if (responseFrames.length === 0) {
      throw createProtocolError(ProtocolErrorCode.INTERNAL_ERROR, "Server returned no response frames");
    }

    const clientDecoder = new StreamingFrameDecoder();
    const decoded = clientDecoder.push(responseFrames[0]);
    if (decoded.length === 0 || !decoded[0].ok) {
      const err = decoded[0] && !decoded[0].ok ? decoded[0].error : createProtocolError(ProtocolErrorCode.DECODE_ERROR, "Failed to decode response frame");
      throw err;
    }

    const resp = decoded[0].message as ProtocolResponse;
    if (!resp.ok) {
      const code = (resp.error?.code as ProtocolErrorCode) ?? ProtocolErrorCode.INTERNAL_ERROR;
      const msg = resp.error?.message ?? "Unknown protocol error";
      throw createProtocolError(code, msg, resp.error?.details);
    }

    return resp.result as TResult;
  }

  public onEvent<TData>(eventName: string, callback: (data: TData) => void): () => void {
    const list = this.eventCallbacks.get(eventName) ?? [];
    list.push(callback as (data: unknown) => void);
    this.eventCallbacks.set(eventName, list);

    return () => {
      const current = this.eventCallbacks.get(eventName) ?? [];
      const idx = current.indexOf(callback as (data: unknown) => void);
      if (idx !== -1) current.splice(idx, 1);
    };
  }

  public dispose(): void {
    this.eventCallbacks.clear();
    this.server.removeSession(this.clientId);
  }
}
