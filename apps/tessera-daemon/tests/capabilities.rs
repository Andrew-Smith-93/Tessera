use serde_json::json;
use std::collections::HashSet;
use std::sync::Arc;
use tessera_daemon::backend::{DisconnectedBackend, InMemoryTestBackend};
use tessera_daemon::protocol::{error_codes, V1_CAPABILITIES};
use tessera_daemon::schema::CompiledSchemas;
use tessera_daemon::server::ConnectionHandler;
use tessera_daemon::shutdown::ShutdownCoordinator;

#[test]
fn test_canonical_capabilities_inventory() {
    // Assert canonical 4 capabilities in exact order / set
    let expected = [
        "state.inspect",
        "config.mutate",
        "runtime.control",
        "trace.inspect",
    ];
    assert_eq!(V1_CAPABILITIES.len(), 4);
    for cap in &expected {
        assert!(
            V1_CAPABILITIES.contains(cap),
            "Missing canonical capability {}",
            cap
        );
    }
}

#[test]
fn test_hello_returns_exact_granted_capabilities_for_request() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(1, backend, schemas, shutdown);

    // Requesting subset ["state.inspect", "runtime.control"]
    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-req-1",
        "method": "system.hello",
        "params": {
            "clientName": "TestCapClient",
            "clientVersion": "1.0",
            "requestedCapabilities": ["state.inspect", "runtime.control"]
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
}

#[test]
fn test_unknown_and_colon_form_capabilities_are_not_granted() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(2, backend, schemas, shutdown);

    // Requesting colon aliases and random unknown strings along with valid capability
    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-req-2",
        "method": "system.hello",
        "params": {
            "clientName": "TestCapClient",
            "clientVersion": "1.0",
            "requestedCapabilities": [
                "state:read",
                "runtime:control",
                "config:mutate",
                "unknown.capability",
                "state.inspect"
            ]
        }
    }));

    assert!(resp["ok"].as_bool().unwrap());
    let caps: Vec<String> = resp["result"]["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();

    // Colon aliases and unknown capabilities must NOT be granted
    assert_eq!(caps, vec!["state.inspect"]);
    assert!(!caps.contains(&"state:read".to_string()));
    assert!(!caps.contains(&"runtime:control".to_string()));
    assert!(!caps.contains(&"config:mutate".to_string()));
}

#[test]
fn test_method_authorization_per_capability() {
    let backend = Arc::new(InMemoryTestBackend::new(0x01));
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();

    // 1. Session with only state.inspect
    let mut handler_state =
        ConnectionHandler::new(3, backend.clone(), schemas.clone(), shutdown.clone());
    handler_state.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-s",
        "method": "system.hello",
        "params": {
            "clientName": "StateClient",
            "clientVersion": "1.0",
            "requestedCapabilities": ["state.inspect"]
        }
    }));

    // Allowed under state.inspect: state.getSnapshot, config.get, state.getDiagnostics, state.getCapabilities, runtime.getVersion
    let snap_res = handler_state.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "snap-1",
        "method": "state.getSnapshot"
    }));
    assert!(snap_res["ok"].as_bool().unwrap());

    let get_caps = handler_state.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "caps-1",
        "method": "state.getCapabilities"
    }));
    assert!(get_caps["ok"].as_bool().unwrap());
    let advertised_caps: HashSet<String> = get_caps["result"]["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        advertised_caps,
        V1_CAPABILITIES
            .iter()
            .map(|&s| s.to_string())
            .collect::<HashSet<_>>()
    );

    // Forbidden under state.inspect: runtime.setLayout (requires runtime.control)
    let layout_res = handler_state.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "lay-1",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns" }
    }));
    assert!(!layout_res["ok"].as_bool().unwrap());
    assert_eq!(
        layout_res["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );

    // Forbidden under state.inspect: config.applyPatch (requires config.mutate)
    let patch_res = handler_state.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "patch-1",
        "method": "config.applyPatch",
        "params": { "patch": { "enableTiling": false } }
    }));
    assert!(!patch_res["ok"].as_bool().unwrap());
    assert_eq!(
        patch_res["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );

    // 2. Session with only runtime.control
    let mut handler_runtime =
        ConnectionHandler::new(4, backend.clone(), schemas.clone(), shutdown.clone());
    handler_runtime.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-r",
        "method": "system.hello",
        "params": {
            "clientName": "RuntimeClient",
            "clientVersion": "1.0",
            "requestedCapabilities": ["runtime.control"]
        }
    }));

    // Allowed under runtime.control: runtime.setLayout
    let layout_ok = handler_runtime.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "lay-ok",
        "method": "runtime.setLayout",
        "params": { "outputId": "HDMI-A-1", "layout": "columns" }
    }));
    assert!(layout_ok["ok"].as_bool().unwrap());

    // Forbidden under runtime.control: state.getSnapshot
    let snap_fail = handler_runtime.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "snap-fail",
        "method": "state.getSnapshot"
    }));
    assert!(!snap_fail["ok"].as_bool().unwrap());
    assert_eq!(
        snap_fail["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );
}

#[test]
fn test_disconnected_backend_grants_zero_capabilities() {
    let backend = Arc::new(DisconnectedBackend);
    let schemas = Arc::new(CompiledSchemas::compile().unwrap());
    let shutdown = ShutdownCoordinator::new();
    let mut handler = ConnectionHandler::new(5, backend, schemas, shutdown);

    let resp = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "h-disc",
        "method": "system.hello",
        "params": {
            "clientName": "DiscClient",
            "clientVersion": "1.0",
            "requestedCapabilities": V1_CAPABILITIES
        }
    }));

    assert!(resp["ok"].as_bool().unwrap());
    let caps = resp["result"]["capabilities"].as_array().unwrap();
    assert!(
        caps.is_empty(),
        "Disconnected backend must grant 0 capabilities"
    );

    // Any runtime-dependent method fails with CAPABILITY_NOT_NEGOTIATED
    let snap_res = handler.process_frame(json!({
        "protocol": "tessera.ipc",
        "majorVersion": 1,
        "minorVersion": 0,
        "kind": "request",
        "id": "snap-disc",
        "method": "state.getSnapshot"
    }));
    assert_eq!(
        snap_res["error"]["code"],
        error_codes::CAPABILITY_NOT_NEGOTIATED
    );
}
