use crate::config::{MAX_BUFFERED_BYTES, MAX_FRAME_SIZE};
use crate::protocol::error_codes;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FramingError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for FramingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for FramingError {}

#[derive(Debug, Default)]
pub struct FrameDecoder {
    buffer: Vec<u8>,
}

impl FrameDecoder {
    pub fn new() -> Self {
        FrameDecoder { buffer: Vec::new() }
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
    }

    pub fn buffered_len(&self) -> usize {
        self.buffer.len()
    }

    /// Feed incoming bytes and extract all complete frames.
    /// Rejects with pre-copy buffer ceiling check before appending bytes.
    pub fn push_bytes(&mut self, chunk: &[u8]) -> Result<Vec<Value>, FramingError> {
        // Pre-copy check: verify total buffer would not exceed MAX_BUFFERED_BYTES
        if self.buffer.len().saturating_add(chunk.len()) > MAX_BUFFERED_BYTES {
            return Err(FramingError {
                code: error_codes::RESOURCE_LIMIT_EXCEEDED,
                message: format!(
                    "Decoder buffer would exceed maximum buffer limit of {} bytes",
                    MAX_BUFFERED_BYTES
                ),
            });
        }

        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();

        loop {
            if self.buffer.len() < 4 {
                // Not enough bytes for length header
                break;
            }

            let len_bytes: [u8; 4] = self.buffer[..4].try_into().unwrap();
            let payload_len = u32::from_be_bytes(len_bytes) as usize;

            // Reject frame length exceeding 1 MiB limit before allocating or buffering
            if payload_len > MAX_FRAME_SIZE {
                return Err(FramingError {
                    code: error_codes::FRAME_TOO_LARGE,
                    message: format!(
                        "Frame payload length of {} bytes exceeds maximum allowed frame limit of {} bytes",
                        payload_len, MAX_FRAME_SIZE
                    ),
                });
            }

            if payload_len == 0 {
                return Err(FramingError {
                    code: error_codes::DECODE_ERROR,
                    message: "Zero-length frame payload is invalid".to_string(),
                });
            }

            let total_frame_len = 4 + payload_len;
            if self.buffer.len() < total_frame_len {
                // Incomplete frame payload, await more bytes
                break;
            }

            // Extract payload bytes
            let payload_slice = &self.buffer[4..total_frame_len];
            let text = std::str::from_utf8(payload_slice).map_err(|e| FramingError {
                code: error_codes::DECODE_ERROR,
                message: format!("Frame payload is not valid UTF-8: {}", e),
            })?;

            let parsed: Value = serde_json::from_str(text).map_err(|e| FramingError {
                code: error_codes::DECODE_ERROR,
                message: format!("Frame payload is not valid JSON: {}", e),
            })?;

            frames.push(parsed);

            // Drain consumed frame from buffer
            self.buffer.drain(..total_frame_len);
        }

        Ok(frames)
    }

    /// Stream finalization check. Verifies stream does not terminate with trailing partial bytes.
    pub fn finalize(&self) -> Result<(), FramingError> {
        if !self.buffer.is_empty() {
            return Err(FramingError {
                code: error_codes::DECODE_ERROR,
                message: format!(
                    "Unexpected end of stream with {} unconsumed trailing bytes in decoder buffer",
                    self.buffer.len()
                ),
            });
        }
        Ok(())
    }
}

pub fn encode_frame(val: &Value) -> Result<Vec<u8>, FramingError> {
    let payload = serde_json::to_vec(val).map_err(|e| FramingError {
        code: error_codes::INTERNAL_ERROR,
        message: format!("Failed to serialize frame to JSON: {}", e),
    })?;

    if payload.len() > MAX_FRAME_SIZE {
        return Err(FramingError {
            code: error_codes::RESOURCE_LIMIT_EXCEEDED,
            message: format!(
                "Encoded frame length of {} bytes exceeds maximum frame size of {} bytes",
                payload.len(),
                MAX_FRAME_SIZE
            ),
        });
    }

    let len_be = (payload.len() as u32).to_be_bytes();
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&len_be);
    frame.extend_from_slice(&payload);
    Ok(frame)
}
