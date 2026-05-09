//! Stream multiplex (spec §5.6).
//!
//! Phase-1 stub: accepts `stream/{open,data,close}` notifications and
//! discards them. Phase 2 wires these into wasm `stream` resources.

use serde_json::Value;
use crate::error::RpcError;
use crate::state::RuntimeState;

pub async fn handle_inbound(_state: &RuntimeState, method: &str, params: Value) -> Result<(), RpcError> {
    tracing::debug!(method, ?params, "stream notification received (stub)");
    Ok(())
}
