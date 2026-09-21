import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateEnvelope,
  validateAgainstSchema,
  encodeFrame,
  StreamingFrameDecoder,
  ReferenceServer,
  type ProtocolRequest
} from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VALID_DIR = resolve(__dirname, "../fixtures/valid");
const INVALID_DIR = resolve(__dirname, "../fixtures/invalid");

describe("Tessera Protocol V1 Conformance Fixtures Suite", () => {
  const validFiles = readdirSync(VALID_DIR).filter(f => f.endsWith(".json")).sort();
  const invalidFiles = readdirSync(INVALID_DIR).filter(f => f.endsWith(".json")).sort();

  it("1. Contains at least 10 valid and 10 invalid fixtures", () => {
    expect(validFiles.length).toBeGreaterThanOrEqual(10);
    expect(invalidFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("2. Every valid fixture passes envelope validation, schema check, and framing round-trip", () => {
    for (const file of validFiles) {
      const filePath = resolve(VALID_DIR, file);
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);

      // 1. Envelope validation
      const envRes = validateEnvelope(parsed);
      expect(envRes.valid, `Valid fixture ${file} failed envelope validation: ${envRes.error?.message}`).toBe(true);

      // 2. Schema validation
      const schemaRes = validateAgainstSchema(parsed);
      expect(schemaRes.valid, `Valid fixture ${file} failed schema validation: ${schemaRes.errors.join(", ")}`).toBe(true);

      // 3. Framing round-trip
      const encoded = encodeFrame(parsed);
      const decoder = new StreamingFrameDecoder();
      const decoded = decoder.push(encoded);
      expect(decoded).toHaveLength(1);
      expect(decoded[0].ok).toBe(true);
      if (decoded[0].ok) {
        expect(decoded[0].message.id).toBe(parsed.id);
        expect(decoded[0].message.kind).toBe(parsed.kind);
      }
    }
  });

  it("3. Every invalid fixture declares exact expected error code and fails with that exact code through endpoint/decoder", async () => {
    const mockServer = new ReferenceServer({
      getRetainedScreens: () => [
        {
          outputId: "HDMI-A-1",
          name: "HDMI-A-1",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          usableArea: { x: 0, y: 0, width: 1920, height: 1080 },
          activeLayout: "master-stack",
          masterCount: 1,
          masterRatio: 0.5,
          gaps: { inner: 0, outer: 0 },
          orderedWindowIds: [],
          persistentOrder: []
        }
      ],
      getRetainedWindows: () => [],
      getRetainedScreen: () => null,
      reconcile: () => null,
      getDiagnostics: () => ({})
    });

    // Seed negotiated session with capabilities for testing mutation failures
    const session = mockServer.getSession("conformance-session");
    session.helloCompleted = true;
    session.negotiatedCapabilities.add("runtime.control");
    session.negotiatedCapabilities.add("config.mutate");

    // Seed idempotency entry for 20-idempotency-conflict
    await mockServer.handleRequest({
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-seed-idem",
      method: "runtime.setLayout",
      params: { outputId: "HDMI-A-1", layout: "columns", idempotencyKey: "test-idem-conflict" }
    } as ProtocolRequest, "conformance-session");

    for (const file of invalidFiles) {
      const filePath = resolve(INVALID_DIR, file);
      const raw = readFileSync(filePath, "utf8");
      const wrapped = JSON.parse(raw);

      expect(wrapped.expectedErrorCode, `Fixture ${file} must declare expectedErrorCode`).toBeDefined();
      const expectedCode = wrapped.expectedErrorCode;
      const payload = wrapped.payload;

      let actualCode: string | null = null;

      // 1. Validate envelope / limits
      const envRes = validateEnvelope(payload);
      if (!envRes.valid && envRes.error) {
        actualCode = envRes.error.code;
      } else {
        // 2. Dispatch through server endpoint
        const sessionId = file.includes("unnegotiated") ? "unnegotiated-session" : "conformance-session";
        const resp = await mockServer.handleRequest(payload as ProtocolRequest, sessionId);
        if (!resp.ok && resp.error) {
          actualCode = resp.error.code;
        }
      }

      expect(
        actualCode,
        `Invalid fixture ${file} did not produce expected error code ${expectedCode}`
      ).toBe(expectedCode);
    }
  });
});
