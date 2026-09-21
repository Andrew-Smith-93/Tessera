use crate::backend::{CommandAck, RuntimeBackend};
use crate::config::{
    HANDSHAKE_TIMEOUT_SECS, MAX_CONCURRENT_CONNECTIONS, MAX_OUTSTANDING_REQUESTS,
    PROTOCOL_MAJOR_VERSION, PROTOCOL_MINOR_VERSION, READ_TIMEOUT_SECS, WRITE_TIMEOUT_SECS,
};
use crate::framing::{encode_frame, FrameDecoder};
use crate::protocol::{
    compute_canonical_payload_hash, create_protocol_error, create_safe_internal_error, error_codes,
    sanitize_outbound_payload, ProtocolErrorData, V1_CAPABILITIES,
};
use crate::schema::{validate_envelope, CompiledSchemas};
use crate::security::{cleanup_socket, prepare_socket_path, secure_socket_permissions};
use crate::session::SessionState;
use crate::shutdown::ShutdownCoordinator;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Semaphore;
use tokio::time::timeout;

pub struct DaemonServer {
    socket_path: PathBuf,
    backend: Arc<dyn RuntimeBackend>,
    schemas: Arc<CompiledSchemas>,
    shutdown: Arc<ShutdownCoordinator>,
    next_session_id: AtomicU64,
}

impl DaemonServer {
    pub fn new(
        socket_path: PathBuf,
        backend: Arc<dyn RuntimeBackend>,
        shutdown: Arc<ShutdownCoordinator>,
    ) -> Result<Self, String> {
        let schemas = Arc::new(CompiledSchemas::compile()?);
        Ok(DaemonServer {
            socket_path,
            backend,
            schemas,
            shutdown,
            next_session_id: AtomicU64::new(1),
        })
    }

    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        prepare_socket_path(&self.socket_path).map_err(|e| e.to_string())?;

        let listener = UnixListener::bind(&self.socket_path)?;
        secure_socket_permissions(&self.socket_path).map_err(|e| e.to_string())?;

        let conn_limiter = Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS));
        let mut shutdown_rx = self.shutdown.subscribe();

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        break;
                    }
                }
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((stream, _)) => {
                            let permit = match conn_limiter.clone().try_acquire_owned() {
                                Ok(p) => p,
                                Err(_) => {
                                    eprintln!("Warning: max concurrent connections reached, rejecting connection");
                                    drop(stream);
                                    continue;
                                }
                            };

                            let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);
                            let backend = self.backend.clone();
                            let schemas = self.schemas.clone();
                            let shutdown = self.shutdown.clone();

                            tokio::spawn(async move {
                                let _permit = permit;
                                let mut handler = ConnectionHandler::new(session_id, backend, schemas, shutdown);
                                handler.handle(stream).await;
                            });
                        }
                        Err(e) => {
                            if self.shutdown.is_shutting_down() {
                                break;
                            }
                            eprintln!("Error accepting connection: {}", e);
                        }
                    }
                }
            }
        }

        // Cleanup on graceful stop
        cleanup_socket(&self.socket_path);
        Ok(())
    }
}

pub struct ConnectionHandler {
    session: SessionState,
    backend: Arc<dyn RuntimeBackend>,
    schemas: Arc<CompiledSchemas>,
    shutdown: Arc<ShutdownCoordinator>,
    correlation_seq: u64,
}

impl ConnectionHandler {
    pub fn new(
        session_id: u64,
        backend: Arc<dyn RuntimeBackend>,
        schemas: Arc<CompiledSchemas>,
        shutdown: Arc<ShutdownCoordinator>,
    ) -> Self {
        ConnectionHandler {
            session: SessionState::new(session_id),
            backend,
            schemas,
            shutdown,
            correlation_seq: 1,
        }
    }

    pub async fn handle(&mut self, mut stream: UnixStream) {
        let (mut reader, mut writer) = stream.split();
        let mut decoder = FrameDecoder::new();
        let mut read_buf = [0u8; 8192];
        let mut shutdown_rx = self.shutdown.subscribe();

        loop {
            let timeout_duration = if !self.session.hello_completed {
                Duration::from_secs(HANDSHAKE_TIMEOUT_SECS)
            } else {
                Duration::from_secs(READ_TIMEOUT_SECS)
            };

            tokio::select! {
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        break;
                    }
                }
                read_res = timeout(timeout_duration, reader.read(&mut read_buf)) => {
                    match read_res {
                        Ok(Ok(0)) => {
                            // Peer disconnected
                            let _ = decoder.finalize();
                            break;
                        }
                        Ok(Ok(n)) => {
                            match decoder.push_bytes(&read_buf[..n]) {
                                Ok(frames) => {
                                    for frame in frames {
                                        let resp = self.process_frame(frame);
                                        match encode_frame(&resp) {
                                            Ok(wire_bytes) => {
                                                if timeout(Duration::from_secs(WRITE_TIMEOUT_SECS), writer.write_all(&wire_bytes)).await.is_err() {
                                                    break;
                                                }
                                            }
                                            Err(_) => {
                                                break;
                                            }
                                        }
                                    }
                                }
                                Err(framing_err) => {
                                    // Send framing protocol error response before closing connection
                                    let err_resp = json!({
                                        "protocol": "tessera.ipc",
                                        "majorVersion": 1,
                                        "minorVersion": 0,
                                        "kind": "response",
                                        "id": "framing-error",
                                        "replyTo": "none",
                                        "ok": false,
                                        "error": {
                                            "code": framing_err.code,
                                            "message": framing_err.message
                                        }
                                    });
                                    if let Ok(wire_bytes) = encode_frame(&err_resp) {
                                        let _ = timeout(Duration::from_secs(WRITE_TIMEOUT_SECS), writer.write_all(&wire_bytes)).await;
                                    }
                                    break;
                                }
                            }
                        }
                        Ok(Err(_io_err)) => {
                            break;
                        }
                        Err(_timeout_err) => {
                            // Handshake or read timeout exceeded
                            break;
                        }
                    }
                }
            }
        }
    }

    pub fn process_frame(&mut self, val: Value) -> Value {
        // Enforce outstanding request accounting
        if self.session.outstanding_requests >= MAX_OUTSTANDING_REQUESTS {
            return self.create_error_response(
                "overflow",
                "none",
                create_protocol_error(
                    error_codes::RESOURCE_LIMIT_EXCEEDED,
                    &format!(
                        "Session exceeded maximum outstanding request limit of {}",
                        MAX_OUTSTANDING_REQUESTS
                    ),
                ),
            );
        }

        self.session.outstanding_requests += 1;
        let res = self.dispatch_request(val);
        self.session.outstanding_requests = self.session.outstanding_requests.saturating_sub(1);
        res
    }

    fn dispatch_request(&mut self, val: Value) -> Value {
        // 1. Envelope validation
        if let Err(val_err) = validate_envelope(&val, &self.schemas) {
            let req_id = val
                .as_object()
                .and_then(|m| m.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            return self.create_error_response(
                req_id,
                req_id,
                create_protocol_error(val_err.code, &val_err.message),
            );
        }

        let map = val.as_object().unwrap();
        let req_id = map.get("id").and_then(Value::as_str).unwrap();
        let kind = map.get("kind").and_then(Value::as_str).unwrap();

        if kind != "request" {
            return self.create_error_response(
                req_id,
                req_id,
                create_protocol_error(
                    error_codes::INVALID_ENVELOPE,
                    &format!("Expected kind 'request', received '{}'", kind),
                ),
            );
        }

        let method = map.get("method").and_then(Value::as_str).unwrap();
        let params = map
            .get("params")
            .cloned()
            .unwrap_or(Value::Object(Map::new()));

        // 2. Handle system.hello (handshake)
        if method == "system.hello" {
            return self.handle_hello(req_id, &params);
        }

        // 3. Handshake requirement for all other methods
        if !self.session.hello_completed {
            return self.create_error_response(
                req_id,
                req_id,
                create_protocol_error(
                    error_codes::CAPABILITY_NOT_NEGOTIATED,
                    &format!(
                        "Method '{}' cannot be invoked before completing system.hello handshake",
                        method
                    ),
                ),
            );
        }

        // 4. Subscriptions
        if method == "system.subscribe" {
            return self.handle_subscribe(req_id, &params);
        }
        if method == "system.unsubscribe" {
            return self.handle_unsubscribe(req_id, &params);
        }

        // 5. Capability enforcement
        if let Some(required_cap) = self.get_required_capability(method) {
            if !self.session.negotiated_capabilities.contains(required_cap) {
                return self.create_error_response(
                    req_id,
                    req_id,
                    create_protocol_error(
                        error_codes::CAPABILITY_NOT_NEGOTIATED,
                        &format!(
                            "Method '{}' requires capability '{}', which was not negotiated via system.hello",
                            method, required_cap
                        ),
                    ),
                );
            }
        }

        // 6. Dispatch domain methods
        match method {
            "state.getCapabilities" => {
                let caps = self.backend.adapter_capabilities();
                self.create_success_response(
                    req_id,
                    req_id,
                    json!({ "adapterCapabilities": caps }),
                )
            }
            "state.getSnapshot" => {
                match self.backend.get_snapshot(false) {
                    Ok(mut snap) => {
                        let should_redact = snap
                            .get("config")
                            .and_then(|c| c.get("redactIdentities"))
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        sanitize_outbound_payload(&mut snap, should_redact);
                        self.create_success_response(req_id, req_id, snap)
                    }
                    Err(err) => self.create_error_response(req_id, req_id, err),
                }
            }
            "state.getDiagnostics" => {
                match self.backend.get_diagnostics(false) {
                    Ok(diag) => self.create_success_response(req_id, req_id, diag),
                    Err(err) => self.create_error_response(req_id, req_id, err),
                }
            }
            "config.get" => {
                match self.backend.get_snapshot(false) {
                    Ok(snap) => {
                        let config = snap.get("config").cloned().unwrap_or(json!({}));
                        self.create_success_response(req_id, req_id, json!({ "config": config }))
                    }
                    Err(err) => self.create_error_response(req_id, req_id, err),
                }
            }
            "config.validatePatch" => {
                let patch = params.get("patch").unwrap_or(&Value::Null);
                match self.backend.validate_config_patch(patch) {
                    Ok(()) => {
                        self.create_success_response(req_id, req_id, json!({ "valid": true }))
                    }
                    Err(err) => self.create_error_response(req_id, req_id, err),
                }
            }
            "config.applyPatch" => {
                self.handle_command_with_idempotency(req_id, method, params, |b, p, rev| {
                    let patch = p.get("patch").cloned().unwrap_or(Value::Null);
                    b.enqueue_config_patch(patch, rev)
                })
            }
            "runtime.requestReconcile"
            | "runtime.setLayout"
            | "runtime.setMasterCount"
            | "runtime.setMasterRatio"
            | "runtime.setWindowFloating" => {
                let m = method.to_string();
                self.handle_command_with_idempotency(req_id, method, params, move |b, p, rev| {
                    b.enqueue_runtime_command(&m, p, rev)
                })
            }
            "runtime.getVersion" => self.create_success_response(
                req_id,
                req_id,
                json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "protocolVersion": format!("{}.{}", PROTOCOL_MAJOR_VERSION, PROTOCOL_MINOR_VERSION)
                }),
            ),
            "trace.getRecent" => {
                let limit = params.get("limit").and_then(Value::as_u64).map(|u| u as usize);
                match self.backend.get_recent_trace(limit, false) {
                    Ok(mut trace) => {
                        sanitize_outbound_payload(&mut trace, true);
                        self.create_success_response(req_id, req_id, trace)
                    }
                    Err(err) => self.create_error_response(req_id, req_id, err),
                }
            }
            "trace.clearRecent" => match self.backend.clear_recent_trace() {
                Ok(()) => {
                    self.create_success_response(req_id, req_id, json!({ "cleared": true }))
                }
                Err(err) => self.create_error_response(req_id, req_id, err),
            },
            _ => self.create_error_response(
                req_id,
                req_id,
                create_protocol_error(
                    error_codes::UNKNOWN_METHOD,
                    &format!("Method '{}' is not recognized", method),
                ),
            ),
        }
    }

    fn handle_hello(&mut self, req_id: &str, params: &Value) -> Value {
        let client_name = match params.get("clientName").and_then(Value::as_str) {
            Some(name) if !name.trim().is_empty() => name.to_string(),
            _ => {
                return self.create_error_response(
                    req_id,
                    req_id,
                    create_protocol_error(
                        error_codes::INVALID_PAYLOAD,
                        "system.hello requires a non-empty string 'clientName'",
                    ),
                );
            }
        };

        let client_version = match params.get("clientVersion").and_then(Value::as_str) {
            Some(ver) if !ver.trim().is_empty() => ver.to_string(),
            _ => {
                return self.create_error_response(
                    req_id,
                    req_id,
                    create_protocol_error(
                        error_codes::INVALID_PAYLOAD,
                        "system.hello requires a non-empty string 'clientVersion'",
                    ),
                );
            }
        };

        // Major version negotiation
        let min_major = params
            .get("minMajor")
            .and_then(Value::as_u64)
            .unwrap_or(PROTOCOL_MAJOR_VERSION as u64) as u32;
        let max_major = params
            .get("maxMajor")
            .and_then(Value::as_u64)
            .unwrap_or(PROTOCOL_MAJOR_VERSION as u64) as u32;

        if min_major > PROTOCOL_MAJOR_VERSION || max_major < PROTOCOL_MAJOR_VERSION {
            return self.create_error_response(
                req_id,
                req_id,
                create_protocol_error(
                    error_codes::UNSUPPORTED_MAJOR_VERSION,
                    &format!(
                        "Client requested major range [{}..{}], server supports {}",
                        min_major, max_major, PROTOCOL_MAJOR_VERSION
                    ),
                ),
            );
        }

        // Minor version negotiation
        let min_minor = params.get("minMinor").and_then(Value::as_u64).unwrap_or(0) as u32;
        let max_minor = params.get("maxMinor").and_then(Value::as_u64).unwrap_or(0) as u32;

        if min_minor > PROTOCOL_MINOR_VERSION {
            return self.create_error_response(
                req_id,
                req_id,
                create_protocol_error(
                    error_codes::UNSUPPORTED_MINOR_VERSION,
                    &format!(
                        "Client requested minimum minor version {}, server supports up to {}",
                        min_minor, PROTOCOL_MINOR_VERSION
                    ),
                ),
            );
        }

        #[allow(clippy::unnecessary_min_or_max)]
        let negotiated_minor = max_minor.min(PROTOCOL_MINOR_VERSION);

        // Capability negotiation: only grant capabilities supported by the active backend!
        let requested_caps: HashSet<String> = if let Some(arr) = params
            .get("requestedCapabilities")
            .and_then(Value::as_array)
        {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        } else {
            V1_CAPABILITIES.iter().map(|s| s.to_string()).collect()
        };

        let backend_caps = self.backend.adapter_capabilities();
        let mut granted: Vec<String> = Vec::new();
        self.session.negotiated_capabilities.clear();

        for cap in V1_CAPABILITIES {
            let cap_str = cap.to_string();
            if requested_caps.contains(&cap_str) {
                // If backend is connected or capability is supported
                let available = if !self.backend.is_connected() {
                    false // Disconnected backend advertises zero capabilities
                } else {
                    match *cap {
                        "state:read" => true,
                        "config:read" => true,
                        "config:write" => true,
                        "runtime:control" => (backend_caps & 0x01) != 0 || backend_caps > 0,
                        "trace:read" => true,
                        "trace:write" => true,
                        _ => false,
                    }
                };

                if available {
                    granted.push(cap_str.clone());
                    self.session.negotiated_capabilities.insert(cap_str);
                }
            }
        }

        granted.sort();

        self.session.client_name = Some(client_name);
        self.session.client_version = Some(client_version);
        self.session.negotiated_major = PROTOCOL_MAJOR_VERSION;
        self.session.negotiated_minor = negotiated_minor;
        self.session.hello_completed = true;

        let hello_result = json!({
            "serverName": "tessera-daemon",
            "serverVersion": env!("CARGO_PKG_VERSION"),
            "negotiatedMajor": PROTOCOL_MAJOR_VERSION,
            "negotiatedMinor": negotiated_minor,
            "capabilities": granted,
            "maxFrameSize": crate::config::MAX_FRAME_SIZE,
            "limits": {
                "maxFrameSize": crate::config::MAX_FRAME_SIZE,
                "maxNestingDepth": crate::config::MAX_NESTING_DEPTH,
                "maxStringLength": crate::config::MAX_STRING_LENGTH,
                "maxArrayLength": crate::config::MAX_ARRAY_LENGTH,
                "maxOutstandingRequests": crate::config::MAX_OUTSTANDING_REQUESTS,
                "maxSubscriptionCount": crate::config::MAX_SUBSCRIPTION_COUNT
            }
        });

        self.create_success_response(req_id, req_id, hello_result)
    }

    fn handle_subscribe(&mut self, req_id: &str, params: &Value) -> Value {
        let events_val = params.get("events").or_else(|| params.get("channels"));

        let arr = match events_val.and_then(Value::as_array) {
            Some(a) => a,
            None => {
                return self.create_error_response(
                    req_id,
                    req_id,
                    create_protocol_error(
                        error_codes::INVALID_PAYLOAD,
                        "system.subscribe requires 'events' array",
                    ),
                );
            }
        };

        let mut events = Vec::new();
        for item in arr {
            if let Some(s) = item.as_str() {
                events.push(s.to_string());
            }
        }

        match self.session.subscribe(&events) {
            Ok(sub_list) => {
                self.create_success_response(req_id, req_id, json!({ "subscribed": sub_list }))
            }
            Err(err) => self.create_error_response(req_id, req_id, err),
        }
    }

    fn handle_unsubscribe(&mut self, req_id: &str, params: &Value) -> Value {
        let events_val = params.get("events").or_else(|| params.get("channels"));

        let arr = match events_val.and_then(Value::as_array) {
            Some(a) => a,
            None => {
                return self.create_error_response(
                    req_id,
                    req_id,
                    create_protocol_error(
                        error_codes::INVALID_PAYLOAD,
                        "system.unsubscribe requires 'events' array",
                    ),
                );
            }
        };

        let mut events = Vec::new();
        for item in arr {
            if let Some(s) = item.as_str() {
                events.push(s.to_string());
            }
        }

        let sub_list = self.session.unsubscribe(&events);
        self.create_success_response(req_id, req_id, json!({ "subscribed": sub_list }))
    }

    fn handle_command_with_idempotency<F>(
        &mut self,
        req_id: &str,
        method: &str,
        params: Value,
        enqueue_fn: F,
    ) -> Value
    where
        F: FnOnce(
            &Arc<dyn RuntimeBackend>,
            Value,
            Option<u64>,
        ) -> Result<CommandAck, ProtocolErrorData>,
    {
        let expected_rev = params.get("expectedRevision").and_then(Value::as_u64);
        let idempotency_key = params
            .get("idempotencyKey")
            .and_then(Value::as_str)
            .map(|s| s.to_string());

        // 1. Session-scoped idempotency check
        let payload_hash = compute_canonical_payload_hash(&params);
        if let Some(ref key) = idempotency_key {
            match self.session.check_idempotency(method, key, &payload_hash) {
                Ok(Some(cached_resp)) => return cached_resp,
                Ok(None) => {}
                Err(err) => return self.create_error_response(req_id, req_id, err),
            }
        }

        // 2. Enqueue command through backend
        match enqueue_fn(&self.backend, params, expected_rev) {
            Ok(ack) => {
                let result_val = serde_json::to_value(&ack).unwrap();
                let resp = self.create_success_response(req_id, req_id, result_val);

                // Cache successful acknowledgment under session's idempotency store
                if let Some(ref key) = idempotency_key {
                    self.session
                        .record_idempotency(method, key, payload_hash, resp.clone());
                }

                resp
            }
            Err(err) => self.create_error_response(req_id, req_id, err),
        }
    }

    fn get_required_capability(&self, method: &str) -> Option<&'static str> {
        match method {
            "state.getSnapshot" | "state.getDiagnostics" => Some("state:read"),
            "config.get" | "config.validatePatch" => Some("config:read"),
            "config.applyPatch" => Some("config:write"),
            "runtime.requestReconcile"
            | "runtime.setLayout"
            | "runtime.setMasterCount"
            | "runtime.setMasterRatio"
            | "runtime.setWindowFloating" => Some("runtime:control"),
            "trace.getRecent" => Some("trace:read"),
            "trace.clearRecent" => Some("trace:write"),
            _ => None,
        }
    }

    fn create_success_response(&self, id: &str, reply_to: &str, result: Value) -> Value {
        json!({
            "protocol": "tessera.ipc",
            "majorVersion": 1,
            "minorVersion": 0,
            "kind": "response",
            "id": id,
            "replyTo": reply_to,
            "ok": true,
            "result": result
        })
    }

    fn create_error_response(
        &mut self,
        id: &str,
        reply_to: &str,
        error: ProtocolErrorData,
    ) -> Value {
        // Safe internal error protection: mask unexpected INTERNAL_ERROR with generic correlation token
        let sanitized_error = if error.code == error_codes::INTERNAL_ERROR {
            let seq = self.correlation_seq;
            self.correlation_seq += 1;
            create_safe_internal_error(seq)
        } else {
            error
        };

        json!({
            "protocol": "tessera.ipc",
            "majorVersion": 1,
            "minorVersion": 0,
            "kind": "response",
            "id": id,
            "replyTo": reply_to,
            "ok": false,
            "error": {
                "code": sanitized_error.code,
                "message": sanitized_error.message,
                "details": sanitized_error.details
            }
        })
    }
}
