import {
  MAX_FRAME_SIZE,
  ProtocolErrorCode,
  type ProtocolEnvelope
} from "./types.js";
import { createProtocolError, ProtocolError } from "./errors.js";
import { validateEnvelope } from "./validator.js";

export interface FrameDecodeSuccess {
  ok: true;
  message: ProtocolEnvelope;
  rawJson: string;
}

export interface FrameDecodeFailure {
  ok: false;
  error: ProtocolError;
  rawChunk?: Uint8Array;
}

export type FrameDecodeResult = FrameDecodeSuccess | FrameDecodeFailure;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Encodes a JSON envelope or pre-serialized JSON string into a length-prefixed frame.
 * [4-byte big-endian length uint32][UTF-8 JSON payload]
 */
export function encodeFrame(payload: ProtocolEnvelope | string): Uint8Array {
  const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const payloadBytes = textEncoder.encode(jsonStr);
  const length = payloadBytes.byteLength;

  if (length > MAX_FRAME_SIZE) {
    throw createProtocolError(
      ProtocolErrorCode.FRAME_TOO_LARGE,
      `Frame payload size (${length} bytes) exceeds maximum limit (${MAX_FRAME_SIZE} bytes)`
    );
  }

  const frame = new Uint8Array(4 + length);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, length, false); // Big-endian
  frame.set(payloadBytes, 4);

  return frame;
}

/**
 * Streaming byte decoder that processes fragmented and multi-frame chunks.
 */
export class StreamingFrameDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  /**
   * Pushes a new byte chunk into the streaming buffer and returns all decoded frames or errors.
   */
  public push(chunk: Uint8Array): FrameDecodeResult[] {
    if (chunk.byteLength === 0) {
      return [];
    }

    // Append chunk to internal buffer
    const nextBuffer = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    nextBuffer.set(this.buffer, 0);
    nextBuffer.set(chunk, this.buffer.byteLength);
    this.buffer = nextBuffer;

    const results: FrameDecodeResult[] = [];

    while (this.buffer.byteLength >= 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const payloadLength = view.getUint32(0, false); // Big-endian

      // Check for oversized payload BEFORE allocation
      if (payloadLength > MAX_FRAME_SIZE) {
        results.push({
          ok: false,
          error: createProtocolError(
            ProtocolErrorCode.FRAME_TOO_LARGE,
            `Frame length header declares ${payloadLength} bytes, which exceeds maximum limit (${MAX_FRAME_SIZE} bytes)`
          )
        });
        // Discard buffer to prevent poison loop
        this.buffer = new Uint8Array(0);
        break;
      }

      // Check for zero-length payload
      if (payloadLength === 0) {
        results.push({
          ok: false,
          error: createProtocolError(
            ProtocolErrorCode.DECODE_ERROR,
            "Frame length header declares zero-length payload"
          )
        });
        // Advance past the 4-byte header
        this.buffer = this.buffer.slice(4);
        continue;
      }

      // Check if full frame has arrived
      const totalFrameLength = 4 + payloadLength;
      if (this.buffer.byteLength < totalFrameLength) {
        // Need more bytes to complete frame
        break;
      }

      // Extract payload bytes
      const payloadBytes = this.buffer.slice(4, totalFrameLength);
      this.buffer = this.buffer.slice(totalFrameLength);

      // Decode UTF-8 string
      let jsonStr: string;
      try {
        jsonStr = textDecoder.decode(payloadBytes);
      } catch (err: unknown) {
        results.push({
          ok: false,
          error: createProtocolError(
            ProtocolErrorCode.DECODE_ERROR,
            `Failed to decode UTF-8 payload: ${err instanceof Error ? err.message : String(err)}`
          )
        });
        continue;
      }

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (err: unknown) {
        results.push({
          ok: false,
          error: createProtocolError(
            ProtocolErrorCode.DECODE_ERROR,
            `Failed to parse JSON frame payload: ${err instanceof Error ? err.message : String(err)}`
          )
        });
        continue;
      }

      // Validate protocol envelope
      const validation = validateEnvelope(parsed);
      if (!validation.valid || !validation.value) {
        results.push({
          ok: false,
          error: validation.error ?? createProtocolError(ProtocolErrorCode.INVALID_ENVELOPE, "Validation failed")
        });
        continue;
      }

      results.push({
        ok: true,
        message: validation.value,
        rawJson: jsonStr
      });
    }

    return results;
  }

  /**
   * Resets the internal decoder buffer.
   */
  public reset(): void {
    this.buffer = new Uint8Array(0);
  }

  /**
   * Returns current buffered byte count waiting for remaining frame data.
   */
  public getPendingBytes(): number {
    return this.buffer.byteLength;
  }
}
