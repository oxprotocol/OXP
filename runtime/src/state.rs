//! Shared runtime state: host info, loaded extensions, in-flight callbacks.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};

use crate::extension::Instance;
use crate::lifecycle::HostHandshake;

#[derive(Clone)]
pub struct RuntimeState {
    inner: Arc<Mutex<Inner>>,
}

pub struct Inner {
    pub handshake: Option<HostHandshake>,
    pub instances: HashMap<String, Instance>,
    pub exit_requested: bool,
    pub shutdown_requested: bool,
    pub next_callback_id: u64,
    pub pending_callbacks: HashMap<u64, oneshot::Sender<Result<serde_json::Value, crate::error::RpcError>>>,
}

impl RuntimeState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                handshake: None,
                instances: HashMap::new(),
                exit_requested: false,
                shutdown_requested: false,
                next_callback_id: 1,
                pending_callbacks: HashMap::new(),
            })),
        }
    }

    pub async fn with<R>(&self, f: impl FnOnce(&mut Inner) -> R) -> R {
        let mut g = self.inner.lock().await;
        f(&mut g)
    }

    /// Non-blocking peek used by the reader loop to check `exit_requested`
    /// between frames. Returns `None` if the state lock is contended.
    pub fn try_with<R>(&self, f: impl FnOnce(&mut Inner) -> R) -> Option<R> {
        let mut g = self.inner.try_lock().ok()?;
        Some(f(&mut g))
    }
}

impl Inner {
    pub fn next_id(&mut self) -> u64 {
        let id = self.next_callback_id;
        self.next_callback_id = self.next_callback_id.wrapping_add(1).max(1);
        id
    }
}
