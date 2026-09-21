import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
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

  const record = obj as Record<string, unknown>;

  // Check protocol identifier
  if (record.protocol !== PROTOCOL_NAME) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.INVALID_ENVELOPE,
        `Invalid protocol: expected "${PROTOCOL_NAME}", received "${String(record.protocol)}"`
      )
    };
  }

  // Check protocol version
  if (record.version !== PROTOCOL_VERSION) {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version: expected "${PROTOCOL_VERSION}", received "${String(record.version)}"`
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

  // Check message type
  const type = record.type;
  if (type !== "request" && type !== "response" && type !== "event") {
    return {
      valid: false,
      error: createProtocolError(
        ProtocolErrorCode.INVALID_ENVELOPE,
        `Invalid message type: expected "request" | "response" | "event", received "${String(type)}"`
      )
    };
  }

  // Validate type-specific fields
  switch (type) {
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
              ProtocolErrorCode.INVALID_PARAMS,
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
          error: createProtocolError(ProtocolErrorCode.INVALID_PARAMS, "system.hello requires params object")
        };
      }
      const p = params as Record<string, unknown>;
      if (typeof p.clientName !== "string" || typeof p.clientVersion !== "string") {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PARAMS,
            "system.hello requires string 'clientName' and 'clientVersion'"
          )
        };
      }
      if (p.requestedCapabilities !== undefined && !Array.isArray(p.requestedCapabilities)) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PARAMS,
            "system.hello 'requestedCapabilities' must be an array of strings"
          )
        };
      }
      return { valid: true };
    }

    case "state.getScreenOrder": {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.INVALID_PARAMS, "state.getScreenOrder requires params object")
        };
      }
      const p = params as Record<string, unknown>;
      if (typeof p.outputId !== "string" || p.outputId.trim().length === 0) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PARAMS,
            "state.getScreenOrder requires non-empty string 'outputId'"
          )
        };
      }
      return { valid: true };
    }

    case "config.set": {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {
          valid: false,
          error: createProtocolError(ProtocolErrorCode.INVALID_PARAMS, "config.set requires params object")
        };
      }
      const p = params as Record<string, unknown>;
      if (!p.config || typeof p.config !== "object" || Array.isArray(p.config)) {
        return {
          valid: false,
          error: createProtocolError(
            ProtocolErrorCode.INVALID_PARAMS,
            "config.set requires an object 'config'"
          )
        };
      }
      return { valid: true };
    }

    default:
      return { valid: true };
  }
}
