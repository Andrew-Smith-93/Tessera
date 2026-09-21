export const KNOWN_METHODS = [
  "system.hello",
  "state.getSnapshot",
  "state.getDiagnostics",
  "state.getCapabilities",
  "config.get",
  "config.validatePatch",
  "config.applyPatch",
  "runtime.requestReconcile",
  "runtime.setLayout",
  "runtime.setMasterCount",
  "runtime.setMasterRatio",
  "runtime.setWindowFloating",
  "runtime.getVersion",
  "trace.getRecent",
  "trace.clearRecent"
] as const;

export const KNOWN_EVENTS = [
  "runtime.ready",
  "runtime.stateChanged",
  "runtime.transactionCommitted",
  "runtime.configurationChanged",
  "runtime.capabilitiesChanged",
  "runtime.warning"
] as const;

export const envelopeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tessera.wm/schemas/v1/envelope.json",
  title: "TesseraProtocolEnvelope",
  type: "object",
  required: ["protocol", "majorVersion", "minorVersion", "kind", "id"],
  properties: {
    protocol: { type: "string", const: "tessera.ipc" },
    majorVersion: { type: "integer", const: 1 },
    minorVersion: { type: "integer", minimum: 0 },
    kind: { type: "string", enum: ["request", "response", "event"] },
    id: { type: "string", minLength: 1 },
    metadata: { type: "object" }
  },
  oneOf: [
    {
      properties: {
        kind: { const: "request" },
        method: { type: "string", enum: KNOWN_METHODS },
        params: { type: "object" }
      },
      required: ["method"]
    },
    {
      properties: {
        kind: { const: "response" },
        replyTo: { type: "string", minLength: 1 },
        ok: { type: "boolean" },
        result: {},
        error: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "string", minLength: 1 },
            message: { type: "string" },
            details: {}
          }
        }
      },
      required: ["replyTo", "ok"]
    },
    {
      properties: {
        kind: { const: "event" },
        event: { type: "string", enum: KNOWN_EVENTS },
        data: {}
      },
      required: ["event"]
    }
  ]
} as const;

export const requestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tessera.wm/schemas/v1/request.json",
  title: "TesseraProtocolRequest",
  type: "object",
  required: ["protocol", "majorVersion", "minorVersion", "kind", "id", "method"],
  properties: {
    protocol: { type: "string", const: "tessera.ipc" },
    majorVersion: { type: "integer", const: 1 },
    minorVersion: { type: "integer", minimum: 0 },
    kind: { type: "string", const: "request" },
    id: { type: "string", minLength: 1 },
    method: { type: "string", enum: KNOWN_METHODS },
    params: { type: "object" },
    metadata: { type: "object" }
  },
  additionalProperties: false
} as const;

export const responseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tessera.wm/schemas/v1/response.json",
  title: "TesseraProtocolResponse",
  type: "object",
  required: ["protocol", "majorVersion", "minorVersion", "kind", "id", "replyTo", "ok"],
  properties: {
    protocol: { type: "string", const: "tessera.ipc" },
    majorVersion: { type: "integer", const: 1 },
    minorVersion: { type: "integer", minimum: 0 },
    kind: { type: "string", const: "response" },
    id: { type: "string", minLength: 1 },
    replyTo: { type: "string", minLength: 1 },
    ok: { type: "boolean" },
    result: {},
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", minLength: 1 },
        message: { type: "string" },
        details: {}
      }
    },
    metadata: { type: "object" }
  },
  additionalProperties: false
} as const;

export const eventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tessera.wm/schemas/v1/event.json",
  title: "TesseraProtocolEvent",
  type: "object",
  required: ["protocol", "majorVersion", "minorVersion", "kind", "id", "event"],
  properties: {
    protocol: { type: "string", const: "tessera.ipc" },
    majorVersion: { type: "integer", const: 1 },
    minorVersion: { type: "integer", minimum: 0 },
    kind: { type: "string", const: "event" },
    id: { type: "string", minLength: 1 },
    event: { type: "string", enum: KNOWN_EVENTS },
    data: {},
    metadata: { type: "object" }
  },
  additionalProperties: false
} as const;

export const errorSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tessera.wm/schemas/v1/error.json",
  title: "TesseraProtocolError",
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string", minLength: 1 },
    message: { type: "string" },
    details: {}
  },
  additionalProperties: false
} as const;
