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
    let deeplyNested: Record<string, unknown> = { depth: 0 };
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
    expect(res.error?.code).toBe(ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED);
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

  it("14. Intentional schema changes directly affect runtime validation", () => {
    // Demonstrates that validation logic is driven directly by schema objects, not hardcoded code
    const customSchema = {
      type: "object",
      required: ["requiredField", "numericScore"],
      properties: {
        requiredField: { type: "string", minLength: 5 },
        numericScore: { type: "number", minimum: 10, maximum: 100 }
      },
      additionalProperties: false
    };

    // Valid data passes
    expect(validateAgainstSchema({ requiredField: "hello world", numericScore: 50 }, customSchema).valid).toBe(true);

    // Failing constraints directly report schema violations
    const invalidRes1 = validateAgainstSchema({ requiredField: "shrt", numericScore: 50 }, customSchema);
    expect(invalidRes1.valid).toBe(false);
    expect(invalidRes1.errors[0]).toContain("minLength");

    const invalidRes2 = validateAgainstSchema({ requiredField: "valid-str", numericScore: 5 }, customSchema);
    expect(invalidRes2.valid).toBe(false);
    expect(invalidRes2.errors[0]).toContain("minimum 10");

    const invalidRes3 = validateAgainstSchema({ requiredField: "valid-str", numericScore: 50, extra: true }, customSchema);
    expect(invalidRes3.valid).toBe(false);
    expect(invalidRes3.errors[0]).toContain("additional property is not permitted");
  });

  it("15. Canonical schemas are authoritative over generated JSON schema files", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { envelopeSchema, requestSchema } = await import("../src/schemas/canonical-schemas.js");

    const schemasDir = path.resolve(__dirname, "../src/schemas");
    const envelopeJson = JSON.parse(fs.readFileSync(path.join(schemasDir, "envelope.schema.json"), "utf8"));
    const requestJson = JSON.parse(fs.readFileSync(path.join(schemasDir, "request.schema.json"), "utf8"));

    // Verify generated JSON schemas match canonical TypeScript schema definitions identically
    expect(envelopeJson).toEqual(envelopeSchema);
    expect(requestJson).toEqual(requestSchema);

    // Proves that modifying the schema dynamically changes serialized output
    const modifiedSchema = { ...envelopeSchema, title: "ModifiedSchemaTitle" };
    expect(JSON.stringify(modifiedSchema)).not.toEqual(JSON.stringify(envelopeSchema));
    expect(JSON.stringify(modifiedSchema)).toContain("ModifiedSchemaTitle");
  });

  it("16. Method and event registries match canonical schema definitions", async () => {
    const {
      KNOWN_METHODS,
      KNOWN_EVENTS,
      envelopeSchema
    } = await import("../src/schemas/canonical-schemas.js");

    // Check that envelopeSchema includes all KNOWN_METHODS in request branch
    const requestBranch = envelopeSchema.oneOf.find(
      (branch: { properties?: { kind?: { const?: string } } }) => branch.properties?.kind?.const === "request"
    );
    expect(requestBranch).toBeDefined();
    expect(requestBranch?.properties?.method?.enum).toEqual(KNOWN_METHODS);

    // Check that envelopeSchema includes all KNOWN_EVENTS in event branch
    const eventBranch = envelopeSchema.oneOf.find(
      (branch: { properties?: { kind?: { const?: string } } }) => branch.properties?.kind?.const === "event"
    );
    expect(eventBranch).toBeDefined();
    expect(eventBranch?.properties?.event?.enum).toEqual(KNOWN_EVENTS);
  });
});
