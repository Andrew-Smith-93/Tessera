import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  PROTOCOL_NAME,
  PROTOCOL_MAJOR_VERSION,
  PROTOCOL_MINOR_VERSION,
  V1_CAPABILITIES,
  ProtocolErrorCode,
  MAX_FRAME_SIZE,
  MAX_BUFFERED_BYTES,
  MAX_NESTING_DEPTH,
  MAX_STRING_LENGTH,
  MAX_ARRAY_LENGTH,
  MAX_OUTSTANDING_REQUESTS,
  MAX_SUBSCRIPTION_COUNT,
  MAX_QUEUE_LENGTH,
  MAX_IDEMPOTENCY_CACHE_SIZE
} from "../src/types.js";
import { KNOWN_METHODS, KNOWN_EVENTS } from "../src/schemas/canonical-schemas.js";

const MANIFEST_PATH = resolve(__dirname, "../protocol-v1.freeze.json");
const SCHEMAS_DIR = resolve(__dirname, "../src/schemas");

function sortObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObject((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

describe("Protocol V1 Canonical Freeze Manifest Verification", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

  it("1. Protocol Identity matches freeze manifest exactly", () => {
    expect(PROTOCOL_NAME).toBe(manifest.namespace);
    expect(PROTOCOL_MAJOR_VERSION).toBe(manifest.majorVersion);
    expect(PROTOCOL_MINOR_VERSION).toBe(manifest.minorVersion);
  });

  it("2. Capabilities match freeze manifest exactly", () => {
    expect([...V1_CAPABILITIES]).toEqual(manifest.capabilities);
  });

  it("3. Methods match freeze manifest exactly", () => {
    expect([...KNOWN_METHODS]).toEqual(manifest.methods);
  });

  it("4. Events match freeze manifest exactly (exact 6 events)", () => {
    expect([...KNOWN_EVENTS]).toEqual(manifest.events);
    expect(KNOWN_EVENTS.length).toBe(6);
  });

  it("5. Error taxonomy matches freeze manifest exactly (exact 16 codes)", () => {
    const errorCodes = Object.values(ProtocolErrorCode);
    expect(errorCodes).toEqual(manifest.errorCodes);
    expect(errorCodes.length).toBe(16);
  });

  it("6. Resource limits match freeze manifest exactly", () => {
    expect(MAX_FRAME_SIZE).toBe(manifest.limits.maxFrameSize);
    expect(MAX_BUFFERED_BYTES).toBe(manifest.limits.maxBufferedBytes);
    expect(MAX_NESTING_DEPTH).toBe(manifest.limits.maxNestingDepth);
    expect(MAX_STRING_LENGTH).toBe(manifest.limits.maxStringLength);
    expect(MAX_ARRAY_LENGTH).toBe(manifest.limits.maxArrayLength);
    expect(MAX_OUTSTANDING_REQUESTS).toBe(manifest.limits.maxOutstandingRequests);
    expect(MAX_SUBSCRIPTION_COUNT).toBe(manifest.limits.maxSubscriptionCount);
    expect(MAX_QUEUE_LENGTH).toBe(manifest.limits.maxQueueLength);
    expect(MAX_IDEMPOTENCY_CACHE_SIZE).toBe(manifest.limits.maxIdempotencyCacheSize);
  });

  it("7. Canonical schema hashes match freeze manifest down to byte", () => {
    const schemaFiles = [
      "envelope.schema.json",
      "error.schema.json",
      "event.schema.json",
      "request.schema.json",
      "response.schema.json"
    ];

    for (const schemaFile of schemaFiles) {
      const rawContent = readFileSync(resolve(SCHEMAS_DIR, schemaFile), "utf8");
      const parsed = JSON.parse(rawContent);
      const canonicalString = JSON.stringify(sortObject(parsed), null, 2);

      const rawSha = createHash("sha256").update(rawContent).digest("hex");
      const canonicalSha = createHash("sha256").update(canonicalString).digest("hex");

      const expected = manifest.schemas[schemaFile];
      expect(
        rawSha,
        `Raw SHA256 mismatch for ${schemaFile} against frozen parent manifest`
      ).toBe(expected.rawSha256);
      expect(
        canonicalSha,
        `Canonical SHA256 mismatch for ${schemaFile} against frozen parent manifest`
      ).toBe(expected.canonicalSha256);
    }
  });
});
