import { describe, it, expect } from "vitest";
import {
  StreamingFrameDecoder,
  validateEnvelope,
  ProtocolError
} from "../src/index.js";

/**
 * Deterministic Mulberry32 PRNG for reproducible fuzzing.
 */
function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Tessera Protocol V1 Deterministic Fuzz Suite", () => {
  const ITERATIONS = 5000;

  it("1. Codec byte stream fuzzing (5,000 iterations with fixed seed 42) never crashes", () => {
    const rng = createMulberry32(42);
    const decoder = new StreamingFrameDecoder();

    for (let i = 0; i < ITERATIONS; i++) {
      // Random length from 0 to 512 bytes
      const len = Math.floor(rng() * 512);
      const chunk = new Uint8Array(len);
      for (let b = 0; b < len; b++) {
        chunk[b] = Math.floor(rng() * 256);
      }

      let results: any[];
      expect(() => {
        results = decoder.push(chunk);
      }).not.toThrow();

      for (const res of results!) {
        if (!res.ok) {
          expect(res.error).toBeInstanceOf(ProtocolError);
          expect(typeof res.error.code).toBe("string");
        }
      }

      // Periodically reset decoder to test fresh state
      if (i % 50 === 0) {
        decoder.reset();
      }
    }
  });

  it("2. Envelope validator JSON fuzzing (5,000 iterations with fixed seed 12345) never crashes", () => {
    const rng = createMulberry32(12345);

    const candidateKeys = [
      "protocol", "version", "id", "type", "method", "params",
      "replyTo", "ok", "result", "error", "event", "data", "extra", "foo"
    ];

    const generateRandomValue = (depth = 0): unknown => {
      if (depth > 3) return null;
      const typeChoice = Math.floor(rng() * 7);
      switch (typeChoice) {
        case 0: return null;
        case 1: return undefined;
        case 2: return rng() > 0.5;
        case 3: return (rng() - 0.5) * 100000;
        case 4: return Math.random().toString(36).substring(2, 10);
        case 5: {
          const arrLen = Math.floor(rng() * 4);
          const arr: unknown[] = [];
          for (let k = 0; k < arrLen; k++) arr.push(generateRandomValue(depth + 1));
          return arr;
        }
        case 6: {
          const objLen = Math.floor(rng() * 5);
          const obj: Record<string, unknown> = {};
          for (let k = 0; k < objLen; k++) {
            const key = candidateKeys[Math.floor(rng() * candidateKeys.length)];
            obj[key] = generateRandomValue(depth + 1);
          }
          return obj;
        }
      }
    };

    for (let i = 0; i < ITERATIONS; i++) {
      const candidate = generateRandomValue(0);

      let validationResult: any;
      expect(() => {
        validationResult = validateEnvelope(candidate);
      }).not.toThrow();

      expect(typeof validationResult.valid).toBe("boolean");
      if (!validationResult.valid) {
        expect(validationResult.error).toBeInstanceOf(ProtocolError);
        expect(typeof validationResult.error.code).toBe("string");
      }
    }
  });
});
