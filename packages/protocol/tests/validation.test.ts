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

  it("2. Rejects mismatched protocol namespace with INVALID_ENVELOPE", () => {
    const res = validateEnvelope({
      protocol: "wrong.protocol",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-1",
      method: "state.getSnapshot"
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.INVALID_ENVELOPE);
  });

  it("3. Rejects incompatible major version with UNSUPPORTED_MAJOR_VERSION", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 2,
      minorVersion: 0,
      kind: "request",
      id: "req-1",
      method: "state.getSnapshot"
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.UNSUPPORTED_MAJOR_VERSION);
  });

  it("4. Rejects unsupported minor version with UNSUPPORTED_MINOR_VERSION", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 99,
      kind: "request",
      id: "req-1",
      method: "state.getSnapshot"
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.UNSUPPORTED_MINOR_VERSION);
  });

  it("5. Rejects missing or empty ID", () => {
    expect(validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      method: "state.getSnapshot"
    }).valid).toBe(false);

    expect(validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "   ",
      method: "state.getSnapshot"
    }).valid).toBe(false);
  });

  it("6. Rejects invalid message kind", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "broadcast",
      id: "123"
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.INVALID_ENVELOPE);
  });

  it("7. Rejects request without method", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-1"
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.INVALID_ENVELOPE);
  });

  it("8. Rejects response without replyTo or ok", () => {
    expect(validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "response",
      id: "resp-1",
      ok: true
    }).valid).toBe(false);

    expect(validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "response",
      id: "resp-1",
      replyTo: "req-1"
    }).valid).toBe(false);
  });

  it("9. Rejects error response with missing error fields", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "response",
      id: "resp-1",
      replyTo: "req-1",
      ok: false
    });
    expect(res.valid).toBe(false);
  });

  it("10. Rejects event without event name", () => {
    const res = validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "event",
      id: "evt-1"
    });
    expect(res.valid).toBe(false);
  });

  it("11. Rejects payloads exceeding maximum nesting depth", () => {
    let deeplyNested: any = { depth: 0 };
    for (let i = 0; i < 35; i++) {
      deeplyNested = { child: deeplyNested };
    }

    const res = validateEnvelope({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-deep",
      method: "config.applyPatch",
      params: deeplyNested
    });
    expect(res.valid).toBe(false);
    expect(res.error?.code).toBe(ProtocolErrorCode.INVALID_PAYLOAD);
  });

  it("12. Validates method parameters", () => {
    expect(validateMethodParams("system.hello", null).valid).toBe(false);
    expect(validateMethodParams("system.hello", { clientName: "c1" }).valid).toBe(false);
    expect(validateMethodParams("system.hello", { clientName: "c1", clientVersion: "1.0" }).valid).toBe(true);

    expect(validateMethodParams("config.applyPatch", { patch: "not-object" }).valid).toBe(false);
    expect(validateMethodParams("config.applyPatch", { patch: { forbiddenKey: true } }).valid).toBe(false);
    expect(validateMethodParams("config.applyPatch", { patch: { gapInner: -5 } }).valid).toBe(false);
    expect(validateMethodParams("config.applyPatch", { patch: { gapInner: 12 } }).valid).toBe(true);

    expect(validateMethodParams("runtime.setLayout", { outputId: "HDMI-1" }).valid).toBe(false);
    expect(validateMethodParams("runtime.setLayout", { outputId: "HDMI-1", layout: "master-stack" }).valid).toBe(true);
  });

  it("13. Schema validator accurately validates valid envelope", () => {
    const validReq = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-schema-1",
      method: "state.getSnapshot"
    };
    const res = validateAgainstSchema(validReq);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
});
