import { describe, it, expect } from "vitest";
import {
  encodeFrame,
  StreamingFrameDecoder,
  MAX_FRAME_SIZE,
  ProtocolErrorCode,
  type ProtocolRequest
} from "../src/index.js";

describe("Tessera Protocol V1 Framing Codec", () => {
  const sampleRequest: ProtocolRequest = {
    protocol: "tessera.ipc",
    majorVersion: 1,
    minorVersion: 0,
    kind: "request",
    id: "req-codec-01",
    method: "state.getSnapshot"
  };

  it("1. Encodes frame with 4-byte big-endian length prefix", () => {
    const frame = encodeFrame(sampleRequest);
    expect(frame.byteLength).toBeGreaterThan(4);

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const declaredLength = view.getUint32(0, false);
    expect(declaredLength).toBe(frame.byteLength - 4);

    const payloadString = new TextDecoder().decode(frame.slice(4));
    const parsed = JSON.parse(payloadString);
    expect(parsed.id).toBe("req-codec-01");
    expect(parsed.kind).toBe("request");
  });

  it("2. Streaming decoder decodes a single complete frame", () => {
    const decoder = new StreamingFrameDecoder();
    const frame = encodeFrame(sampleRequest);

    const results = decoder.push(frame);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    if (results[0].ok) {
      expect(results[0].message.id).toBe("req-codec-01");
    }
  });

  it("3. Streaming decoder handles frame split across multiple chunks", () => {
    const decoder = new StreamingFrameDecoder();
    const frame = encodeFrame(sampleRequest);

    // Split frame into 3 slices
    const chunk1 = frame.slice(0, 3); // partial header
    const chunk2 = frame.slice(3, 15); // rest of header + partial payload
    const chunk3 = frame.slice(15); // remainder of payload

    const res1 = decoder.push(chunk1);
    expect(res1).toHaveLength(0);

    const res2 = decoder.push(chunk2);
    expect(res2).toHaveLength(0);

    const res3 = decoder.push(chunk3);
    expect(res3).toHaveLength(1);
    expect(res3[0].ok).toBe(true);
    if (resultsOk(res3[0])) {
      expect(res3[0].message.id).toBe("req-codec-01");
    }
  });

  it("4. Streaming decoder handles multiple frames in a single chunk", () => {
    const decoder = new StreamingFrameDecoder();
    const frame1 = encodeFrame({ ...sampleRequest, id: "req-1" });
    const frame2 = encodeFrame({ ...sampleRequest, id: "req-2" });
    const frame3 = encodeFrame({ ...sampleRequest, id: "req-3" });

    const combined = new Uint8Array(frame1.byteLength + frame2.byteLength + frame3.byteLength);
    combined.set(frame1, 0);
    combined.set(frame2, frame1.byteLength);
    combined.set(frame3, frame1.byteLength + frame2.byteLength);

    const results = decoder.push(combined);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.ok)).toBe(true);
    expect(results.map(r => r.ok ? r.message.id : "")).toEqual(["req-1", "req-2", "req-3"]);
  });

  it("5. Streaming decoder handles multi-frame chunk with partial trailing frame", () => {
    const decoder = new StreamingFrameDecoder();
    const frame1 = encodeFrame({ ...sampleRequest, id: "req-1" });
    const frame2 = encodeFrame({ ...sampleRequest, id: "req-2" });

    // frame1 + partial frame2
    const combined = new Uint8Array(frame1.byteLength + 10);
    combined.set(frame1, 0);
    combined.set(frame2.slice(0, 10), frame1.byteLength);

    const res1 = decoder.push(combined);
    expect(res1).toHaveLength(1);
    expect(res1[0].ok && res1[0].message.id).toBe("req-1");

    // Push the rest of frame2
    const res2 = decoder.push(frame2.slice(10));
    expect(res2).toHaveLength(1);
    expect(res2[0].ok && res2[0].message.id).toBe("req-2");
  });

  it("6. Rejects oversized frame length header immediately without allocating buffer", () => {
    const decoder = new StreamingFrameDecoder();
    const header = new Uint8Array(4);
    const view = new DataView(header.buffer);
    view.setUint32(0, MAX_FRAME_SIZE + 1024, false); // declares > 16MB

    const results = decoder.push(header);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].error.code).toBe(ProtocolErrorCode.FRAME_TOO_LARGE);
    }
  });

  it("7. encodeFrame throws FRAME_TOO_LARGE when payload exceeds 16MB", () => {
    const oversizedJson = "x".repeat(MAX_FRAME_SIZE + 1);
    expect(() => encodeFrame(oversizedJson)).toThrowError();
  });

  it("8. Rejects zero-length payload header with DECODE_ERROR", () => {
    const decoder = new StreamingFrameDecoder();
    const header = new Uint8Array(4); // length = 0

    const results = decoder.push(header);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].error.code).toBe(ProtocolErrorCode.DECODE_ERROR);
    }
  });

  it("9. Rejects invalid UTF-8 payload with DECODE_ERROR", () => {
    const decoder = new StreamingFrameDecoder();
    // 4-byte header for 4 bytes of invalid UTF-8
    const frame = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0xff, 0xff, 0xff, 0xff]);

    const results = decoder.push(frame);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].error.code).toBe(ProtocolErrorCode.DECODE_ERROR);
    }
  });

  it("10. Rejects invalid JSON payload with DECODE_ERROR", () => {
    const decoder = new StreamingFrameDecoder();
    const invalidJson = "{ not valid json";
    const bytes = new TextEncoder().encode(invalidJson);
    const frame = new Uint8Array(4 + bytes.byteLength);
    new DataView(frame.buffer).setUint32(0, bytes.byteLength, false);
    frame.set(bytes, 4);

    const results = decoder.push(frame);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].error.code).toBe(ProtocolErrorCode.DECODE_ERROR);
    }
  });

  it("11. Trailing partial frames are detected on finalize()", () => {
    const decoder = new StreamingFrameDecoder();
    const partialHeader = new Uint8Array([0x00, 0x00]);
    decoder.push(partialHeader);

    const finishResults = decoder.finalize();
    expect(finishResults).toHaveLength(1);
    expect(finishResults[0].ok).toBe(false);
    if (!finishResults[0].ok) {
      expect(finishResults[0].error.code).toBe(ProtocolErrorCode.DECODE_ERROR);
    }
  });

  it("12. Unicode payloads round-trip correctly", () => {
    const decoder = new StreamingFrameDecoder();
    const unicodeReq: ProtocolRequest = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-unicode-🚀",
      method: "state.getSnapshot",
      params: { label: "日本語 • Español • 🌍 • 𝄢" }
    };

    const frame = encodeFrame(unicodeReq);
    const decoded = decoder.push(frame);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].ok).toBe(true);
    if (decoded[0].ok) {
      expect(decoded[0].message.id).toBe("req-unicode-🚀");
    }
  });

  it("13. Handles partial header followed by large chunk correctly", () => {
    const decoder = new StreamingFrameDecoder();
    const largePayload: ProtocolRequest = {
      protocol: "tessera.ipc",
      majorVersion: 1,
      minorVersion: 0,
      kind: "request",
      id: "req-large-chunk",
      method: "config.applyPatch",
      params: { bigData: "A".repeat(64 * 1024) }
    };
    const frame = encodeFrame(largePayload, 1024 * 1024);

    // Split at byte 2 of the 4-byte header
    const chunk1 = frame.slice(0, 2);
    const chunk2 = frame.slice(2);

    expect(decoder.push(chunk1)).toHaveLength(0);
    expect(decoder.getPendingBytes()).toBe(2);

    const res = decoder.push(chunk2);
    expect(res).toHaveLength(1);
    expect(res[0].ok).toBe(true);
    if (res[0].ok) {
      expect(res[0].message.id).toBe("req-large-chunk");
    }
  });

  it("14. Rejects repeated small chunks exceeding buffer limit with RESOURCE_LIMIT_EXCEEDED before copying", () => {
    // 50 KB buffer limit
    const decoder = new StreamingFrameDecoder({ maxBufferedBytes: 50 * 1024 });

    // Send 10 KB chunks of incomplete data
    const chunk = new Uint8Array(10 * 1024);
    // Fill first 4 bytes with length header of 40 KB (incomplete)
    new DataView(chunk.buffer).setUint32(0, 40 * 1024, false);

    expect(decoder.push(chunk)).toHaveLength(0);
    expect(decoder.getPendingBytes()).toBe(10 * 1024);

    const chunk2 = new Uint8Array(10 * 1024);
    expect(decoder.push(chunk2)).toHaveLength(0);
    expect(decoder.getPendingBytes()).toBe(20 * 1024);

    const chunk3 = new Uint8Array(10 * 1024);
    expect(decoder.push(chunk3)).toHaveLength(0);
    expect(decoder.getPendingBytes()).toBe(30 * 1024);

    const chunk4 = new Uint8Array(10 * 1024);
    expect(decoder.push(chunk4)).toHaveLength(0);
    expect(decoder.getPendingBytes()).toBe(40 * 1024);

    // Now push 20 KB chunk (40 KB + 20 KB = 60 KB > 50 KB limit)
    const oversizedChunk = new Uint8Array(20 * 1024);
    const res = decoder.push(oversizedChunk);

    expect(res).toHaveLength(1);
    expect(res[0].ok).toBe(false);
    if (!res[0].ok) {
      expect(res[0].error.code).toBe(ProtocolErrorCode.RESOURCE_LIMIT_EXCEEDED);
    }
    // Buffer is bounded and cleared on limit error
    expect(decoder.getPendingBytes()).toBe(0);
  });
});

function resultsOk(res: { ok: boolean }): boolean {
  return res.ok === true;
}
