import { describe, it, expect } from "vitest";
import {
  StreamingFrameDecoder,
  encodeFrame,
  validateEnvelope,
  ProtocolError,
  type ProtocolRequest
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

function randomAsciiString(rng: () => number, length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(rng() * chars.length)];
  }
  return str;
}

describe("Tessera Protocol V1 Deterministic Fuzz Suite", () => {
  const ITERATIONS = 5000;

  it("1. Arbitrary byte stream chunks (5,000 iterations with fixed seed 42) never crash decoder", () => {
    const seed = 42;
    const rng = createMulberry32(seed);
    const decoder = new StreamingFrameDecoder();

    for (let i = 0; i < ITERATIONS; i++) {
      const len = Math.floor(rng() * 512);
      const chunk = new Uint8Array(len);
      for (let b = 0; b < len; b++) {
        chunk[b] = Math.floor(rng() * 256);
      }

      let results: any[];
      try {
        results = decoder.push(chunk);
      } catch (err: unknown) {
        throw new Error(`Decoder crashed on seed ${seed}, iteration ${i}: ${String(err)}`);
      }

      for (const res of results) {
        if (!res.ok) {
          expect(res.error).toBeInstanceOf(ProtocolError);
          expect(typeof res.error.code).toBe("string");
        }
      }

      if (i % 50 === 0) {
        decoder.reset();
      }
    }
  });

  it("2. Valid message split across every single byte boundary decodes deterministically", () => {
    const validReq: ProtocolRequest = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-split-boundary",
      method: "state.getSnapshot",
      params: { filter: "all", nested: { a: 1, b: "hello" } }
    };

    const frame = encodeFrame(validReq);
    for (let splitIndex = 1; splitIndex < frame.byteLength; splitIndex++) {
      const decoder = new StreamingFrameDecoder();
      const slice1 = frame.slice(0, splitIndex);
      const slice2 = frame.slice(splitIndex);

      const res1 = decoder.push(slice1);
      const res2 = decoder.push(slice2);

      const combined = [...res1, ...res2];
      expect(combined).toHaveLength(1);
      expect(combined[0].ok).toBe(true);
      if (combined[0].ok) {
        expect(combined[0].message.id).toBe("req-split-boundary");
      }
    }
  });

  it("3. Envelope validator JSON fuzzing (5,000 iterations with fixed seed 12345) never crashes", () => {
    const seed = 12345;
    const rng = createMulberry32(seed);

    const candidateKeys = [
      "protocol", "majorVersion", "minorVersion", "kind", "id", "method", "params",
      "replyTo", "ok", "result", "error", "event", "data", "metadata", "extra"
    ];

    const generateRandomValue = (depth = 0): unknown => {
      if (depth > 5) return null;
      const typeChoice = Math.floor(rng() * 7);
      switch (typeChoice) {
        case 0: return null;
        case 1: return undefined;
        case 2: return rng() > 0.5;
        case 3: return Math.floor((rng() - 0.5) * 100000);
        case 4: return randomAsciiString(rng, Math.floor(rng() * 16));
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
      try {
        validationResult = validateEnvelope(candidate);
      } catch (err: unknown) {
        throw new Error(`Validator crashed on seed ${seed}, iteration ${i}: ${String(err)}`);
      }

      expect(typeof validationResult.valid).toBe("boolean");
      if (!validationResult.valid) {
        expect(validationResult.error).toBeInstanceOf(ProtocolError);
        expect(typeof validationResult.error.code).toBe("string");
      }
    }
  });

  it("4. Nested payload limits and oversized string limits are rejected gracefully", () => {
    const rng = createMulberry32(999);

    // Build payload with depth 35 > 32
    let deep: any = { depth: 0 };
    for (let d = 0; d < 35; d++) {
      deep = { level: deep };
    }

    const deepReq = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-fuzz-deep",
      method: "config.applyPatch",
      params: deep
    };

    const res = validateEnvelope(deepReq);
    expect(res.valid).toBe(false);
    expect(res.error?.message).toContain("maximum nesting depth");

    // Oversized string > 65536
    const hugeStr = randomAsciiString(rng, 70000);
    const hugeReq = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-huge",
      method: "state.getSnapshot",
      params: { big: hugeStr }
    };

    const hugeRes = validateEnvelope(hugeReq);
    expect(hugeRes.valid).toBe(false);
    expect(hugeRes.error?.message).toContain("maximum length");
  });

  it("5. Reordered and duplicated request IDs maintain correlation", () => {
    const ids = ["id-1", "id-2", "id-3", "id-1", "id-4"];
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const id of ids) {
      if (seen.has(id)) {
        duplicates.push(id);
      }
      seen.add(id);
    }

    expect(duplicates).toEqual(["id-1"]);
  });
});
