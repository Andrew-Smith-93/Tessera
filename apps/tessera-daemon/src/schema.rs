use crate::config::{
    MAX_ARRAY_LENGTH, MAX_NESTING_DEPTH, MAX_STRING_LENGTH, PROTOCOL_MAJOR_VERSION,
    PROTOCOL_MINOR_VERSION, PROTOCOL_NAMESPACE,
};
use crate::protocol::{error_codes, KNOWN_METHODS};
use jsonschema::Validator;
use serde_json::Value;

pub const ENVELOPE_SCHEMA_RAW: &str =
    include_str!("../../../packages/protocol/src/schemas/envelope.schema.json");
pub const REQUEST_SCHEMA_RAW: &str =
    include_str!("../../../packages/protocol/src/schemas/request.schema.json");
pub const RESPONSE_SCHEMA_RAW: &str =
    include_str!("../../../packages/protocol/src/schemas/response.schema.json");
pub const EVENT_SCHEMA_RAW: &str =
    include_str!("../../../packages/protocol/src/schemas/event.schema.json");
pub const ERROR_SCHEMA_RAW: &str =
    include_str!("../../../packages/protocol/src/schemas/error.schema.json");

pub struct CompiledSchemas {
    pub envelope_validator: Validator,
}

impl CompiledSchemas {
    pub fn compile() -> Result<Self, String> {
        let envelope_val: Value = serde_json::from_str(ENVELOPE_SCHEMA_RAW)
            .map_err(|e| format!("Failed to parse canonical envelope schema JSON: {}", e))?;

        let envelope_validator = jsonschema::validator_for(&envelope_val)
            .map_err(|e| format!("Failed to compile canonical envelope JSON schema: {}", e))?;

        Ok(CompiledSchemas { envelope_validator })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ValidationError {}

pub fn validate_envelope(val: &Value, schemas: &CompiledSchemas) -> Result<(), ValidationError> {
    let map = val.as_object().ok_or_else(|| ValidationError {
        code: error_codes::INVALID_ENVELOPE,
        message: "Message envelope must be a non-null JSON object".to_string(),
    })?;

    // 1. Recursive resource limit validation
    validate_resource_limits(val, 0)?;

    // 2. Base envelope field checks matching Protocol V1 semantics
    let protocol = map.get("protocol").and_then(Value::as_str);
    if protocol != Some(PROTOCOL_NAMESPACE) {
        return Err(ValidationError {
            code: error_codes::INVALID_ENVELOPE,
            message: format!(
                "Invalid or missing 'protocol' namespace (expected '{}', got {:?})",
                PROTOCOL_NAMESPACE, protocol
            ),
        });
    }

    let major_version = map.get("majorVersion").and_then(Value::as_u64);
    match major_version {
        Some(v) if v == PROTOCOL_MAJOR_VERSION as u64 => {}
        Some(v) => {
            return Err(ValidationError {
                code: error_codes::UNSUPPORTED_MAJOR_VERSION,
                message: format!(
                    "Unsupported major version: {} (server supports {})",
                    v, PROTOCOL_MAJOR_VERSION
                ),
            });
        }
        None => {
            return Err(ValidationError {
                code: error_codes::INVALID_ENVELOPE,
                message: "Missing or non-integer 'majorVersion'".to_string(),
            });
        }
    }

    let minor_version = map.get("minorVersion").and_then(Value::as_u64);
    match minor_version {
        Some(v) if v <= PROTOCOL_MINOR_VERSION as u64 => {}
        Some(v) => {
            return Err(ValidationError {
                code: error_codes::UNSUPPORTED_MINOR_VERSION,
                message: format!(
                    "Unsupported minor version: {} (server supports up to {})",
                    v, PROTOCOL_MINOR_VERSION
                ),
            });
        }
        None => {
            return Err(ValidationError {
                code: error_codes::INVALID_ENVELOPE,
                message: "Missing or non-integer 'minorVersion'".to_string(),
            });
        }
    }

    let id = map.get("id").and_then(Value::as_str);
    if id.is_none() || id.unwrap().trim().is_empty() {
        return Err(ValidationError {
            code: error_codes::INVALID_ENVELOPE,
            message: "Missing or empty string 'id'".to_string(),
        });
    }

    let kind = map.get("kind").and_then(Value::as_str);
    if kind != Some("request") && kind != Some("response") && kind != Some("event") {
        return Err(ValidationError {
            code: error_codes::INVALID_ENVELOPE,
            message: format!("Invalid message kind: {:?}", kind),
        });
    }

    // 3. Method validation for request kind
    if kind == Some("request") {
        let method = map.get("method").and_then(Value::as_str);
        match method {
            Some(m) if KNOWN_METHODS.contains(&m) => {}
            Some(m) => {
                return Err(ValidationError {
                    code: error_codes::UNKNOWN_METHOD,
                    message: format!("Unknown method: '{}'", m),
                });
            }
            None => {
                return Err(ValidationError {
                    code: error_codes::INVALID_ENVELOPE,
                    message: "Request envelope missing 'method'".to_string(),
                });
            }
        }
    }

    // 4. Validate against compiled canonical schema
    let errors: Vec<_> = schemas.envelope_validator.iter_errors(val).collect();
    if !errors.is_empty() {
        let error_msgs: Vec<String> = errors.iter().map(|e| e.to_string()).collect();
        return Err(ValidationError {
            code: error_codes::INVALID_ENVELOPE,
            message: format!("Schema validation failed: {}", error_msgs.join("; ")),
        });
    }

    Ok(())
}

fn validate_resource_limits(val: &Value, depth: usize) -> Result<(), ValidationError> {
    if depth > MAX_NESTING_DEPTH {
        return Err(ValidationError {
            code: error_codes::RESOURCE_LIMIT_EXCEEDED,
            message: format!(
                "Payload exceeds maximum allowable nesting depth of {}",
                MAX_NESTING_DEPTH
            ),
        });
    }

    match val {
        Value::String(s) => {
            if s.len() > MAX_STRING_LENGTH {
                return Err(ValidationError {
                    code: error_codes::RESOURCE_LIMIT_EXCEEDED,
                    message: format!(
                        "String length of {} characters exceeds maximum limit of {}",
                        s.len(),
                        MAX_STRING_LENGTH
                    ),
                });
            }
        }
        Value::Array(arr) => {
            if arr.len() > MAX_ARRAY_LENGTH {
                return Err(ValidationError {
                    code: error_codes::RESOURCE_LIMIT_EXCEEDED,
                    message: format!(
                        "Array length of {} items exceeds maximum limit of {}",
                        arr.len(),
                        MAX_ARRAY_LENGTH
                    ),
                });
            }
            for item in arr {
                validate_resource_limits(item, depth + 1)?;
            }
        }
        Value::Object(map) => {
            for (_, v) in map {
                validate_resource_limits(v, depth + 1)?;
            }
        }
        _ => {}
    }

    Ok(())
}
