export const envelopeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tessera.wm/schemas/v1/envelope.json",
  title: "TesseraProtocolEnvelope",
  type: "object",
  required: ["protocol", "version", "id", "type"],
  properties: {
    protocol: { type: "string", const: "tessera.ipc" },
    version: { type: "string", const: "1.0" },
    id: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["request", "response", "event"] }
  },
  oneOf: [
    {
      properties: {
        type: { const: "request" },
        method: { type: "string", minLength: 1 },
        params: { type: "object" }
      },
      required: ["method"]
    },
    {
      properties: {
        type: { const: "response" },
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
        type: { const: "event" },
        event: { type: "string", minLength: 1 },
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
  required: ["protocol", "version", "id", "type", "method"],
  properties: {
    protocol: { type: "string", const: "tessera.ipc" },
    version: { type: "string", const: "1.0" },
    id: { type: "string", minLength: 1 },
    type: { type: "string", const: "request" },
    method: { type: "string", minLength: 1 },
    params: { type: "object" }
  },
  additionalProperties: false
} as const;

export const responseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tessera.wm/schemas/v1/response.json",
  title: "TesseraProtocolResponse",
  type: "object",
  required: ["protocol", "version", "id", "type", "replyTo", "ok"],
  properties: {
    protocol: { type: "string", const: "tessera.ipc" },
    version: { type: "string", const: "1.0" },
    id: { type: "string", minLength: 1 },
    type: { type: "string", const: "response" },
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
  additionalProperties: false
} as const;

export const eventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tessera.wm/schemas/v1/event.json",
  title: "TesseraProtocolEvent",
  type: "object",
  required: ["protocol", "version", "id", "type", "event"],
  properties: {
    protocol: { type: "string", const: "tessera.ipc" },
    version: { type: "string", const: "1.0" },
    id: { type: "string", minLength: 1 },
    type: { type: "string", const: "event" },
    event: { type: "string", minLength: 1 },
    data: {}
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

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates an unknown object against the Tessera V1 Protocol Envelope JSON Schema.
 */
export function validateAgainstSchema(obj: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { valid: false, errors: ["Target must be a non-null object"] };
  }

  const rec = obj as Record<string, unknown>;

  // Base envelope properties
  if (rec.protocol !== "tessera.ipc") {
    errors.push(`Property 'protocol' must be 'tessera.ipc' (received: ${String(rec.protocol)})`);
  }

  if (rec.version !== "1.0") {
    errors.push(`Property 'version' must be '1.0' (received: ${String(rec.version)})`);
  }

  if (typeof rec.id !== "string" || rec.id.length === 0) {
    errors.push("Property 'id' must be a non-empty string");
  }

  if (rec.type !== "request" && rec.type !== "response" && rec.type !== "event") {
    errors.push(`Property 'type' must be 'request' | 'response' | 'event' (received: ${String(rec.type)})`);
    return { valid: false, errors };
  }

  if (rec.type === "request") {
    if (typeof rec.method !== "string" || rec.method.length === 0) {
      errors.push("Request property 'method' must be a non-empty string");
    }
    if (rec.params !== undefined && (typeof rec.params !== "object" || rec.params === null || Array.isArray(rec.params))) {
      errors.push("Request property 'params' must be an object if present");
    }
  } else if (rec.type === "response") {
    if (typeof rec.replyTo !== "string" || rec.replyTo.length === 0) {
      errors.push("Response property 'replyTo' must be a non-empty string");
    }
    if (typeof rec.ok !== "boolean") {
      errors.push("Response property 'ok' must be a boolean");
    }
    if (rec.ok === false) {
      if (typeof rec.error !== "object" || rec.error === null || Array.isArray(rec.error)) {
        errors.push("Failed response must include an 'error' object");
      } else {
        const errObj = rec.error as Record<string, unknown>;
        if (typeof errObj.code !== "string" || errObj.code.length === 0) {
          errors.push("Error object must contain a non-empty string 'code'");
        }
        if (typeof errObj.message !== "string") {
          errors.push("Error object must contain a string 'message'");
        }
      }
    }
  } else if (rec.type === "event") {
    if (typeof rec.event !== "string" || rec.event.length === 0) {
      errors.push("Event property 'event' must be a non-empty string");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
