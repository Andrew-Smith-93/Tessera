use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tessera_daemon::backend::InMemoryTestBackend;
use tessera_daemon::framing::{encode_frame, FrameDecoder};
use tessera_daemon::schema::{validate_envelope, CompiledSchemas};
use tessera_daemon::server::ConnectionHandler;
use tessera_daemon::shutdown::ShutdownCoordinator;

fn get_fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/protocol/fixtures")
}

#[test]
fn test_valid_fixtures_conformance() {
    let schemas = CompiledSchemas::compile().expect("Failed to compile canonical schemas");
    let valid_dir = get_fixtures_dir().join("valid");

    let mut entries: Vec<_> = fs::read_dir(&valid_dir)
        .expect("Failed to read valid fixtures dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect();

    entries.sort_by_key(|e| e.path());
    assert!(!entries.is_empty(), "No valid fixtures found");

    for entry in entries {
        let path = entry.path();
        let content = fs::read_to_string(&path).expect("Failed to read fixture");
        let parsed: Value = serde_json::from_str(&content).expect("Failed to parse fixture JSON");

        // 1. Envelope validation against compiled canonical schema
        validate_envelope(&parsed, &schemas)
            .unwrap_or_else(|e| panic!("Valid fixture {:?} failed validation: {}", path, e));

        // 2. Framing round-trip
        let encoded = encode_frame(&parsed).expect("Frame encoding failed");
        let mut decoder = FrameDecoder::new();
        let decoded = decoder.push_bytes(&encoded).expect("Frame decoding failed");
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0], parsed);
        decoder.finalize().expect("Finalize failed");
    }
}

#[test]
fn test_invalid_fixtures_conformance() {
    let schemas =
        Arc::new(CompiledSchemas::compile().expect("Failed to compile canonical schemas"));
    let invalid_dir = get_fixtures_dir().join("invalid");

    let mut entries: Vec<_> = fs::read_dir(&invalid_dir)
        .expect("Failed to read invalid fixtures dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect();

    entries.sort_by_key(|e| e.path());
    assert!(!entries.is_empty(), "No invalid fixtures found");

    let backend = Arc::new(InMemoryTestBackend::new(0xFF));
    let shutdown = ShutdownCoordinator::new();

    // Session configured for conformance testing
    let mut conformance_session =
        ConnectionHandler::new(100, backend.clone(), schemas.clone(), shutdown.clone());
    let mut unnegotiated_session =
        ConnectionHandler::new(200, backend.clone(), schemas.clone(), shutdown.clone());

    // Perform handshake for conformance_session so methods can be invoked
    let hello_res = conformance_session.process_frame(serde_json::json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-conf",
        "method": "system.hello",
        "params": { "clientName": "ConformanceRunner", "clientVersion": "1.0" }
    }));
    assert!(hello_res["ok"].as_bool().unwrap());

    // Seed idempotency for fixture 20-idempotency-conflict
    let seed_resp = conformance_session.process_frame(serde_json::json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "seed-idem-20",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns", "idempotencyKey": "test-idem-conflict" }
    }));
    assert!(seed_resp["ok"].as_bool().unwrap());

    for entry in entries {
        let path = entry.path();
        let filename = path.file_name().unwrap().to_str().unwrap();
        let content = fs::read_to_string(&path).expect("Failed to read invalid fixture");
        let wrapped: Value = serde_json::from_str(&content).expect("Failed to parse fixture");

        let expected_code = wrapped["expectedErrorCode"]
            .as_str()
            .unwrap_or_else(|| panic!("Fixture {:?} must declare expectedErrorCode", path));
        let payload = &wrapped["payload"];

        let mut actual_code: Option<String> = None;

        // 1. Envelope / limits validation
        if let Err(val_err) = validate_envelope(payload, &schemas) {
            actual_code = Some(val_err.code.to_string());
        } else {
            // 2. Dispatch through handler
            let resp = if filename.contains("unnegotiated") {
                unnegotiated_session.process_frame(payload.clone())
            } else {
                conformance_session.process_frame(payload.clone())
            };

            if let Some(err_obj) = resp.get("error") {
                if let Some(c) = err_obj.get("code").and_then(Value::as_str) {
                    actual_code = Some(c.to_string());
                }
            }
        }

        assert_eq!(
            actual_code.as_deref(),
            Some(expected_code),
            "Invalid fixture '{}' failed with code {:?}, expected '{}'",
            filename,
            actual_code,
            expected_code
        );
    }
}
