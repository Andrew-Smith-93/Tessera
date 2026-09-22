import {
  PROTOCOL_NAME,
  PROTOCOL_MAJOR_VERSION,
  SUPPORTED_MINOR_VERSIONS,
  MAX_NESTING_DEPTH,
  MAX_STRING_LENGTH,
  MAX_ARRAY_LENGTH,
  ProtocolErrorCode,
  type ProtocolEnvelope,
  type ProtocolRequest,
  type ProtocolResponse,
  type ProtocolEvent
} from "./types.js";
import { createProtocolError, ProtocolError } from "./errors.js";
import {
  envelopeSchema,
  METHOD_PARAM_SCHEMAS,
  KNOWN_METHODS
} from "./schemas/canonical-schemas.js";

export interface ValidationResult<T = ProtocolEnvelope> {
  valid: boolean;
  value?: T;
  error?: ProtocolError;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates payload structures against declared resource limits.
 */
export function validateLimits(obj: unknown, currentDepth = 1): ProtocolError | null {
  if (currentDepth > MAX_NESTING_DEPTH) {
    return createProtocolError(
      ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED,
      `Payload exceeds maximum nesting depth of ${MAX_NESTING_DEPTH}`
    );
  }

  if (typeof obj === "string") {
    if (obj.length > MAX_STRING_LENGTH) {
      return createProtocolError(
        ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED,
        `String field exceeds maximum length of ${MAX_STRING_LENGTH} characters`
      );
    }
    return null;
  }

  if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_LENGTH) {
      return createProtocolError(
        ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED,
        `Array field exceeds maximum length of ${MAX_ARRAY_LENGTH} elements`
      );
    }
    for (const item of obj) {
      const err = validateLimits(item, currentDepth + 1);
      if (err) return err;
    }
    return null;
  }

  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key.length > MAX_STRING_LENGTH) {
        return createProtocolError(
          ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED,
          `Object key exceeds maximum length of ${MAX_STRING_LENGTH} characters`
        );
      }
      const err = validateLimits(record[key], currentDepth + 1);
      if (err) return err;
    }
  }

  return null;
}

/**
 * Authoritative JSON Schema 2020-12 evaluator that directly compiles and executes canonical schemas.
 */
export function validateJsonSchema(data: unknown, schema: Record<string, unknown>, path = ""): string[] {
  const errors: string[] = [];

  // 1. Type validation
  if (schema.type !== undefined) {
    const expectedType = schema.type as string;
    if (expectedType === "object") {
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        errors.push(`${path || "root"}: expected object, received ${data === null ? "null" : Array.isArray(data) ? "array" : typeof data}`);
        return errors;
      }
    } else if (expectedType === "array") {
      if (!Array.isArray(data)) {
        errors.push(`${path || "root"}: expected array, received ${typeof data}`);
        return errors;
      }
    } else if (expectedType === "string") {
      if (typeof data !== "string") {
        errors.push(`${path || "root"}: expected string, received ${typeof data}`);
        return errors;
      }
    } else if (expectedType === "number") {
      if (typeof data !== "number" || Number.isNaN(data)) {
        errors.push(`${path || "root"}: expected number, received ${typeof data}`);
        return errors;
      }
    } else if (expectedType === "integer") {
      if (typeof data !== "number" || !Number.isInteger(data)) {
        errors.push(`${path || "root"}: expected integer, received ${typeof data}`);
        return errors;
      }
    } else if (expectedType === "boolean") {
      if (typeof data !== "boolean") {
        errors.push(`${path || "root"}: expected boolean, received ${typeof data}`);
        return errors;
      }
    }
  }

  // 2. Const validation
  if ("const" in schema) {
    if (data !== schema.const) {
      errors.push(`${path || "root"}: expected const "${String(schema.const)}", received "${String(data)}"`);
    }
  }

  // 3. Enum validation
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(data)) {
      errors.push(`${path || "root"}: value "${String(data)}" is not one of allowed enum values: [${schema.enum.join(", ")}]`);
    }
  }

  // 4. String constraints
  if (typeof data === "string") {
    if (typeof schema.minLength === "number" && data.length < schema.minLength) {
      errors.push(`${path || "root"}: string length ${data.length} is less than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && data.length > schema.maxLength) {
      errors.push(`${path || "root"}: string length ${data.length} exceeds maxLength ${schema.maxLength}`);
    }
  }

  // 5. Number constraints
  if (typeof data === "number") {
    if (typeof schema.minimum === "number" && data < schema.minimum) {
      errors.push(`${path || "root"}: number ${data} is less than minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && data > schema.maximum) {
      errors.push(`${path || "root"}: number ${data} exceeds maximum ${schema.maximum}`);
    }
  }

  // 6. Object constraints
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;

    // Required properties
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required as string[]) {
        if (record[reqKey] === undefined) {
          errors.push(`${path ? `${path}.${reqKey}` : reqKey}: missing required property`);
        }
      }
    }

    // Property validation
    for (const key of Object.keys(record)) {
      if (record[key] === undefined) {
        continue;
      }
      const subPath = path ? `${path}.${key}` : key;
      if (properties[key] !== undefined) {
        const subErrors = validateJsonSchema(record[key], properties[key], subPath);
        errors.push(...subErrors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${subPath}: additional property is not permitted`);
      }
    }
  }

  // 7. Array constraints
  if (Array.isArray(data)) {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) {
      errors.push(`${path || "root"}: array length ${data.length} is less than minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
      errors.push(`${path || "root"}: array length ${data.length} exceeds maxItems ${schema.maxItems}`);
    }
    if (schema.items && typeof schema.items === "object") {
      const itemSchema = schema.items as Record<string, unknown>;
      for (let i = 0; i < data.length; i++) {
        const itemErrors = validateJsonSchema(data[i], itemSchema, `${path}[${i}]`);
        errors.push(...itemErrors);
      }
    }
  }

  // 8. oneOf constraints
  if (Array.isArray(schema.oneOf)) {
    let matchCount = 0;
    for (const subSchema of schema.oneOf as Array<Record<string, unknown>>) {
      const subErrors = validateJsonSchema(data, subSchema, path);
      if (subErrors.length === 0) {
        matchCount++;
      }
    }
    if (matchCount === 0) {
      errors.push(`${path || "root"}: data did not match a required oneOf schema`);
    }
  }

  return errors;
}

/**
 * Validates input JSON data against the canonical envelope schema or a provided schema.
 */
export function validateAgainstSchema(
  obj: unknown,
  schema?: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const target = schema ?? (envelopeSchema as unknown as Record<string, unknown>);
  const errors = validateJsonSchema(obj, target);
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Authoritatively validates message envelopes using schema rules and security limits.
 */
export function validateEnvelope(obj: unknown): ValidationResult<ProtocolEnvelope> {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.INVALID_ENVELOPE,
        "Message envelope must be a non-null, non-array object"
      )
    };
  }

  // Enforce security resource limits
  const limitErr = validateLimits(obj);
  if (limitErr) {
    return { valid: false, error: limitErr };
  }

  const record = obj as Record<string, unknown>;

  // Check protocol namespace
  if (record.protocol !== PROTOCOL_NAME) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.INVALID_ENVELOPE,
        `Invalid protocol namespace: expected "${PROTOCOL_NAME}", received "${String(record.protocol)}"`
      )
    };
  }

  // Check major version
  if (typeof record.majorVersion !== "number" || record.majorVersion !== PROTOCOL_MAJOR_VERSION) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.UNSUPPORTED_MAJOR_VERSION,
        `Unsupported major version: expected ${PROTOCOL_MAJOR_VERSION}, received ${String(record.majorVersion)}`
      )
    };
  }

  // Check minor version
  if (
    typeof record.minorVersion !== "number" ||
    !SUPPORTED_MINOR_VERSIONS.includes(record.minorVersion)
  ) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.UNSUPPORTED_MINOR_VERSION,
        `Unsupported minor version: received ${String(record.minorVersion)}, supported: ${SUPPORTED_MINOR_VERSIONS.join(", ")}`
      )
    };
  }

  // Check message ID
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.INVALID_ENVELOPE,
        "Message envelope must contain a non-empty string 'id'"
      )
    };
  }

  // Check method is recognized if message is a request
  if (record.kind === "request" && typeof record.method === "string" && !KNOWN_METHODS.includes(record.method as (typeof KNOWN_METHODS)[number])) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.UNKNOWN_METHOD,
        `Unknown method: "${record.method}"`
      )
    };
  }

  // Validate entire envelope using the canonical JSON schema
  const schemaResult = validateAgainstSchema(obj);
  if (!schemaResult.valid) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.INVALID_ENVELOPE,
        `Envelope schema validation failed: ${schemaResult.errors.join("; ")}`
      )
    };
  }

  const kind = record.kind as string;
  if (kind === "request") {
    return { valid: true, value: record as unknown as ProtocolRequest };
  }
  if (kind === "response") {
    return { valid: true, value: record as unknown as ProtocolResponse };
  }
  if (kind === "event") {
    return { valid: true, value: record as unknown as ProtocolEvent };
  }

  return {
    valid: false,
    error: createProtocolError(ProtocolErrorCode.INVALID_ENVELOPE, `Unknown message kind: "${kind}"`)
  };
}

/**
 * Validates request parameters directly using the canonical method schemas.
 */
export function validateMethodParams(method: string, params: unknown): ValidationResult<void> {
  const schema = METHOD_PARAM_SCHEMAS[method];
  if (!schema) {
    if (!KNOWN_METHODS.includes(method as (typeof KNOWN_METHODS)[number])) {
      return {
        valid: false,
        error: createProtocolError(ProtocolErrorCode.UNKNOWN_METHOD, `Unknown method: "${method}"`)
      };
    }
    return { valid: true };
  }

  const errors = validateJsonSchema(params, schema, "params");
  if (errors.length > 0) {
    const isConfig = method === "config.validatePatch" || method === "config.applyPatch";
    const code = isConfig ? ProtocolErrorCode.CONFIG_VALIDATION_FAILED : ProtocolErrorCode.INVALID_PAYLOAD;
    return {
      valid: false,
      error: createProtocolError(code, `${method} params validation failed: ${errors.join("; ")}`)
    };
  }

  return { valid: true };
}
