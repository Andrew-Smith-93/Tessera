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

export interface ValidationResult<T = ProtocolEnvelope> {
  valid: boolean;
  value?: T;
  error?: ProtocolError;
}

const KNOWN_CONFIG_KEYS = new Set([
  "enableTiling",
  "defaultLayout",
  "gapInner",
  "gapOuter",
  "masterRatio",
  "masterCount",
  "redactIdentities",
  "gameWindowPolicy"
]);

/**
 * Checks value tree for nesting depth, string lengths, and array lengths.
 */
function validateLimits(obj: unknown, currentDepth = 1): ProtocolError | null {
  if (currentDepth > MAX_NESTING_DEPTH) {
    return createProtocolError(
      ProtocolErrorCode.INVALID_PAYLOAD,
      `Payload exceeds maximum nesting depth of ${MAX_NESTING_DEPTH}`
    );
  }

  if (typeof obj === "string") {
    if (obj.length > MAX_STRING_LENGTH) {
      return createProtocolError(
        ProtocolErrorCode.INVALID_PAYLOAD,
        `String field exceeds maximum length of ${MAX_STRING_LENGTH} characters`
      );
    }
    return null;
  }

  if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_LENGTH) {
      return createProtocolError(
        ProtocolErrorCode.INVALID_PAYLOAD,
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
    for (const key of Object.keys(obj)) {
      if (key.length > MAX_STRING_LENGTH) {
        return createProtocolError(
          ProtocolErrorCode.INVALID_PAYLOAD,
          `Object key exceeds maximum length of ${MAX_STRING_LENGTH} characters`
        );
      }
      const err = validateLimits((obj as Record<string, unknown>)[key], currentDepth + 1);
      if (err) return err;
    }
  }

  return null;
}

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

  // Check resource limits on envelope and payloads
  const limitErr = validateLimits(obj);
  if (limitErr) {
    return { valid: false, error: limitErr };
  }

  const record = obj as Record<string, unknown>;

  // Check protocol identifier
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

  // Check message kind
  const kind = record.kind;
  if (kind !== "request" && kind !== "response" && kind !== "event") {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.INVALID_ENVELOPE,
        `Invalid message kind: expected "request" | "response" | "event", received "${String(kind)}"`
      )
    };
  }

  switch (kind) {
    case "request": {
      if (typeof record.method !== "string" || record.method.trim().length === 0) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_ENVELOPE,
            "Request message must contain a non-empty string 'method'"
          )
        };
      }
      if (record.params !== undefined) {
        if (typeof record.params !== "object" || record.params === null || Array.isArray(record.params)) {
          return {
            valid: false,
            error: createProtocolError(
              ProtocolErrorCode.INVALID_PAYLOAD,
              "Request 'params' must be an object if provided"
            )
          };
        }
      }
      return { valid: true, value: record as unknown as ProtocolRequest };
    }

    case "response": {
      if (typeof record.replyTo !== "string" || record.replyTo.trim().length === 0) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_ENVELOPE,
            "Response message must contain a non-empty string 'replyTo'"
          )
        };
      }
      if (typeof record.ok !== "boolean") {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_ENVELOPE,
            "Response message must contain a boolean 'ok'"
          )
        };
      }
      if (!record.ok) {
        if (
          typeof record.error !== "object" ||
          record.error === null ||
          Array.isArray(record.error) ||
          typeof (record.error as Record<string, unknown>).code !== "string" ||
          typeof (record.error as Record<string, unknown>).message !== "string"
        ) {
          return {
            valid: false,
            error: createProtocolError(
              ProtocolErrorCode.INVALID_ENVELOPE,
              "Error response must contain an 'error' object with string 'code' and 'message'"
            )
          };
        }
      }
      return { valid: true, value: record as unknown as ProtocolResponse };
    }

    case "event": {
      if (typeof record.event !== "string" || record.event.trim().length === 0) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_ENVELOPE,
            "Event message must contain a non-empty string 'event'"
          )
        };
      }
      return { valid: true, value: record as unknown as ProtocolEvent };
    }
  }
}

export function validateMethodParams(method: string, params: unknown): ValidationResult<void> {
  switch (method) {
    case "system.hello": {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.INVALID_PAYLOAD, "system.hello requires params object")
        };
      }
      const p = params as Record<string, unknown>;
      if (typeof p.clientName !== "string" || typeof p.clientVersion !== "string") {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PAYLOAD,
            "system.hello requires string 'clientName' and 'clientVersion'"
          )
        };
      }
      if (p.requestedCapabilities !== undefined && !Array.isArray(p.requestedCapabilities)) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PAYLOAD,
            "system.hello 'requestedCapabilities' must be an array of strings"
          )
        };
      }
      return { valid: true };
    }

    case "config.validatePatch":
    case "config.applyPatch": {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.INVALID_PAYLOAD, `${method} requires params object`)
        };
      }
      const p = params as Record<string, unknown>;
      if (!p.patch || typeof p.patch !== "object" || Array.isArray(p.patch)) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PAYLOAD,
            `${method} requires a non-null object 'patch'`
          )
        };
      }

      // Validate patch keys
      const patch = p.patch as Record<string, unknown>;
      for (const key of Object.keys(patch)) {
        if (!KNOWN_CONFIG_KEYS.has(key)) {
          return {
            valid: false,
            error: createProtocolError(
              ProtocolErrorCode.CONFIG_VALIDATION_FAILED,
              `Unknown or forbidden configuration key: "${key}"`
            )
          };
        }
      }

      // Validate specific types
      if ("gapInner" in patch && (typeof patch.gapInner !== "number" || patch.gapInner < 0)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.CONFIG_VALIDATION_FAILED, "gapInner must be a non-negative number")
        };
      }
      if ("gapOuter" in patch && (typeof patch.gapOuter !== "number" || patch.gapOuter < 0)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.CONFIG_VALIDATION_FAILED, "gapOuter must be a non-negative number")
        };
      }
      if ("masterRatio" in patch && (typeof patch.masterRatio !== "number" || patch.masterRatio < 0.05 || patch.masterRatio > 0.95)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.CONFIG_VALIDATION_FAILED, "masterRatio must be between 0.05 and 0.95")
        };
      }

      return { valid: true };
    }

    case "runtime.setLayout": {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.INVALID_PAYLOAD, "runtime.setLayout requires params object")
        };
      }
      const p = params as Record<string, unknown>;
      if (typeof p.outputId !== "string" || typeof p.layout !== "string") {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PAYLOAD,
            "runtime.setLayout requires string 'outputId' and string 'layout'"
          )
        };
      }
      return { valid: true };
    }

    case "runtime.setMasterCount": {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.INVALID_PAYLOAD, "runtime.setMasterCount requires params object")
        };
      }
      const p = params as Record<string, unknown>;
      if (typeof p.outputId !== "string" || typeof p.count !== "number" || p.count < 1) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PAYLOAD,
            "runtime.setMasterCount requires string 'outputId' and integer 'count' >= 1"
          )
        };
      }
      return { valid: true };
    }

    case "runtime.setMasterRatio": {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.INVALID_PAYLOAD, "runtime.setMasterRatio requires params object")
        };
      }
      const p = params as Record<string, unknown>;
      if (typeof p.outputId !== "string" || typeof p.ratio !== "number" || p.ratio < 0.05 || p.ratio > 0.95) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PAYLOAD,
            "runtime.setMasterRatio requires string 'outputId' and number 'ratio' between 0.05 and 0.95"
          )
        };
      }
      return { valid: true };
    }

    case "runtime.setWindowFloating": {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.INVALID_PAYLOAD, "runtime.setWindowFloating requires params object")
        };
      }
      const p = params as Record<string, unknown>;
      if (typeof p.windowId !== "string" || typeof p.floating !== "boolean") {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PAYLOAD,
            "runtime.setWindowFloating requires string 'windowId' and boolean 'floating'"
          )
        };
      }
      return { valid: true };
    }

    default:
      return { valid: true };
  }
}
