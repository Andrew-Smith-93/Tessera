use serde_json::json;
use std::collections::HashSet;
use std::sync::Arc;
use tessera_daemon::backend::{DisconnectedBackend, InMemoryTestBackend, RuntimeBackend};
use tessera_daemon::protocol::{error_codes, V1_CAPABILITIES};
use tessera_daemon::schema::CompiledSchemas;
use tessera_daemon::server::ConnectionHandler;
use tessera_daemon::shutdown::ShutdownCoordinator;

#[test]
fn test_behavioral_1_system_hello_version_negotiation() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();

    // Valid hello
    let mut h1 = ConnectionHandler::new(1, backend.clone(), schemas.clone(), shutdown.clone());
    let resp_valid = h1.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-valid",
        "method": "system.hello",
        "params": {
            "clientName": "TestClient",
            "clientVersion": "1.0",
            "minMajor": 1,
            "maxMajor": 1,
            "minMinor": 0,
            "maxMinor": 0
        }
    }));
    assert!(resp_valid["ok"].as_bool().unwrap());
    assert_eq!(resp_valid["result"]["negotiatedMajor"], 1);
    assert_eq!(resp_valid["result"]["negotiatedMinor"], 0);

    // Unsupported major version
    let mut h2 = ConnectionHandler::new(2, backend.clone(), schemas.clone(), shutdown.clone());
    let resp_bad_major = h2.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-bad-major",
        "method": "system.hello",
        "params": { "clientName": "TestClient", "clientVersion": "1.0", "minMajor": 2, "maxMajor": 2 }
    }));
    assert!(!resp_bad_major["ok"].as_bool().unwrap());
    assert_eq!(
        resp_bad_major["error"]["code"],
        error_codes::UNSUPPORTED_MAJOR_VERSION
    );

    // Unsupported minor version
    let mut h3 = ConnectionHandler::new(3, backend.clone(), schemas.clone(), shutdown.clone());
    let resp_bad_minor = h3.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-bad-minor",
        "method": "system.hello",
        "params": { "clientName": "TestClient", "clientVersion": "1.0", "minMinor": 5 }
    }));
    assert!(!resp_bad_minor["ok"].as_bool().unwrap());
    assert_eq!(
        resp_bad_minor["error"]["code"],
        error_codes::UNSUPPORTED_MINOR_VERSION
    );
}

#[test]
fn test_behavioral_2_capability_grants() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(4, backend, schemas, shutdown);

    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-cap",
        "method": "system.hello",
        "params": {
            "clientName": "CapClient",
            "clientVersion": "1.0",
            "requestedCapabilities": ["state.inspect", "runtime.control", "state:read", "invalid.cap"]
        }
    }));

    assert!(resp["ok"].as_bool().unwrap());
    let caps: Vec<String> = resp["result"]["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();

    assert_eq!(caps, vec!["runtime.control", "state.inspect"]);
    assert!(!caps.contains(&"state:read".to_string()));
    assert!(!caps.contains(&"invalid.cap".to_string()));
}

#[test]
fn test_behavioral_3_requests_before_hello() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(5, backend, schemas, shutdown);

    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "snap-pre-hello",
        "method": "state.getSnapshot"
    }));

    assert!(!resp["ok"].as_bool().unwrap());
    assert_eq!(
        resp["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );
}

#[test]
fn test_behavioral_4_state_get_capabilities() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(6, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "get-caps",
        "method": "state.getCapabilities"
    }));

    assert!(resp["ok"].as_bool().unwrap());
    let caps: HashSet<String> = resp["result"]["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();

    let expected: HashSet<String> = V1_CAPABILITIES.iter().map(|&s| s.to_string()).collect();
    assert_eq!(caps, expected);
}

#[test]
fn test_behavioral_5_subscribe_and_unsubscribe() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(7, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0" }
    }));

    let sub_resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "sub-1",
        "method": "system.subscribe",
        "params": { "events": ["runtime.stateChanged", "runtime.warning"] }
    }));
    assert!(sub_resp["ok"].as_bool().unwrap());
    let sub_list: HashSet<String> = sub_resp["result"]["subscribed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert!(sub_list.contains("runtime.stateChanged"));
    assert!(sub_list.contains("runtime.warning"));

    let unsub_resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "unsub-1",
        "method": "system.unsubscribe",
        "params": { "events": ["runtime.warning"] }
    }));
    assert!(unsub_resp["ok"].as_bool().unwrap());
    let remaining: Vec<String> = unsub_resp["result"]["subscribed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert_eq!(remaining, vec!["runtime.stateChanged"]);
}

#[test]
fn test_behavioral_6_unauthorized_methods() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(8, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": ["state.inspect"] }
    }));

    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "lay-unauth",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns" }
    }));

    assert!(!resp["ok"].as_bool().unwrap());
    assert_eq!(
        resp["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );
}

#[test]
fn test_behavioral_7_unknown_methods() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(9, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0" }
    }));

    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "unk-1",
        "method": "unknown.method",
        "params": {}
    }));

    assert!(!resp["ok"].as_bool().unwrap());
    assert!(
        resp["error"]["code"] == error_codes::UNKNOWN_METHOD
            || resp["error"]["code"] == error_codes::INVALID_ENVELOPE
    );
}

#[test]
fn test_behavioral_8_invalid_parameters() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(10, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    // Missing layout parameter in runtime.setLayout
    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "inv-param",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1" }
    }));

    assert!(!resp["ok"].as_bool().unwrap());
    assert_eq!(resp["error"]["code"], error_codes::INVALID_PAYLOAD);
}

#[test]
fn test_behavioral_9_revision_conflict() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(11, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "rev-conflict",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns", "expectedRevision": 9999 }
    }));

    assert!(!resp["ok"].as_bool().unwrap());
    assert_eq!(resp["error"]["code"], error_codes::REVISION_CONFLICT);
}

#[test]
fn test_behavioral_10_idempotent_replay() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(12, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    let resp1 = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "id-1",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns", "idempotencyKey": "idem-key-10" }
    }));
    assert!(resp1["ok"].as_bool().unwrap());
    let cmd1 = resp1["result"]["commandId"].as_str().unwrap().to_string();
    let rev1 = resp1["result"]["stateRevision"].as_u64().unwrap();

    let resp2 = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "id-2",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns", "idempotencyKey": "idem-key-10" }
    }));
    assert!(resp2["ok"].as_bool().unwrap());
    let cmd2 = resp2["result"]["commandId"].as_str().unwrap().to_string();
    let rev2 = resp2["result"]["stateRevision"].as_u64().unwrap();

    assert_eq!(cmd1, cmd2);
    assert_eq!(rev1, rev2);
}

#[test]
fn test_behavioral_11_idempotency_conflict() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(13, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "id-c1",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns", "idempotencyKey": "conflict-key" }
    }));

    let conflict_resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "id-c2",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "rows", "idempotencyKey": "conflict-key" }
    }));

    assert!(!conflict_resp["ok"].as_bool().unwrap());
    assert_eq!(
        conflict_resp["error"]["code"],
        error_codes::IDEMPOTENCY_CONFLICT
    );
}

#[test]
fn test_behavioral_12_same_client_name_across_two_isolated_sessions() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();

    let mut session1 =
        ConnectionHandler::new(14, backend.clone(), schemas.clone(), shutdown.clone());
    let mut session2 =
        ConnectionHandler::new(15, backend.clone(), schemas.clone(), shutdown.clone());

    session1.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-s1",
        "method": "system.hello",
        "params": { "clientName": "SharedApp", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    session2.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-s2",
        "method": "system.hello",
        "params": { "clientName": "SharedApp", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    let resp1 = session1.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "req-1",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns", "idempotencyKey": "shared-key" }
    }));

    let resp2 = session2.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "req-2",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "grid", "idempotencyKey": "shared-key" }
    }));

    assert!(resp1["ok"].as_bool().unwrap());
    assert!(resp2["ok"].as_bool().unwrap());
    let cmd1 = resp1["result"]["commandId"].as_str().unwrap();
    let cmd2 = resp2["result"]["commandId"].as_str().unwrap();
    assert_ne!(cmd1, cmd2);
}

#[test]
fn test_behavioral_13_target_not_found_errors() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(16, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    let out_err = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "bad-out",
        "method": "runtime.setLayout",
        "params": { "outputId": "NONEXISTENT-OUTPUT", "layout": "columns" }
    }));
    assert!(!out_err["ok"].as_bool().unwrap());
    assert_eq!(out_err["error"]["code"], error_codes::OUTPUT_NOT_FOUND);

    let win_err = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "bad-win",
        "method": "runtime.setWindowFloating",
        "params": { "windowId": "NONEXISTENT-WINDOW", "floating": true }
    }));
    assert!(!win_err["ok"].as_bool().unwrap());
    assert_eq!(win_err["error"]["code"], error_codes::WINDOW_NOT_FOUND);
}

#[test]
fn test_behavioral_14_disconnected_backend_behavior() {
    let backend = Arc::new(DisconnectedBackend);
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(17, backend, schemas, shutdown);

    let hello_resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-disc",
        "method": "system.hello",
        "params": { "clientName": "DiscClient", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    assert!(hello_resp["ok"].as_bool().unwrap());
    let caps = hello_resp["result"]["capabilities"].as_array().unwrap();
    assert!(
        caps.is_empty(),
        "Disconnected backend must grant 0 capabilities"
    );

    let snap_resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "snap-disc",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns" }
    }));
    assert!(!snap_resp["ok"].as_bool().unwrap());
    assert_eq!(
        snap_resp["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );
}

#[test]
fn test_behavioral_15_redaction() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(18, backend.clone(), schemas, shutdown);

    // Apply config with redactIdentities: true
    let _ = backend.enqueue_config_patch(json!({ "redactIdentities": true }), None);
    let _ = backend.advance_command_queue();

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    let snap_resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "snap-redacted",
        "method": "state.getSnapshot"
    }));

    assert!(snap_resp["ok"].as_bool().unwrap());
    let windows = snap_resp["result"]["windows"].as_array().unwrap();
    assert!(!windows.is_empty());
    let win = &windows[0];

    // title is null or omitted
    assert!(win.get("title").is_none() || win["title"].is_null());
    // Identities masked with "[REDACTED]"
    assert_eq!(win["resourceClass"], "[REDACTED]");
    assert_eq!(win["resourceName"], "[REDACTED]");
    assert_eq!(win["appId"], "[REDACTED]");
    assert_eq!(win["desktopFileName"], "[REDACTED]");
    assert_eq!(win["role"], "[REDACTED]");
}

#[test]
fn test_behavioral_16_safe_internal_errors() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(19, backend, schemas, shutdown);

    handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h",
        "method": "system.hello",
        "params": { "clientName": "C", "clientVersion": "1.0", "requestedCapabilities": V1_CAPABILITIES }
    }));

    // Trigger an internal error using a mock or direct helper
    let err_resp = handler.create_internal_error_test_response("err-req");

    assert!(!err_resp["ok"].as_bool().unwrap());
    assert_eq!(err_resp["error"]["code"], error_codes::INTERNAL_ERROR);
    let msg = err_resp["error"]["message"].as_str().unwrap();
    assert!(msg.contains("internal server error"));
    let details = err_resp["error"]["details"].as_object().unwrap();
    assert!(details.contains_key("correlationId"));
}
