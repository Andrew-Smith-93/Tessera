use serde_json::json;
use tessera_daemon::config::MAX_FRAME_SIZE;
use tessera_daemon::framing::{encode_frame, FrameDecoder};
use tessera_daemon::protocol::error_codes;

#[test]
fn test_encode_and_decode_single_frame() {
    let payload = json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "req-1",
        "method": "state.getSnapshot"
    });

    let encoded = encode_frame(&payload).expect("Encoding failed");
    let mut decoder = FrameDecoder::new();
    let decoded = decoder.push_bytes(&encoded).expect("Decoding failed");

    assert_eq!(decoded.len(), 1);
    assert_eq!(decoded[0], payload);
    decoder.finalize().expect("Finalize failed");
}

#[test]
fn test_byte_by_byte_fragmentation() {
    let payload = json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "req-byte-split",
        "method": "system.hello",
        "params": { "clientName": "ByteClient", "clientVersion": "1.0" }
    });

    let encoded = encode_frame(&payload).expect("Encoding failed");
    let mut decoder = FrameDecoder::new();
    let mut total_decoded = Vec::new();

    for byte in encoded {
        let frames = decoder.push_bytes(&[byte]).expect("Decode chunk failed");
        total_decoded.extend(frames);
    }

    assert_eq!(total_decoded.len(), 1);
    assert_eq!(total_decoded[0], payload);
    decoder.finalize().expect("Finalize failed");
}

#[test]
fn test_multiple_frames_in_single_chunk() {
    let p1 = json!({ "protocol": "tessera.ipc", "majorVersion": 1, "minorVersion": 0, "kind": "request", "id": "1", "method": "state.getSnapshot" });
    let p2 = json!({ "protocol": "tessera.ipc", "majorVersion": 1, "minorVersion": 0, "kind": "request", "id": "2", "method": "config.get" });

    let mut chunk = encode_frame(&p1).unwrap();
    chunk.extend(encode_frame(&p2).unwrap());

    let mut decoder = FrameDecoder::new();
    let frames = decoder.push_bytes(&chunk).expect("Decode chunk failed");

    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0], p1);
    assert_eq!(frames[1], p2);
    decoder.finalize().expect("Finalize failed");
}

#[test]
fn test_unicode_payload() {
    let payload = json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "unicode-тест-日本語-🚀",
        "method": "state.getSnapshot"
    });

    let encoded = encode_frame(&payload).unwrap();
    let mut decoder = FrameDecoder::new();
    let frames = decoder.push_bytes(&encoded).unwrap();

    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["id"], "unicode-тест-日本語-🚀");
}

#[test]
fn test_zero_length_frame_rejected() {
    let mut decoder = FrameDecoder::new();
    // 4-byte header specifying length 0
    let zero_header = 0u32.to_be_bytes();
    let err = decoder.push_bytes(&zero_header).unwrap_err();
    assert_eq!(err.code, error_codes::DECODE_ERROR);
}

#[test]
fn test_oversized_declared_frame_rejected() {
    let mut decoder = FrameDecoder::new();
    // Length declared as 2 MiB (exceeds 1 MiB limit)
    let len = (MAX_FRAME_SIZE as u32 + 1024).to_be_bytes();
    let err = decoder.push_bytes(&len).unwrap_err();
    assert_eq!(err.code, error_codes::FRAME_TOO_LARGE);
}

#[test]
fn test_excessive_buffered_bytes_rejected_pre_copy() {
    let mut decoder = FrameDecoder::new();
    // Feed partial frame with valid declared length within MAX_FRAME_SIZE
    let mut partial_chunk = (MAX_FRAME_SIZE as u32).to_be_bytes().to_vec();
    partial_chunk.resize(500_000, 0x20);
    decoder.push_bytes(&partial_chunk).unwrap();
    assert_eq!(decoder.buffered_len(), 500_000);

    // Now feed 1.7 MiB chunk: 500_000 + 1_700_000 = 2_200_000 exceeds 2 MiB ceiling
    let oversized_chunk = vec![0x20u8; 1_700_000];
    let err = decoder.push_bytes(&oversized_chunk).unwrap_err();
    assert_eq!(err.code, error_codes::RESOURCE_LIMIT_EXCEEDED);
    // Assert buffer was not modified by rejected chunk
    assert_eq!(decoder.buffered_len(), 500_000);
}

#[test]
fn test_invalid_utf8_rejected() {
    let mut decoder = FrameDecoder::new();
    let invalid_bytes = [0x00, 0x00, 0x00, 0x04, 0xFF, 0xFE, 0xFD, 0xFC];
    let err = decoder.push_bytes(&invalid_bytes).unwrap_err();
    assert_eq!(err.code, error_codes::DECODE_ERROR);
}

#[test]
fn test_malformed_json_rejected() {
    let mut decoder = FrameDecoder::new();
    let bad_json = b"{ not a json }";
    let len = (bad_json.len() as u32).to_be_bytes();
    let mut chunk = len.to_vec();
    chunk.extend_from_slice(bad_json);

    let err = decoder.push_bytes(&chunk).unwrap_err();
    assert_eq!(err.code, error_codes::DECODE_ERROR);
}

#[test]
fn test_finalize_with_unconsumed_bytes_returns_decode_error() {
    let mut decoder = FrameDecoder::new();
    // Only 2 bytes of 4-byte length header
    decoder.push_bytes(&[0x00, 0x00]).unwrap();
    let err = decoder.finalize().unwrap_err();
    assert_eq!(err.code, error_codes::DECODE_ERROR);
}
