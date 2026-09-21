use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const KNOWN_METHODS: &[&str] = &[
    "system.hello",
    "system.subscribe",
    "system.unsubscribe",
    "state.getSnapshot",
    "state.getDiagnostics",
    "state.getCapabilities",
    "config.get",
    "config.validatePatch",
    "config.applyPatch",
    "runtime.requestReconcile",
    "runtime.setLayout",
    "runtime.setMasterCount",
    "runtime.setMasterRatio",
    "runtime.setWindowFloating",
    "runtime.getVersion",
    "trace.getRecent",
    "trace.clearRecent",
];

pub const KNOWN_EVENTS: &[&str] = &[
    "runtime.ready",
    "runtime.stateChanged",
    "runtime.transactionCommitted",
    "runtime.configurationChanged",
    "runtime.capabilitiesChanged",
    "runtime.warning",
];

pub const V1_CAPABILITIES: &[&str] = &[
    "state:read",
    "config:read",
    "config:write",
    "runtime:control",
    "trace:read",
    "trace:write",
];

pub mod error_codes {
    pub const INVALID_ENVELOPE: &str = "INVALID_ENVELOPE";
    pub const INVALID_PAYLOAD: &str = "INVALID_PAYLOAD";
    pub const UNKNOWN_METHOD: &str = "UNKNOWN_METHOD";
    pub const UNKNOWN_EVENT: &str = "UNKNOWN_EVENT";
    pub const UNSUPPORTED_MAJOR_VERSION: &str = "UNSUPPORTED_MAJOR_VERSION";
    pub const UNSUPPORTED_MINOR_VERSION: &str = "UNSUPPORTED_MINOR_VERSION";
    pub const CAPABILITY_NOT_NEGOTIATED: &str = "CAPABILITY_NOT_NEGOTIATED";
    pub const CONFIG_VALIDATION_FAILED: &str = "CONFIG_VALIDATION_FAILED";
    pub const REVISION_CONFLICT: &str = "REVISION_CONFLICT";
    pub const IDEMPOTENCY_CONFLICT: &str = "IDEMPOTENCY_CONFLICT";
    pub const RESOURCE_LIMIT_EXCEEDED: &str = "RESOURCE_LIMIT_EXCEEDED";
    pub const WINDOW_NOT_FOUND: &str = "WINDOW_NOT_FOUND";
    pub const OUTPUT_NOT_FOUND: &str = "OUTPUT_NOT_FOUND";
    pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
    pub const INVALID_JSON: &str = "INVALID_JSON";
    pub const DECODE_ERROR: &str = "DECODE_ERROR";
    pub const TRACE_DISABLED: &str = "TRACE_DISABLED";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolErrorData {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolRequest {
    pub protocol: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
    #[serde(rename = "minorVersion")]
    pub minor_version: u32,
    pub kind: String, // "request"
    pub id: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolSuccessResponse {
    pub protocol: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
    #[serde(rename = "minorVersion")]
    pub minor_version: u32,
    pub kind: String, // "response"
    pub id: String,
    #[serde(rename = "replyTo")]
    pub reply_to: String,
    pub ok: bool, // true
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolErrorResponse {
    pub protocol: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
    #[serde(rename = "minorVersion")]
    pub minor_version: u32,
    pub kind: String, // "response"
    pub id: String,
    #[serde(rename = "replyTo")]
    pub reply_to: String,
    pub ok: bool, // false
    pub error: ProtocolErrorData,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolEvent {
    pub protocol: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
    #[serde(rename = "minorVersion")]
    pub minor_version: u32,
    pub kind: String, // "event"
    pub id: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

pub fn create_protocol_error(code: &str, message: &str) -> ProtocolErrorData {
    ProtocolErrorData {
        code: code.to_string(),
        message: message.to_string(),
        details: None,
    }
}

pub fn create_safe_internal_error(correlation_seq: u64) -> ProtocolErrorData {
    let mut details = Map::new();
    details.insert(
        "correlationId".to_string(),
        Value::String(format!("err_{:08x}", correlation_seq)),
    );
    ProtocolErrorData {
        code: error_codes::INTERNAL_ERROR.to_string(),
        message: "An internal server error occurred while processing the request".to_string(),
        details: Some(Value::Object(details)),
    }
}

pub fn sanitize_outbound_payload(val: &mut Value, redact: bool) {
    if !redact {
        return;
    }
    match val {
        Value::Object(map) => {
            // Remove title
            map.remove("title");

            // Redact protected identity fields
            let protected = [
                "resourceClass",
                "resourceName",
                "appId",
                "desktopFileName",
                "role",
            ];
            for field in protected {
                if let Some(entry) = map.get_mut(field) {
                    if entry.is_string() {
                        *entry = Value::String("[REDACTED]".to_string());
                    }
                }
            }

            // Recurse into remaining children
            for (_, v) in map.iter_mut() {
                sanitize_outbound_payload(v, redact);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                sanitize_outbound_payload(v, redact);
            }
        }
        _ => {}
    }
}

pub fn compute_canonical_payload_hash(params: &Value) -> String {
    let normalized = match params {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted_map = Map::new();
            for k in keys {
                sorted_map.insert(k.clone(), map[k].clone());
            }
            Value::Object(sorted_map)
        }
        other => other.clone(),
    };

    let serialized = serde_json::to_string(&normalized).unwrap_or_default();

    // 32-bit FNV-1a hash matching TypeScript implementation exactly
    let mut h1: u32 = 0x811c9dc5;
    for b in serialized.as_bytes() {
        h1 ^= *b as u32;
        h1 = h1.wrapping_mul(0x01000193);
    }

    format!("{:08x}", h1)
}
