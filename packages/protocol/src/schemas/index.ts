export * from "./canonical-schemas.js";
import {
  KNOWN_METHODS,
  KNOWN_EVENTS
} from "./canonical-schemas.js";

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

const knownMethodSet = new Set<string>(KNOWN_METHODS);
const knownEventSet = new Set<string>(KNOWN_EVENTS);

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

  if (rec.majorVersion !== 1) {
    errors.push(`Property 'majorVersion' must be 1 (received: ${String(rec.majorVersion)})`);
  }

  if (typeof rec.minorVersion !== "number" || rec.minorVersion < 0) {
    errors.push(`Property 'minorVersion' must be a non-negative integer (received: ${String(rec.minorVersion)})`);
  }

  if (typeof rec.id !== "string" || rec.id.length === 0) {
    errors.push("Property 'id' must be a non-empty string");
  }

  if (rec.kind !== "request" && rec.kind !== "response" && rec.kind !== "event") {
    errors.push(`Property 'kind' must be 'request' | 'response' | 'event' (received: ${String(rec.kind)})`);
    return { valid: false, errors };
  }

  if (rec.kind === "request") {
    if (typeof rec.method !== "string" || rec.method.length === 0) {
      errors.push("Request property 'method' must be a non-empty string");
    } else if (!knownMethodSet.has(rec.method)) {
      errors.push(`Request method '${rec.method}' is not recognized`);
    }
    if (rec.params !== undefined && (typeof rec.params !== "object" || rec.params === null || Array.isArray(rec.params))) {
      errors.push("Request property 'params' must be an object if present");
    }
  } else if (rec.kind === "response") {
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
  } else if (rec.kind === "event") {
    if (typeof rec.event !== "string" || rec.event.length === 0) {
      errors.push("Event property 'event' must be a non-empty string");
    } else if (!knownEventSet.has(rec.event)) {
      errors.push(`Event '${rec.event}' is not recognized`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
