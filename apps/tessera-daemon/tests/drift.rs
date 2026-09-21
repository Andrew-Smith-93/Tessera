use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use tessera_daemon::config::{
    MAX_ARRAY_LENGTH, MAX_BUFFERED_BYTES, MAX_FRAME_SIZE, MAX_IDEMPOTENCY_CACHE_SIZE,
    MAX_NESTING_DEPTH, MAX_OUTSTANDING_REQUESTS, MAX_QUEUE_LENGTH, MAX_STRING_LENGTH,
    MAX_SUBSCRIPTION_COUNT, PROTOCOL_MAJOR_VERSION, PROTOCOL_MINOR_VERSION, PROTOCOL_NAMESPACE,
};
use tessera_daemon::protocol::{error_codes, KNOWN_EVENTS, KNOWN_METHODS, V1_CAPABILITIES};

fn get_schemas_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/protocol/src/schemas")
}

fn get_types_file() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/protocol/src/types.ts")
}

#[test]
fn test_protocol_identity_drift() {
    let envelope_path = get_schemas_dir().join("envelope.schema.json");
    let envelope_json: Value = serde_json::from_str(
        &fs::read_to_string(&envelope_path).expect("Failed to read envelope.schema.json"),
    )
    .expect("Failed to parse envelope.schema.json");

    // 1. Assert protocol namespace matches schema const
    let schema_protocol = envelope_json["properties"]["protocol"]["const"]
        .as_str()
        .expect("Missing properties.protocol.const");
    assert_eq!(
        PROTOCOL_NAMESPACE, schema_protocol,
        "Rust PROTOCOL_NAMESPACE drifted from canonical envelope schema"
    );

    // 2. Assert major version matches schema const
    let schema_major = envelope_json["properties"]["majorVersion"]["const"]
        .as_u64()
        .expect("Missing properties.majorVersion.const");
    assert_eq!(
        PROTOCOL_MAJOR_VERSION as u64, schema_major,
        "Rust PROTOCOL_MAJOR_VERSION drifted from canonical envelope schema"
    );

    // 3. Assert minor version matches types.ts
    let types_content =
        fs::read_to_string(get_types_file()).expect("Failed to read protocol types.ts");
    assert!(
        types_content.contains(&format!(
            "export const PROTOCOL_MINOR_VERSION = {} as const;",
            PROTOCOL_MINOR_VERSION
        )),
        "Rust PROTOCOL_MINOR_VERSION drifted from protocol types.ts"
    );
}

#[test]
fn test_known_methods_drift() {
    let req_path = get_schemas_dir().join("request.schema.json");
    let req_json: Value = serde_json::from_str(
        &fs::read_to_string(&req_path).expect("Failed to read request.schema.json"),
    )
    .expect("Failed to parse request.schema.json");

    let schema_methods: BTreeSet<String> = req_json["properties"]["method"]["enum"]
        .as_array()
        .expect("Missing properties.method.enum in request.schema.json")
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();

    let rust_methods: BTreeSet<String> = KNOWN_METHODS.iter().map(|&s| s.to_string()).collect();

    assert_eq!(
        rust_methods, schema_methods,
        "Rust KNOWN_METHODS differs from canonical request.schema.json enum"
    );
    assert_eq!(
        KNOWN_METHODS.len(),
        17,
        "Expected exactly 17 registered methods in Protocol V1"
    );
}

#[test]
fn test_known_events_drift() {
    let evt_path = get_schemas_dir().join("event.schema.json");
    let evt_json: Value = serde_json::from_str(
        &fs::read_to_string(&evt_path).expect("Failed to read event.schema.json"),
    )
    .expect("Failed to parse event.schema.json");

    let schema_events: BTreeSet<String> = evt_json["properties"]["event"]["enum"]
        .as_array()
        .expect("Missing properties.event.enum in event.schema.json")
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();

    let rust_events: BTreeSet<String> = KNOWN_EVENTS.iter().map(|&s| s.to_string()).collect();

    assert_eq!(
        rust_events, schema_events,
        "Rust KNOWN_EVENTS differs from canonical event.schema.json enum"
    );
    assert_eq!(
        KNOWN_EVENTS.len(),
        6,
        "Expected exactly 6 registered events in Protocol V1"
    );
}

#[test]
fn test_capabilities_drift() {
    let types_content =
        fs::read_to_string(get_types_file()).expect("Failed to read protocol types.ts");

    // Extract canonical capabilities from types.ts V1_CAPABILITIES
    let rust_caps: BTreeSet<String> = V1_CAPABILITIES.iter().map(|&s| s.to_string()).collect();

    for cap in &rust_caps {
        assert!(
            types_content.contains(&format!("\"{}\"", cap)),
            "Capability {} not found in canonical types.ts",
            cap
        );
    }

    assert_eq!(
        rust_caps.len(),
        4,
        "Expected exactly 4 canonical capabilities in Protocol V1"
    );
}

#[test]
fn test_error_taxonomy_drift() {
    let types_content =
        fs::read_to_string(get_types_file()).expect("Failed to read protocol types.ts");

    let rust_errors = [
        error_codes::INVALID_ENVELOPE,
        error_codes::UNSUPPORTED_MAJOR_VERSION,
        error_codes::UNSUPPORTED_MINOR_VERSION,
        error_codes::CAPABILITY_NOT_NEGOTIATED,
        error_codes::UNKNOWN_METHOD,
        error_codes::INVALID_PAYLOAD,
        error_codes::FRAME_TOO_LARGE,
        error_codes::CONFIG_VALIDATION_FAILED,
        error_codes::REVISION_CONFLICT,
        error_codes::IDEMPOTENCY_CONFLICT,
        error_codes::RESOURCE_LIMIT_EXCEEDED,
        error_codes::WINDOW_NOT_FOUND,
        error_codes::OUTPUT_NOT_FOUND,
        error_codes::TRACE_DISABLED,
        error_codes::INTERNAL_ERROR,
        error_codes::DECODE_ERROR,
    ];

    for code in &rust_errors {
        assert!(
            types_content.contains(&format!("{} = \"{}\"", code, code)),
            "Error code {} not found in canonical ProtocolErrorCode enum in types.ts",
            code
        );
    }
}

#[test]
fn test_resource_limits_drift() {
    let types_content =
        fs::read_to_string(get_types_file()).expect("Failed to read protocol types.ts");

    // Assert key resource limits match
    assert!(
        types_content.contains(&format!("MAX_NESTING_DEPTH = {};", MAX_NESTING_DEPTH)),
        "MAX_NESTING_DEPTH mismatch"
    );
    assert!(
        types_content.contains(&format!("MAX_STRING_LENGTH = {};", MAX_STRING_LENGTH)),
        "MAX_STRING_LENGTH mismatch"
    );
    assert!(
        types_content.contains(&format!("MAX_ARRAY_LENGTH = {};", MAX_ARRAY_LENGTH)),
        "MAX_ARRAY_LENGTH mismatch"
    );
    assert!(
        types_content.contains(&format!(
            "MAX_OUTSTANDING_REQUESTS = {};",
            MAX_OUTSTANDING_REQUESTS
        )),
        "MAX_OUTSTANDING_REQUESTS mismatch"
    );
    assert!(
        types_content.contains(&format!(
            "MAX_SUBSCRIPTION_COUNT = {};",
            MAX_SUBSCRIPTION_COUNT
        )),
        "MAX_SUBSCRIPTION_COUNT mismatch"
    );
    assert!(
        types_content.contains(&format!("MAX_QUEUE_LENGTH = {};", MAX_QUEUE_LENGTH)),
        "MAX_QUEUE_LENGTH mismatch"
    );
    assert!(
        types_content.contains(&format!(
            "MAX_IDEMPOTENCY_CACHE_SIZE = {};",
            MAX_IDEMPOTENCY_CACHE_SIZE
        )),
        "MAX_IDEMPOTENCY_CACHE_SIZE mismatch"
    );
    assert!(
        types_content.contains("MAX_BUFFERED_BYTES = 2 * 1024 * 1024;"),
        "MAX_BUFFERED_BYTES mismatch"
    );
    assert_eq!(MAX_BUFFERED_BYTES, 2 * 1024 * 1024);
    assert_eq!(MAX_FRAME_SIZE, 1024 * 1024);
}
