import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  ProtocolErrorCode,
  V1_CAPABILITIES,
  type ProtocolCapability,
  type ProtocolRequest,
  type ProtocolResponse,
  type ProtocolEvent,
  type HelloParams,
  type HelloResult,
  type ProtocolRetainedScreen,
  type ProtocolRetainedWindow,
  type GetScreenOrderParams,
  type GetScreenOrderResult,
  type ConfigSetParams,
  type ConfigSetResult,
  type RuntimeReconcileParams,
  type RuntimeReconcileResult,
  type TraceDumpParams,
  type TraceDumpResult
} from "./types.js";
import { createProtocolError, ProtocolError } from "./errors.js";
import { validateMethodParams } from "./validator.js";
import { encodeFrame, StreamingFrameDecoder } from "./codec.js";

export interface CoordinatorRuntimeTarget {
  getRetainedScreens(): readonly any[];
  getRetainedWindows(): readonly any[];
  getRetainedScreen(outputId: string): any;
  reconcile(forceScreenId?: string): any;
  getDiagnostics(): any;
  getConfig?(): any;
  updateConfig?(config: any): void;
  getTraceRecorder?(): any;
}

export interface ServerSession {
  clientName?: string;
  clientVersion?: string;
  negotiatedCapabilities: Set<string>;
  helloCompleted: boolean;
}

export class ReferenceServer {
  private readonly runtime: CoordinatorRuntimeTarget;
  private readonly serverVersion: string;
  private readonly eventListeners: Array<(event: ProtocolEvent, frameBytes: Uint8Array) => void> = [];
  private readonly sessions = new Map<string, ServerSession>();
  private readonly decoder = new StreamingFrameDecoder();

  constructor(runtime: CoordinatorRuntimeTarget, options?: { serverVersion?: string }) {
    this.runtime = runtime;
    this.serverVersion = options?.serverVersion ?? "1.0.0";
  }

  private getOrCreateSession(clientId = "default"): ServerSession {
    let session = this.sessions.get(clientId);
    if (!session) {
      session = {
        negotiatedCapabilities: new Set(),
        helloCompleted: false
      };
      this.sessions.set(clientId, session);
    }
    return session;
  }

  /**
   * Dispatches a typed ProtocolRequest and returns a ProtocolResponse.
   */
  public async handleRequest(request: ProtocolRequest, clientId = "default"): Promise<ProtocolResponse> {
    const session = this.getOrCreateSession(clientId);

    // 1. Handle system.hello (handshake)
    if (request.method === "system.hello") {
      const validation = validateMethodParams("system.hello", request.params);
      if (!validation.valid && validation.error) {
        return this.createErrorResponse(request.id, validation.error);
      }

      const params = (request.params ?? {}) as unknown as HelloParams;
      const requested = new Set(params.requestedCapabilities ?? V1_CAPABILITIES);
      const granted: string[] = [];

      for (const cap of V1_CAPABILITIES) {
        if (requested.has(cap)) {
          granted.push(cap);
          session.negotiatedCapabilities.add(cap);
        }
      }

      session.clientName = params.clientName;
      session.clientVersion = params.clientVersion;
      session.helloCompleted = true;

      const helloResult: HelloResult = {
        serverName: "tessera-runtime",
        serverVersion: this.serverVersion,
        protocolVersion: PROTOCOL_VERSION,
        capabilities: granted
      };

      return this.createSuccessResponse(request.id, helloResult);
    }

    // 2. Enforce capabilities for all other methods
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

    // 3. Dispatch specific V1 methods
    try {
      switch (request.method) {
        case "state.getRetainedScreens": {
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
          return this.createSuccessResponse(request.id, { screens });
        }

        case "state.getRetainedWindows": {
          const cfg = this.runtime.getConfig ? this.runtime.getConfig() : {};
          const shouldRedact = Boolean(cfg.redactIdentities);

          const windows: ProtocolRetainedWindow[] = this.runtime.getRetainedWindows().map(w => ({
            id: w.id,
            resourceClass: shouldRedact ? "[REDACTED]" : w.resourceClass,
            outputId: w.outputId,
            classification: w.classification,
            tileable: w.tileable,
            minimized: w.minimized,
            fullScreen: w.fullScreen,
            noBorder: w.noBorder,
            maximizeMode: w.maximizeMode,
            isManualFloating: w.isManualFloating,
            frameGeometry: { ...w.frameGeometry },
            desiredGeometry: w.currentDesiredTiledGeometry ? { ...w.currentDesiredTiledGeometry } : null,
            preMinimizeGeometry: w.preMinimizeGeometry ? { ...w.preMinimizeGeometry } : null,
            outputAffinity: w.outputAffinity
          }));
          return this.createSuccessResponse(request.id, { windows });
        }

        case "state.getScreenOrder": {
          const validation = validateMethodParams("state.getScreenOrder", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const params = (request.params ?? {}) as unknown as GetScreenOrderParams;
          const screen = this.runtime.getRetainedScreen(params.outputId);
          if (!screen) {
            return this.createErrorResponse(
              request.id,
              createProtocolError(
                ProtocolErrorCode.INVALID_PARAMS,
                `Screen with outputId "${params.outputId}" not found`
              )
            );
          }
          const result: GetScreenOrderResult = {
            outputId: screen.outputId,
            orderedWindowIds: [...screen.orderedWindowIds],
            persistentOrder: [...screen.persistentOrder]
          };
          return this.createSuccessResponse(request.id, result);
        }

        case "config.get": {
          const config = this.runtime.getConfig ? this.runtime.getConfig() : {};
          return this.createSuccessResponse(request.id, { config: { ...config } });
        }

        case "config.set": {
          const validation = validateMethodParams("config.set", request.params);
          if (!validation.valid && validation.error) {
            return this.createErrorResponse(request.id, validation.error);
          }
          const params = (request.params ?? {}) as unknown as ConfigSetParams;
          if (this.runtime.updateConfig) {
            this.runtime.updateConfig(params.config);
          }
          const appliedResult: ConfigSetResult = {
            success: true,
            applied: { ...params.config }
          };
          return this.createSuccessResponse(request.id, appliedResult);
        }

        case "runtime.reconcile": {
          const params = (request.params ?? {}) as unknown as RuntimeReconcileParams;
          const tx = this.runtime.reconcile(params.forceScreenId);
          const result: RuntimeReconcileResult = {
            transaction: tx
              ? {
                  epoch: tx.epoch,
                  reasons: [...tx.reasons],
                  affectedScreens: [...tx.affectedScreens],
                  operations: tx.operations.map((op: any) => ({
                    windowId: op.windowId,
                    targetRect: { ...op.targetRect },
                    previousRect: op.previousRect ? { ...op.previousRect } : undefined
                  })),
                  skippedWrites: tx.skippedWrites
                }
              : null
          };
          return this.createSuccessResponse(request.id, result);
        }

        case "runtime.getDiagnostics": {
          const diagnostics = this.runtime.getDiagnostics();
          return this.createSuccessResponse(request.id, { diagnostics: { ...diagnostics } });
        }

        case "trace.dump": {
          const params = (request.params ?? {}) as unknown as TraceDumpParams;
          const recorder = this.runtime.getTraceRecorder ? this.runtime.getTraceRecorder() : null;
          let entries = recorder ? recorder.getEntries() : [];
          if (params.limit !== undefined && params.limit > 0) {
            entries = entries.slice(-params.limit);
          }
          const dumpResult: TraceDumpResult = {
            entries: entries.map((e: any) => ({
              tick: e.tick ?? 0,
              timestamp: e.timestamp,
              event: { ...e.event }
            }))
          };
          return this.createSuccessResponse(request.id, dumpResult);
        }

        case "trace.clear": {
          const recorder = this.runtime.getTraceRecorder ? this.runtime.getTraceRecorder() : null;
          let cleared = 0;
          if (recorder && typeof recorder.clear === "function") {
            cleared = recorder.clear();
          }
          return this.createSuccessResponse(request.id, { cleared });
        }

        default:
          return this.createErrorResponse(
            request.id,
            createProtocolError(
              ProtocolErrorCode.UNKNOWN_METHOD,
              `Method "${request.method}" is not supported by this server`
            )
          );
      }
    } catch (err: unknown) {
      return this.createErrorResponse(
        request.id,
        createProtocolError(
          ProtocolErrorCode.INTERNAL_ERROR,
          `Internal server error: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }

  /**
   * Broadcasts an asynchronous protocol event to all subscribers.
   */
  public emitEvent(eventName: string, data: unknown): ProtocolEvent {
    const eventMessage: ProtocolEvent = {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      type: "event",
      event: eventName,
      data
    };

    const frameBytes = encodeFrame(eventMessage);
    for (const listener of this.eventListeners) {
      try {
        listener(eventMessage, frameBytes);
      } catch {
        // Suppress listener errors
      }
    }

    return eventMessage;
  }

  /**
   * Subscribes a listener to emitted protocol events.
   */
  public onEvent(listener: (event: ProtocolEvent, frameBytes: Uint8Array) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx !== -1) this.eventListeners.splice(idx, 1);
    };
  }

  /**
   * Wire-level byte processing: decodes frames from byte stream, processes requests,
   * and returns encoded response frames.
   */
  public async processBytes(chunk: Uint8Array, clientId = "default"): Promise<Uint8Array[]> {
    const decodedResults = this.decoder.push(chunk);
    const outFrames: Uint8Array[] = [];

    for (const res of decodedResults) {
      if (!res.ok) {
        // Return an error response frame
        const errResp = this.createErrorResponse("unknown", res.error);
        outFrames.push(encodeFrame(errResp));
        continue;
      }

      const envelope = res.message;
      if (envelope.type === "request") {
        const resp = await this.handleRequest(envelope as ProtocolRequest, clientId);
        outFrames.push(encodeFrame(resp));
      }
    }

    return outFrames;
  }

  private getRequiredCapability(method: string): ProtocolCapability | null {
    if (method.startsWith("state.") || method === "runtime.getDiagnostics" || method === "config.get") {
      return "state.inspect";
    }
    if (method === "config.set") {
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
    return {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      id: `resp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      type: "response",
      replyTo,
      ok: true,
      result
    };
  }

  private createErrorResponse(replyTo: string, error: ProtocolError): ProtocolResponse {
    return {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      id: `resp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      type: "response",
      replyTo,
      ok: false,
      error: error.toJSON()
    };
  }
}

export class ReferenceClient {
  private readonly server: ReferenceServer;
  private readonly clientId: string;
  private readonly eventCallbacks = new Map<string, Array<(data: unknown) => void>>();
  private cleanupServerEvents: (() => void) | null = null;
  private nextRequestId = 1;

  constructor(server: ReferenceServer, clientId = `client-${Math.random().toString(36).substring(2, 8)}`) {
    this.server = server;
    this.clientId = clientId;

    this.cleanupServerEvents = this.server.onEvent((evt: ProtocolEvent) => {
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
      requestedCapabilities
    });
    return resp;
  }

  public async sendRequest<TResult>(method: string, params?: unknown): Promise<TResult> {
    const req: ProtocolRequest = {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      id: `req-${this.nextRequestId++}`,
      type: "request",
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
    const req: ProtocolRequest = {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      id: `req-${this.nextRequestId++}`,
      type: "request",
      method,
      params: (params as Record<string, unknown>) ?? {}
    };

    // Encode request frame
    const requestBytes = encodeFrame(req);

    // Stream bytes to server
    const responseFrames = await this.server.processBytes(requestBytes, this.clientId);
    if (responseFrames.length === 0) {
      throw createProtocolError(ProtocolErrorCode.INTERNAL_ERROR, "Server returned no response frames");
    }

    // Decode response frame on client side
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
    if (this.cleanupServerEvents) {
      this.cleanupServerEvents();
      this.cleanupServerEvents = null;
    }
    this.eventCallbacks.clear();
  }
}
