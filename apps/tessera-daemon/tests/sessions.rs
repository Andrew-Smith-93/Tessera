use serde_json::json;
use std::sync::Arc;
use tessera_daemon::backend::{DisconnectedBackend, InMemoryTestBackend};
use tessera_daemon::protocol::error_codes;
use tessera_daemon::schema::CompiledSchemas;
use tessera_daemon::server::ConnectionHandler;
use tessera_daemon::shutdown::ShutdownCoordinator;

#[test]
fn test_same_client_name_session_isolation_and_idempotency() {
    let backend = Arc::new(InMemoryTestBackend::new(0xFF));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();

    // Two simultaneous sessions with identical clientName
    let mut session1 =
        ConnectionHandler::new(1, backend.clone(), schemas.clone(), shutdown.clone());
    let mut session2 =
        ConnectionHandler::new(2, backend.clone(), schemas.clone(), shutdown.clone());

    // Both perform hello with SAME clientName
    let hello1_resp = session1.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-1",
        "method": "system.hello",
        "params": { "clientName": "DuplicateApp", "clientVersion": "1.0" }
    }));
    assert!(hello1_resp["ok"].as_bool().unwrap());

    let hello2_resp = session2.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-2",
        "method": "system.hello",
        "params": { "clientName": "DuplicateApp", "clientVersion": "1.0" }
    }));
    assert!(hello2_resp["ok"].as_bool().unwrap());

    // Both send requests with SAME idempotencyKey but DIFFERENT payloads
    let req1 = json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "req-1",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns", "idempotencyKey": "shared-idem-key" }
    });
    let resp1 = session1.process_frame(req1);
    assert!(resp1["ok"].as_bool().unwrap());
    let cmd1_id = resp1["result"]["commandId"].as_str().unwrap().to_string();

    let req2 = json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "req-2",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "grid", "idempotencyKey": "shared-idem-key" }
    });
    let resp2 = session2.process_frame(req2);
    assert!(resp2["ok"].as_bool().unwrap());
    let cmd2_id = resp2["result"]["commandId"].as_str().unwrap().to_string();

    // Assert commands are different and neither conflicted
    assert_ne!(cmd1_id, cmd2_id);

    // Session 1 replays its key: receives its own cached commandId
    let replay1 = session1.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "replay-1",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns", "idempotencyKey": "shared-idem-key" }
    }));
    assert!(replay1["ok"].as_bool().unwrap());
    assert_eq!(replay1["result"]["commandId"].as_str().unwrap(), cmd1_id);

    // Session 2 replays its key: receives its own cached commandId
    let replay2 = session2.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "replay-2",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "grid", "idempotencyKey": "shared-idem-key" }
    }));
    assert!(replay2["ok"].as_bool().unwrap());
    assert_eq!(replay2["result"]["commandId"].as_str().unwrap(), cmd2_id);

    // Conflicting payload WITHIN session 1 fails with IDEMPOTENCY_CONFLICT
    let conflict1 = session1.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "conflict-1",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "rows", "idempotencyKey": "shared-idem-key" }
    }));
    assert!(!conflict1["ok"].as_bool().unwrap());
    assert_eq!(
        conflict1["error"]["code"],
        error_codes::IDEMPOTENCY_CONFLICT
    );
}

#[test]
fn test_subscriptions_lifecycle_and_limits() {
    let backend = Arc::new(InMemoryTestBackend::new(0xFF));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();

    let mut session = ConnectionHandler::new(10, backend, schemas, shutdown);

    // Attempting subscribe before hello fails
    let early_sub = session.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "early-sub",
        "method": "system.subscribe",
        "params": { "events": ["runtime.stateChanged"] }
    }));
    assert_eq!(
        early_sub["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );

    // Hello
    session.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-sub",
        "method": "system.hello",
        "params": { "clientName": "SubClient", "clientVersion": "1.0" }
    }));

    // Subscribe valid events
    let sub_resp = session.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "sub-1",
        "method": "system.subscribe",
        "params": { "events": ["runtime.stateChanged", "runtime.warning"] }
    }));
    assert!(sub_resp["ok"].as_bool().unwrap());
    let subscribed = sub_resp["result"]["subscribed"].as_array().unwrap();
    assert_eq!(subscribed.len(), 2);

    // Exceeding 100 subscriptions returns RESOURCE_LIMIT_EXCEEDED
    let mut too_many = Vec::new();
    for i in 0..105 {
        too_many.push(format!("custom.event.{}", i));
    }
    let overflow_resp = session.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "sub-overflow",
        "method": "system.subscribe",
        "params": { "events": too_many }
    }));
    assert_eq!(
        overflow_resp["error"]["code"],
        error_codes::RESOURCE_LIMIT_EXCEEDED
    );

    // Unsubscribe
    let unsub_resp = session.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "unsub-1",
        "method": "system.unsubscribe",
        "params": { "events": ["runtime.warning"] }
    }));
    assert!(unsub_resp["ok"].as_bool().unwrap());
    let remaining = unsub_resp["result"]["subscribed"].as_array().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0], "runtime.stateChanged");
}

#[test]
fn test_disconnected_backend_rejects_unsupported_capabilities() {
    let backend = Arc::new(DisconnectedBackend);
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();

    let mut session = ConnectionHandler::new(20, backend, schemas, shutdown);

    let hello_resp = session.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-disc",
        "method": "system.hello",
        "params": { "clientName": "DiscClient", "clientVersion": "1.0" }
    }));
    assert!(hello_resp["ok"].as_bool().unwrap());
    // In disconnected mode, granted capabilities must be empty
    let caps = hello_resp["result"]["capabilities"].as_array().unwrap();
    assert!(
        caps.is_empty(),
        "Disconnected backend must advertise 0 capabilities"
    );

    // Any capability-dependent method must fail with CAPABILITY_NOT_NEGOTIATED
    let snap_resp = session.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "snap-disc",
        "method": "state.getSnapshot"
    }));
    assert_eq!(
        snap_resp["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );
}
