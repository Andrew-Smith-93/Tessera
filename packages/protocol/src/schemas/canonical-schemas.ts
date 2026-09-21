export const KNOWN_METHODS = [
  "system.hello",
  "system.subscribe",
  "system.unsubscribe",
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

export type KnownMethod = typeof KNOWN_METHODS[number];

export const KNOWN_EVENTS = [
  "runtime.ready",
  "runtime.stateChanged",
  "runtime.transactionCommitted",
  "runtime.configurationChanged",
  "runtime.capabilitiesChanged",
  "runtime.warning"
] as const;

export type KnownEvent = typeof KNOWN_EVENTS[number];

export const KNOWN_CONFIG_KEYS = [
  "enableTiling",
  "defaultLayout",
  "gapInner",
  "gapOuter",
  "masterRatio",
  "masterCount",
  "redactIdentities",
  "gameWindowPolicy"
] as const;

export type KnownConfigKey = typeof KNOWN_CONFIG_KEYS[number];

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
        ok: { const: true },
        result: {},
        metadata: { type: "object" }
      },
      required: ["replyTo", "ok"]
    },
    {
      properties: {
        kind: { const: "response" },
        replyTo: { type: "string", minLength: 1 },
        ok: { const: false },
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
      required: ["replyTo", "ok", "error"]
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

export const METHOD_PARAM_SCHEMAS: Record<string, Record<string, unknown>> = {
  "system.hello": {
    type: "object",
    required: ["clientName", "clientVersion"],
    properties: {
      clientName: { type: "string", minLength: 1 },
      clientVersion: { type: "string", minLength: 1 },
      minMajor: { type: "integer" },
      maxMajor: { type: "integer" },
      minMinor: { type: "integer" },
      maxMinor: { type: "integer" },
      requestedCapabilities: {
        type: "array",
        items: { type: "string" }
      }
    },
    additionalProperties: false
  },
  "system.subscribe": {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: { type: "string" }
      },
      channels: {
        type: "array",
        items: { type: "string" }
      }
    },
    additionalProperties: false
  },
  "system.unsubscribe": {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: { type: "string" }
      },
      channels: {
        type: "array",
        items: { type: "string" }
      }
    },
    additionalProperties: false
  },
  "state.getSnapshot": {
    type: "object",
    additionalProperties: false
  },
  "state.getDiagnostics": {
    type: "object",
    additionalProperties: false
  },
  "state.getCapabilities": {
    type: "object",
    additionalProperties: false
  },
  "config.get": {
    type: "object",
    additionalProperties: false
  },
  "config.validatePatch": {
    type: "object",
    required: ["patch"],
    properties: {
      patch: {
        type: "object",
        properties: {
          enableTiling: { type: "boolean" },
          defaultLayout: { type: "string" },
          gapInner: { type: "number", minimum: 0 },
          gapOuter: { type: "number", minimum: 0 },
          masterRatio: { type: "number", minimum: 0.05, maximum: 0.95 },
          masterCount: { type: "integer", minimum: 1 },
          redactIdentities: { type: "boolean" },
          gameWindowPolicy: { type: "string" }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  },
  "config.applyPatch": {
    type: "object",
    required: ["patch"],
    properties: {
      patch: {
        type: "object",
        properties: {
          enableTiling: { type: "boolean" },
          defaultLayout: { type: "string" },
          gapInner: { type: "number", minimum: 0 },
          gapOuter: { type: "number", minimum: 0 },
          masterRatio: { type: "number", minimum: 0.05, maximum: 0.95 },
          masterCount: { type: "integer", minimum: 1 },
          redactIdentities: { type: "boolean" },
          gameWindowPolicy: { type: "string" }
        },
        additionalProperties: false
      },
      expectedRevision: { type: "integer" },
      idempotencyKey: { type: "string" }
    },
    additionalProperties: false
  },
  "runtime.requestReconcile": {
    type: "object",
    properties: {
      forceScreenId: { type: "string" },
      expectedRevision: { type: "integer" },
      idempotencyKey: { type: "string" }
    },
    additionalProperties: false
  },
  "runtime.setLayout": {
    type: "object",
    required: ["outputId", "layout"],
    properties: {
      outputId: { type: "string", minLength: 1 },
      layout: { type: "string", minLength: 1 },
      expectedRevision: { type: "integer" },
      idempotencyKey: { type: "string" }
    },
    additionalProperties: false
  },
  "runtime.setMasterCount": {
    type: "object",
    required: ["outputId", "count"],
    properties: {
      outputId: { type: "string", minLength: 1 },
      count: { type: "integer", minimum: 1 },
      expectedRevision: { type: "integer" },
      idempotencyKey: { type: "string" }
    },
    additionalProperties: false
  },
  "runtime.setMasterRatio": {
    type: "object",
    required: ["outputId", "ratio"],
    properties: {
      outputId: { type: "string", minLength: 1 },
      ratio: { type: "number", minimum: 0.05, maximum: 0.95 },
      expectedRevision: { type: "integer" },
      idempotencyKey: { type: "string" }
    },
    additionalProperties: false
  },
  "runtime.setWindowFloating": {
    type: "object",
    required: ["windowId", "floating"],
    properties: {
      windowId: { type: "string", minLength: 1 },
      floating: { type: "boolean" },
      expectedRevision: { type: "integer" },
      idempotencyKey: { type: "string" }
    },
    additionalProperties: false
  },
  "runtime.getVersion": {
    type: "object",
    additionalProperties: false
  },
  "trace.getRecent": {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1 }
    },
    additionalProperties: false
  },
  "trace.clearRecent": {
    type: "object",
    additionalProperties: false
  }
};
