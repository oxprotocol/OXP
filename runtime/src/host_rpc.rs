//! Runtime → host JSON-RPC helper.
//!
//! Used by wasm host imports to call back into whichever IDE drove
//! `extension/load`. Wraps three concerns:
//!  1. allocate a numeric id from [`RuntimeState::next_id`]
//!  2. register a oneshot in `pending_callbacks` so the response handler
//!     in [`crate::dispatch::Dispatcher::handle_inbound_response`] can
//!     wake us
//!  3. push a properly-framed JSON-RPC request through the outbound
//!     channel
//!
//! Notifications are simpler — no id, no waiter, just enqueue.

use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::error::{OxpErrorCode, RpcError};
use crate::rpc::server::Outbound;
use crate::state::RuntimeState;

/// Default per-call deadline. Hosts that need longer (e.g. user input
/// dialogs) get their own timeout via [`HostRpc::request_with_timeout`].
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Cheap-to-clone handle that wasm host imports hold onto. Constructed
/// once per loaded extension in [`crate::wasm::spawn_worker`].
#[derive(Clone)]
pub struct HostRpc {
    outbound: mpsc::Sender<Outbound>,
    state: RuntimeState,
}

impl HostRpc {
    pub fn new(outbound: mpsc::Sender<Outbound>, state: RuntimeState) -> Self {
        Self { outbound, state }
    }

    /// Issue a JSON-RPC request to the host and await its response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.request_with_timeout(method, params, DEFAULT_TIMEOUT).await
    }

    pub async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, RpcError> {
        let (id, rx) = self.allocate().await;

        let frame = json!({
            "jsonrpc": "2.0",
            "id":      id,
            "method":  method,
            "params":  params,
        });
        if self.outbound.send(Outbound::Json(frame)).await.is_err() {
            // Channel closed → host is gone; clean up pending entry.
            self.state.with(|s| { s.pending_callbacks.remove(&id); }).await;
            return Err(RpcError::oxp(
                OxpErrorCode::HostTimeout,
                format!("host channel closed during {method}"),
            ));
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(Ok(value)))  => Ok(value),
            Ok(Ok(Err(err)))   => Err(err),
            Ok(Err(_canceled)) => Err(RpcError::oxp(
                OxpErrorCode::HostTimeout,
                format!("host dropped response for {method}"),
            )),
            Err(_elapsed) => {
                self.state.with(|s| { s.pending_callbacks.remove(&id); }).await;
                Err(RpcError::oxp(
                    OxpErrorCode::HostTimeout,
                    format!("host did not respond to {method} within {:?}", timeout),
                ))
            }
        }
    }

    /// Fire-and-forget. Failures are logged but never returned — by
    /// definition we don't expect a reply.
    pub async fn notify(&self, method: &str, params: Value) {
        let frame = json!({
            "jsonrpc": "2.0",
            "method":  method,
            "params":  params,
        });
        if let Err(e) = self.outbound.send(Outbound::Json(frame)).await {
            tracing::warn!(method, error = %e, "failed to enqueue host notification");
        }
    }

    async fn allocate(
        &self,
    ) -> (u64, oneshot::Receiver<Result<Value, RpcError>>) {
        let (tx, rx) = oneshot::channel();
        let id = self
            .state
            .with(|s| {
                let id = s.next_id();
                s.pending_callbacks.insert(id, tx);
                id
            })
            .await;
        (id, rx)
    }
}
