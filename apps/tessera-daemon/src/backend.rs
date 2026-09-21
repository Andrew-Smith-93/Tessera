use crate::protocol::{error_codes, ProtocolErrorData};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandAck {
    pub acknowledged: bool,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "stateRevision")]
    pub state_revision: u64,
}

#[derive(Debug, Clone)]
pub struct QueuedBackendCommand {
    pub id: String,
    pub method: String,
    pub params: Value,
    pub expected_revision: Option<u64>,
}

pub trait RuntimeBackend: Send + Sync {
    fn is_connected(&self) -> bool;
    fn adapter_capabilities(&self) -> u64;
    fn get_snapshot(&self, redact: bool) -> Result<Value, ProtocolErrorData>;
    fn get_diagnostics(&self, redact: bool) -> Result<Value, ProtocolErrorData>;
    fn validate_config_patch(&self, patch: &Value) -> Result<(), ProtocolErrorData>;
    fn enqueue_config_patch(
        &self,
        patch: Value,
        expected_rev: Option<u64>,
    ) -> Result<CommandAck, ProtocolErrorData>;
    fn enqueue_runtime_command(
        &self,
        method: &str,
        params: Value,
        expected_rev: Option<u64>,
    ) -> Result<CommandAck, ProtocolErrorData>;
    fn get_recent_trace(
        &self,
        limit: Option<usize>,
        redact: bool,
    ) -> Result<Value, ProtocolErrorData>;
    fn clear_recent_trace(&self) -> Result<(), ProtocolErrorData>;
    fn advance_command_queue(&self) -> usize;
}

/// DisconnectedBackend is used for standard daemon bootstrap when no live KWin instance is connected.
/// It advertises 0 capabilities and never pretends to control KWin.
pub struct DisconnectedBackend;

impl RuntimeBackend for DisconnectedBackend {
    fn is_connected(&self) -> bool {
        false
    }

    fn adapter_capabilities(&self) -> u64 {
        0
    }

    fn get_snapshot(&self, _redact: bool) -> Result<Value, ProtocolErrorData> {
        Err(ProtocolErrorData {
            code: error_codes::CAPABILITY_NOT_NEGOTIATED.to_string(),
            message: "Runtime target is not connected to a live KWin session".to_string(),
            details: None,
        })
    }

    fn get_diagnostics(&self, _redact: bool) -> Result<Value, ProtocolErrorData> {
        Err(ProtocolErrorData {
            code: error_codes::CAPABILITY_NOT_NEGOTIATED.to_string(),
            message: "Runtime target is not connected to a live KWin session".to_string(),
            details: None,
        })
    }

    fn validate_config_patch(&self, _patch: &Value) -> Result<(), ProtocolErrorData> {
        Err(ProtocolErrorData {
            code: error_codes::CAPABILITY_NOT_NEGOTIATED.to_string(),
            message: "Configuration validation requires an active runtime target".to_string(),
            details: None,
        })
    }

    fn enqueue_config_patch(
        &self,
        _patch: Value,
        _expected_rev: Option<u64>,
    ) -> Result<CommandAck, ProtocolErrorData> {
        Err(ProtocolErrorData {
            code: error_codes::CAPABILITY_NOT_NEGOTIATED.to_string(),
            message: "Configuration modification requires an active runtime target".to_string(),
            details: None,
        })
    }

    fn enqueue_runtime_command(
        &self,
        method: &str,
        _params: Value,
        _expected_rev: Option<u64>,
    ) -> Result<CommandAck, ProtocolErrorData> {
        Err(ProtocolErrorData {
            code: error_codes::CAPABILITY_NOT_NEGOTIATED.to_string(),
            message: format!(
                "Runtime command '{}' requires an active runtime target",
                method
            ),
            details: None,
        })
    }

    fn get_recent_trace(
        &self,
        _limit: Option<usize>,
        _redact: bool,
    ) -> Result<Value, ProtocolErrorData> {
        Err(ProtocolErrorData {
            code: error_codes::TRACE_DISABLED.to_string(),
            message: "Runtime trace recorder is inactive in disconnected mode".to_string(),
            details: None,
        })
    }

    fn clear_recent_trace(&self) -> Result<(), ProtocolErrorData> {
        Err(ProtocolErrorData {
            code: error_codes::TRACE_DISABLED.to_string(),
            message: "Runtime trace recorder is inactive in disconnected mode".to_string(),
            details: None,
        })
    }

    fn advance_command_queue(&self) -> usize {
        0
    }
}

/// InMemoryTestBackend is a deterministic in-memory simulator for protocol and queue testing.
pub struct InMemoryTestBackend {
    revision: AtomicU64,
    command_seq: AtomicU64,
    capabilities: u64,
    screens: RwLock<Vec<Value>>,
    windows: RwLock<Vec<Value>>,
    config: RwLock<Value>,
    queue: RwLock<VecDeque<QueuedBackendCommand>>,
}

impl InMemoryTestBackend {
    pub fn new(capabilities: u64) -> Self {
        let screens = vec![json!({
            "id": "HDMI-A-1",
            "name": "HDMI-A-1",
            "geometry": { "x": 0, "y": 0, "width": 1920, "height": 1080 }
        })];
        let windows = vec![json!({
            "id": "win-1",
            "title": "Secret App Window Title",
            "resourceClass": "SecretClass",
            "resourceName": "SecretName",
            "appId": "secret.app.id",
            "desktopFileName": "secret.app.desktop",
            "role": "main-window",
            "outputId": "HDMI-A-1",
            "classification": "tiled",
            "tileable": true,
            "minimized": false,
            "fullScreen": false,
            "noBorder": false,
            "maximizeMode": 0,
            "isManualFloating": false,
            "frameGeometry": { "x": 10, "y": 10, "width": 940, "height": 1060 },
            "desiredGeometry": { "x": 10, "y": 10, "width": 940, "height": 1060 },
            "preMinimizeGeometry": null,
            "outputAffinity": "HDMI-A-1"
        })];
        let config = json!({
            "enableTiling": true,
            "defaultLayout": "master-stack",
            "gapInner": 8,
            "gapOuter": 12,
            "masterRatio": 0.55,
            "masterCount": 1,
            "redactIdentities": false,
            "gameWindowPolicy": "floating"
        });

        InMemoryTestBackend {
            revision: AtomicU64::new(1),
            command_seq: AtomicU64::new(1),
            capabilities,
            screens: RwLock::new(screens),
            windows: RwLock::new(windows),
            config: RwLock::new(config),
            queue: RwLock::new(VecDeque::new()),
        }
    }

    pub fn set_screens(&self, screens: Vec<Value>) {
        *self.screens.write().unwrap() = screens;
    }

    pub fn set_windows(&self, windows: Vec<Value>) {
        *self.windows.write().unwrap() = windows;
    }

    pub fn pending_count(&self) -> usize {
        self.queue.read().unwrap().len()
    }
}

impl RuntimeBackend for InMemoryTestBackend {
    fn is_connected(&self) -> bool {
        true
    }

    fn adapter_capabilities(&self) -> u64 {
        self.capabilities
    }

    fn get_snapshot(&self, _redact: bool) -> Result<Value, ProtocolErrorData> {
        let rev = self.revision.load(Ordering::SeqCst);
        let screens = self.screens.read().unwrap().clone();
        let windows = self.windows.read().unwrap().clone();
        let config = self.config.read().unwrap().clone();

        Ok(json!({
            "revision": rev,
            "screens": screens,
            "windows": windows,
            "config": config,
            "diagnostics": { "invariantsSatisfied": true }
        }))
    }

    fn get_diagnostics(&self, _redact: bool) -> Result<Value, ProtocolErrorData> {
        Ok(json!({
            "diagnostics": {
                "invariantsSatisfied": true,
                "retainedScreensCount": self.screens.read().unwrap().len(),
                "retainedWindowsCount": self.windows.read().unwrap().len()
            }
        }))
    }

    fn validate_config_patch(&self, patch: &Value) -> Result<(), ProtocolErrorData> {
        let map = patch.as_object().ok_or_else(|| ProtocolErrorData {
            code: error_codes::CONFIG_VALIDATION_FAILED.to_string(),
            message: "Config patch must be a JSON object".to_string(),
            details: None,
        })?;

        for (k, v) in map {
            match k.as_str() {
                "enableTiling" | "redactIdentities" => {
                    if !v.is_boolean() {
                        return Err(ProtocolErrorData {
                            code: error_codes::CONFIG_VALIDATION_FAILED.to_string(),
                            message: format!("Config key '{}' must be a boolean", k),
                            details: None,
                        });
                    }
                }
                "defaultLayout" | "gameWindowPolicy" => {
                    if !v.is_string() {
                        return Err(ProtocolErrorData {
                            code: error_codes::CONFIG_VALIDATION_FAILED.to_string(),
                            message: format!("Config key '{}' must be a string", k),
                            details: None,
                        });
                    }
                }
                "gapInner" | "gapOuter" => match v.as_i64() {
                    Some(n) if n >= 0 => {}
                    _ => {
                        return Err(ProtocolErrorData {
                            code: error_codes::CONFIG_VALIDATION_FAILED.to_string(),
                            message: format!("Config key '{}' must be an integer >= 0", k),
                            details: None,
                        });
                    }
                },
                "masterCount" => match v.as_i64() {
                    Some(n) if n >= 1 => {}
                    _ => {
                        return Err(ProtocolErrorData {
                            code: error_codes::CONFIG_VALIDATION_FAILED.to_string(),
                            message: format!("Config key '{}' must be an integer >= 1", k),
                            details: None,
                        });
                    }
                },
                "masterRatio" => match v.as_f64() {
                    Some(r) if (0.05..=0.95).contains(&r) => {}
                    _ => {
                        return Err(ProtocolErrorData {
                            code: error_codes::CONFIG_VALIDATION_FAILED.to_string(),
                            message: format!(
                                "Config key '{}' must be a number between 0.05 and 0.95",
                                k
                            ),
                            details: None,
                        });
                    }
                },
                _ => {
                    return Err(ProtocolErrorData {
                        code: error_codes::CONFIG_VALIDATION_FAILED.to_string(),
                        message: format!("Unknown config key in patch: '{}'", k),
                        details: None,
                    });
                }
            }
        }

        Ok(())
    }

    fn enqueue_config_patch(
        &self,
        patch: Value,
        expected_rev: Option<u64>,
    ) -> Result<CommandAck, ProtocolErrorData> {
        self.validate_config_patch(&patch)?;

        let cur_rev = self.revision.load(Ordering::SeqCst);
        if let Some(exp) = expected_rev {
            if exp != cur_rev {
                return Err(ProtocolErrorData {
                    code: error_codes::REVISION_CONFLICT.to_string(),
                    message: format!(
                        "Expected revision {} but current revision is {}",
                        exp, cur_rev
                    ),
                    details: None,
                });
            }
        }

        let cmd_id = format!("cmd_{:06}", self.command_seq.fetch_add(1, Ordering::SeqCst));
        let next_rev = cur_rev + 1;

        let mut q = self.queue.write().unwrap();
        q.push_back(QueuedBackendCommand {
            id: cmd_id.clone(),
            method: "config.applyPatch".to_string(),
            params: patch,
            expected_revision: expected_rev,
        });

        Ok(CommandAck {
            acknowledged: true,
            command_id: cmd_id,
            state_revision: next_rev,
        })
    }

    fn enqueue_runtime_command(
        &self,
        method: &str,
        params: Value,
        expected_rev: Option<u64>,
    ) -> Result<CommandAck, ProtocolErrorData> {
        let cur_rev = self.revision.load(Ordering::SeqCst);
        if let Some(exp) = expected_rev {
            if exp != cur_rev {
                return Err(ProtocolErrorData {
                    code: error_codes::REVISION_CONFLICT.to_string(),
                    message: format!(
                        "Expected revision {} but current revision is {}",
                        exp, cur_rev
                    ),
                    details: None,
                });
            }
        }

        // Target validation
        if let Some(obj) = params.as_object() {
            if let Some(out_val) = obj.get("outputId").and_then(Value::as_str) {
                let screens = self.screens.read().unwrap();
                let found = screens.iter().any(|s| {
                    s.get("id").and_then(Value::as_str) == Some(out_val)
                        || s.get("name").and_then(Value::as_str) == Some(out_val)
                });
                if !found {
                    return Err(ProtocolErrorData {
                        code: error_codes::OUTPUT_NOT_FOUND.to_string(),
                        message: format!("Target output '{}' not found", out_val),
                        details: None,
                    });
                }
            }

            if let Some(win_val) = obj.get("windowId").and_then(Value::as_str) {
                let windows = self.windows.read().unwrap();
                let found = windows
                    .iter()
                    .any(|w| w.get("id").and_then(Value::as_str) == Some(win_val));
                if !found {
                    return Err(ProtocolErrorData {
                        code: error_codes::WINDOW_NOT_FOUND.to_string(),
                        message: format!("Target window '{}' not found", win_val),
                        details: None,
                    });
                }
            }
        }

        let cmd_id = format!("cmd_{:06}", self.command_seq.fetch_add(1, Ordering::SeqCst));
        let next_rev = cur_rev + 1;

        let mut q = self.queue.write().unwrap();
        q.push_back(QueuedBackendCommand {
            id: cmd_id.clone(),
            method: method.to_string(),
            params,
            expected_revision: expected_rev,
        });

        Ok(CommandAck {
            acknowledged: true,
            command_id: cmd_id,
            state_revision: next_rev,
        })
    }

    fn get_recent_trace(
        &self,
        _limit: Option<usize>,
        _redact: bool,
    ) -> Result<Value, ProtocolErrorData> {
        Ok(json!({
            "entries": []
        }))
    }

    fn clear_recent_trace(&self) -> Result<(), ProtocolErrorData> {
        Ok(())
    }

    fn advance_command_queue(&self) -> usize {
        let mut q = self.queue.write().unwrap();
        let count = q.len();
        if count > 0 {
            q.clear();
            self.revision.fetch_add(count as u64, Ordering::SeqCst);
        }
        count
    }
}
