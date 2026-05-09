//! Method dispatch — routes incoming JSON-RPC requests/notifications to
//! the appropriate subsystem (lifecycle, extension, surfaces, streams).
//!
//! Method names are exactly as in `spec/v1/host-runtime-rpc.md` §5.

use serde_json::Value;
use tokio::sync::mpsc;

use crate::error::{OxpErrorCode, RpcError};
use crate::lifecycle;
use crate::extension;
use crate::rpc::{Notification, Request};
use crate::rpc::server::Outbound;
use crate::state::RuntimeState;

#[derive(Clone)]
pub struct Dispatcher {
    pub state: RuntimeState,
    pub outbound: mpsc::Sender<Outbound>,
}

impl Dispatcher {
    pub fn new(state: RuntimeState, outbound: mpsc::Sender<Outbound>) -> Self {
        Self { state, outbound }
    }

    pub fn should_exit(&self) -> bool {
        // Cheap, non-blocking poll — reader loop checks after every frame.
        self.state.try_with(|s| s.exit_requested).unwrap_or(false)
    }

    pub async fn handle_request(&self, req: &Request) -> Result<Value, RpcError> {
        let params = req.params.clone().unwrap_or(Value::Null);
        match req.method.as_str() {
            // ---- Lifecycle ----
            "initialize"           => lifecycle::handle_initialize(&self.state, params).await,
            "shutdown"             => lifecycle::handle_shutdown(&self.state).await,

            // ---- Extension ----
            "extension/load"       => extension::handle_load(&self.state, self.outbound.clone(), params).await,
            "extension/activate"   => extension::handle_activate(&self.state, params).await,
            "extension/command"    => extension::handle_command(&self.state, params).await,
            "extension/deactivate" => extension::handle_deactivate(&self.state, params).await,

            // ---- Permission grants are notifications, not requests ----
            other => Err(RpcError::method_not_found(other)),
        }
    }

    pub async fn handle_notification(&self, note: &Notification) -> Result<(), RpcError> {
        let params = note.params.clone().unwrap_or(Value::Null);
        match note.method.as_str() {
            "exit"                  => lifecycle::handle_exit(&self.state).await,
            "extension/event"       => extension::handle_event(&self.state, params).await,
            "extension/unload"      => extension::handle_unload(&self.state, params).await,
            "extension/reload"      => extension::handle_reload(&self.state, params).await,
            "host/grantPermission"  => crate::permissions::handle_grant(&self.state, params).await,
            "stream/open"
            | "stream/data"
            | "stream/close"        => crate::streams::handle_inbound(&self.state, &note.method, params).await,
            "surface/ack"           => crate::surfaces::handle_ack(&self.state, params).await,
            other => {
                tracing::debug!(method = other, "ignoring unknown notification");
                Ok(())
            }
        }
    }

    pub async fn handle_inbound_response(&self, resp: crate::rpc::Response) {
        // Responses to runtime-initiated requests carry a numeric id we issued.
        let id = match resp.id.as_u64() {
            Some(n) => n,
            None => {
                tracing::warn!(?resp.id, "inbound response with non-numeric id ignored");
                return;
            }
        };
        let waker = self
            .state
            .with(|s| s.pending_callbacks.remove(&id))
            .await;
        match waker {
            Some(tx) => {
                let payload = match (resp.result, resp.error) {
                    (Some(v), None) => Ok(v),
                    (None, Some(e)) => Err(e),
                    _ => Err(RpcError::oxp(
                        OxpErrorCode::HostTimeout,
                        "host returned malformed response",
                    )),
                };
                let _ = tx.send(payload);
            }
            None => tracing::warn!(id, "no pending callback matched inbound response"),
        }
    }
}


