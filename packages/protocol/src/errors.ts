import { ProtocolErrorCode, type ProtocolErrorData } from "./types.js";

export class ProtocolError extends Error {
  public readonly code: ProtocolErrorCode;
  public readonly details?: unknown;

  constructor(code: ProtocolErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): ProtocolErrorData {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {})
    };
  }
}

export function createProtocolError(
  code: ProtocolErrorCode,
  message: string,
  details?: unknown
): ProtocolError {
  return new ProtocolError(code, message, details);
}

export function isProtocolError(err: unknown): err is ProtocolError {
  return err instanceof ProtocolError;
}

export function toProtocolErrorData(err: unknown): ProtocolErrorData {
  if (isProtocolError(err)) {
    return err.toJSON();
  }
  if (err instanceof Error) {
    return {
      code: ProtocolErrorCode.INTERNAL_ERROR,
      message: err.message
    };
  }
  return {
    code: ProtocolErrorCode.INTERNAL_ERROR,
    message: String(err)
  };
}
