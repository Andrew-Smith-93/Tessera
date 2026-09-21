import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateEnvelope,
  validateAgainstSchema,
  encodeFrame,
  StreamingFrameDecoder
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
      expect(envRes.valid, `Valid fixture ${file} failed envelope validation`).toBe(true);

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
        expect(decoded[0].message.type).toBe(parsed.type);
      }
    }
  });

  it("3. Every invalid fixture fails envelope validation or schema check", () => {
    for (const file of invalidFiles) {
      const filePath = resolve(INVALID_DIR, file);
      const raw = readFileSync(filePath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Syntax error is already an invalid fixture
        continue;
      }

      const envRes = validateEnvelope(parsed);
      const schemaRes = validateAgainstSchema(parsed);

      const failed = !envRes.valid || !schemaRes.valid;
      expect(failed, `Invalid fixture ${file} unexpectedly passed validation`).toBe(true);
    }
  });
});
