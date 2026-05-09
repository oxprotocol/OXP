//! Permission scope handling.
//!
//! Spec §5.9 (`host/grantPermission`), §6.2 (gated capability RPCs).
//! Scope syntax: `<group>.<verb>:<pattern>` e.g. `fs.read:./**`,
//! `net.fetch:https://api.example.com/*`. Pattern matching is left to
//! phase 2 — for now we just store decisions verbatim.

use serde::Deserialize;
use serde_json::Value;

use crate::error::RpcError;
use crate::state::RuntimeState;

#[derive(Debug, Deserialize)]
pub struct GrantParams {
    #[serde(rename = "instanceId")] pub instance_id: String,
    pub scope: String,
    /// "grant" | "deny" | "always" | "never"
    pub decision: String,
}

pub async fn handle_grant(state: &RuntimeState, params: Value) -> Result<(), RpcError> {
    let p: GrantParams = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("host/grantPermission: {e}")))?;

    let touched = state.with(|s| {
        if let Some(inst) = s.instances.get_mut(&p.instance_id) {
            match p.decision.as_str() {
                "grant" | "always" => {
                    if !inst.permissions.iter().any(|s| s == &p.scope) {
                        inst.permissions.push(p.scope.clone());
                    }
                    true
                }
                "deny" | "never" => {
                    inst.permissions.retain(|s| s != &p.scope);
                    true
                }
                _ => false,
            }
        } else {
            false
        }
    }).await;

    if !touched {
        tracing::warn!(
            instance_id = %p.instance_id,
            scope = %p.scope,
            decision = %p.decision,
            "host/grantPermission ignored (unknown instance or bad decision)"
        );
    }
    Ok(())
}
