use crate::config::{MAX_IDEMPOTENCY_CACHE_SIZE, MAX_SUBSCRIPTION_COUNT};
use crate::protocol::{error_codes, ProtocolErrorData};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug)]
pub struct SessionState {
    pub session_id: u64,
    pub client_name: Option<String>,
    pub client_version: Option<String>,
    pub hello_completed: bool,
    pub negotiated_major: u32,
    pub negotiated_minor: u32,
    pub negotiated_capabilities: HashSet<String>,
    pub subscriptions: HashSet<String>,
    pub outstanding_requests: usize,
    /// Bounded session-scoped idempotency store: "method::idempotency_key" -> (payload_hash, cached_response)
    idempotency_store: HashMap<String, (String, Value)>,
    idempotency_order: VecDeque<String>,
}

impl SessionState {
    pub fn new(session_id: u64) -> Self {
        SessionState {
            session_id,
            client_name: None,
            client_version: None,
            hello_completed: false,
            negotiated_major: 0,
            negotiated_minor: 0,
            negotiated_capabilities: HashSet::new(),
            subscriptions: HashSet::new(),
            outstanding_requests: 0,
            idempotency_store: HashMap::new(),
            idempotency_order: VecDeque::new(),
        }
    }

    pub fn subscribe(&mut self, events: &[String]) -> Result<Vec<String>, ProtocolErrorData> {
        if self.subscriptions.len() + events.len() > MAX_SUBSCRIPTION_COUNT {
            return Err(ProtocolErrorData {
                code: error_codes::RESOURCE_LIMIT_EXCEEDED.to_string(),
                message: format!(
                    "Session exceeded maximum subscription limit of {}",
                    MAX_SUBSCRIPTION_COUNT
                ),
                details: None,
            });
        }

        for ev in events {
            self.subscriptions.insert(ev.clone());
        }

        let mut list: Vec<String> = self.subscriptions.iter().cloned().collect();
        list.sort();
        Ok(list)
    }

    pub fn unsubscribe(&mut self, events: &[String]) -> Vec<String> {
        for ev in events {
            self.subscriptions.remove(ev);
        }
        let mut list: Vec<String> = self.subscriptions.iter().cloned().collect();
        list.sort();
        list
    }

    pub fn check_idempotency(
        &self,
        method: &str,
        idempotency_key: &str,
        payload_hash: &str,
    ) -> Result<Option<Value>, ProtocolErrorData> {
        let store_key = format!("{}::{}", method, idempotency_key);
        if let Some((stored_hash, cached_resp)) = self.idempotency_store.get(&store_key) {
            if stored_hash == payload_hash {
                return Ok(Some(cached_resp.clone()));
            } else {
                return Err(ProtocolErrorData {
                    code: error_codes::IDEMPOTENCY_CONFLICT.to_string(),
                    message: format!(
                        "Idempotency key '{}' already reused with conflicting command payload",
                        idempotency_key
                    ),
                    details: None,
                });
            }
        }
        Ok(None)
    }

    pub fn record_idempotency(
        &mut self,
        method: &str,
        idempotency_key: &str,
        payload_hash: String,
        response: Value,
    ) {
        let store_key = format!("{}::{}", method, idempotency_key);
        if self.idempotency_store.len() >= MAX_IDEMPOTENCY_CACHE_SIZE {
            if let Some(oldest) = self.idempotency_order.pop_front() {
                self.idempotency_store.remove(&oldest);
            }
        }

        self.idempotency_store
            .insert(store_key.clone(), (payload_hash, response));
        self.idempotency_order.push_back(store_key);
    }
}
