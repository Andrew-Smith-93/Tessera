import { describe, it, expect } from "vitest";
import {
  validateEnvelope,
  validateMethodParams,
  validateAgainstSchema,
  ProtocolErrorCode
} from "../src/index.js";

describe("Tessera Protocol V1 Validation Suite", () => {
  it("1. Rejects null, primitives, and arrays as envelopes", () => {
    expect(validateEnvelope(null).valid).toBe(false);
    expect(validateEnvelope("string").valid).toBe(false);
    expect(validateEnvelope(12345).valid).toBe(false);
    expect(validateEnvelope([]).valid).toBe(false);
  });

  it("2. Rejects mismatched protocol identifier with INVALID_ENVELOPE", () => {
    const res = validateEnvelope({
      protocol: "wrong.protocol",
      version: "1.0",
      id: "req-1",
      type: "request",
      method: "state.getRetainedScreens"
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.INVALID_ENVELOPE);
  });

  it("3. Rejects incompatible protocol version with UNSUPPORTED_PROTOCOL_VERSION", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      version: "2.0",
      id: "req-1",
      type: "request",
      method: "state.getRetainedScreens"
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.UNSUPPORTED_PROTOCOL_VERSION);
  });

  it("4. Rejects missing or empty ID", () => {
    expect(validateEnvelope({
      protocol: "tessera.ipc",
      version: "1.0",
      type: "request",
      method: "state.getRetainedScreens"
    }).valid).toBe(false);

    expect(validateEnvelope({
      protocol: "tessera.ipc",
      version: "1.0",
      id: "   ",
      type: "request",
      method: "state.getRetainedScreens"
    }).valid).toBe(false);
  });

  it("5. Rejects invalid type enum", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      version: "1.0",
      id: "123",
      type: "broadcast"
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.INVALID_ENVELOPE);
  });

  it("6. Rejects request without method", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      version: "1.0",
      id: "req-1",
      type: "request"
    });
    expect(res.valid).toBe(false);
  });

  it("7. Rejects response without replyTo or ok", () => {
    expect(validateEnvelope({
      protocol: "tessera.ipc",
      version: "1.0",
      id: "resp-1",
      type: "response",
      ok: true
    }).valid).toBe(false);

    expect(validateEnvelope({
      protocol: "tessera.ipc",
      version: "1.0",
      id: "resp-1",
      type: "response",
      replyTo: "req-1"
    }).valid).toBe(false);
  });

  it("8. Rejects error response with missing error fields", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      version: "1.0",
      id: "resp-1",
      type: "response",
      replyTo: "req-1",
      ok: false
    });
    expect(res.valid).toBe(false);
  });

  it("9. Rejects event without event name", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      version: "1.0",
      id: "evt-1",
      type: "event"
    });
    expect(res.valid).toBe(false);
  });

  it("10. Validates method parameters", () => {
    expect(validateMethodParams("system.hello", null).valid).toBe(false);
    expect(validateMethodParams("system.hello", { clientName: "c1" }).valid).toBe(false);
    expect(validateMethodParams("system.hello", { clientName: "c1", clientVersion: "1.0" }).valid).toBe(true);
    expect(validateMethodParams("state.getScreenOrder", {}).valid).toBe(false);
    expect(validateMethodParams("state.getScreenOrder", { outputId: "HDMI-A-1" }).valid).toBe(true);
    expect(validateMethodParams("config.set", { config: "bad" }).valid).toBe(false);
    expect(validateMethodParams("config.set", { config: { enableTiling: true } }).valid).toBe(true);
  });

  it("11. Schema validator accurately validates valid envelope", () => {
    const validReq = {
      protocol: "tessera.ipc",
      version: "1.0",
      id: "req-schema-1",
      type: "request",
      method: "state.getRetainedScreens"
    };
    const res = validateAgainstSchema(validReq);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
});
