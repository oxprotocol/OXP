//! Surface registration tracker (spec §6.4).
//!
//! Phase-1 stub: records `surface/ack` arrivals so phase-2 wasm code can
//! await them. Real surface lifecycle ships in phase 2.

use serde_json::Value;
use crate::error::RpcError;
use crate::state::RuntimeState;

pub async fn handle_ack(_state: &RuntimeState, params: Value) -> Result<(), RpcError> {
    tracing::debug!(?params, "surface/ack received (stub)");
    Ok(())
}
