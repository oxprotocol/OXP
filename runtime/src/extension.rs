//! Extension lifecycle handlers (load / activate / command / event / deactivate / unload / reload).
//!
//! Spec §5.2 – §5.7, §5.10.
//!
//! Phase 2 wires every handler into the wasmtime worker that owns the
//! component's `Store`. Capability negotiation still happens up front
//! (spec §7) so unsupported surfaces fail before we touch the .wasm.

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::error::{OxpErrorCode, RpcError};
use crate::lifecycle::{HostCapabilities, missing_caps};
use crate::rpc::server::Outbound;
use crate::state::RuntimeState;
use crate::wasm::{ActivateCtx, WorkerHandle, resolve_component_path, spawn_worker};

/// In-memory record of a loaded extension.
pub struct Instance {
    pub instance_id: String,
    pub extension_id: String,
    pub version: String,
    pub bundle_path: String,
    pub permissions: Vec<String>,
    pub activated: bool,
    pub degraded: Vec<String>,
    pub worker: WorkerHandle,
    pub host_id: String,
    pub host_version: String,
}

#[derive(Debug, Deserialize)]
pub struct LoadParams {
    #[serde(rename = "extensionId")] pub extension_id: String,
    pub version: String,
    #[serde(rename = "bundlePath")]  pub bundle_path: String,
    #[serde(default)]                pub permissions: Vec<String>,
    /// Echoed from the bundle manifest by the host. The runtime will,
    /// once we parse the manifest itself, re-derive these from the
    /// bundle; until then we trust the host so we can exercise
    /// capability negotiation end-to-end.
    #[serde(default, rename = "surfacesRequired")] pub surfaces_required: Vec<String>,
    #[serde(default, rename = "surfacesOptional")] pub surfaces_optional: Vec<String>,
}

pub async fn handle_load(
    state: &RuntimeState,
    outbound: mpsc::Sender<Outbound>,
    params: Value,
) -> Result<Value, RpcError> {
    let params: LoadParams = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("extension/load: {e}")))?;

    // Must have completed handshake first.
    let handshake = state
        .with(|s| s.handshake.clone())
        .await
        .ok_or_else(|| RpcError::internal("extension/load received before initialize"))?;
    let host_caps: HostCapabilities = handshake.capabilities.clone();

    // Capability gate (spec §7).
    let missing = missing_caps(&host_caps, &params.surfaces_required);
    if !missing.is_empty() {
        return Err(RpcError::oxp_with(
            OxpErrorCode::CapabilityUnsupported,
            "host does not advertise required surfaces",
            json!({ "missing": missing }),
        ));
    }
    let degraded = missing_caps(&host_caps, &params.surfaces_optional);

    // Resolve + load the wasm component.
    let component_path = resolve_component_path(&params.bundle_path)
        .map_err(|e| RpcError::oxp(OxpErrorCode::BundleCorrupt, format!("{e:#}")))?;

    let instance_id = format!(
        "ext-{}",
        next_instance_suffix(&params.extension_id, &params.version)
    );

    let worker = spawn_worker(
        params.extension_id.clone(),
        instance_id.clone(),
        params.permissions.clone(),
        component_path,
        outbound,
        state.clone(),
    )
    .await
    .map_err(|e| RpcError::oxp(OxpErrorCode::BundleCorrupt, format!("instantiate failed: {e:#}")))?;

    let inst = Instance {
        instance_id: instance_id.clone(),
        extension_id: params.extension_id.clone(),
        version: params.version.clone(),
        bundle_path: params.bundle_path,
        permissions: params.permissions,
        activated: false,
        degraded: degraded.clone(),
        worker,
        host_id: handshake.host.id.clone(),
        host_version: handshake.host.version.clone(),
    };

    state.with(|s| {
        s.instances.insert(instance_id.clone(), inst);
    }).await;

    tracing::info!(
        instance_id = %instance_id,
        extension_id = %params.extension_id,
        version = %params.version,
        ?degraded,
        "extension/load"
    );

    Ok(json!({
        "instanceId": instance_id,
        "exports":    ["lifecycle", "ui-handler", "command-handler"],
        "degraded":   degraded,
    }))
}

#[derive(Debug, Deserialize)]
struct InstanceRef {
    #[serde(rename = "instanceId")] instance_id: String,
}

/// Snapshot the bits of an `Instance` we need to drive its worker
/// without holding the state mutex across an await on the worker.
struct InstanceCall {
    worker: WorkerHandle,
    extension_id: String,
    version: String,
    host_id: String,
    host_version: String,
}

async fn snapshot(state: &RuntimeState, id: &str) -> Result<InstanceCall, RpcError> {
    state
        .with(|s| {
            s.instances.get(id).map(|i| InstanceCall {
                worker: i.worker.clone(),
                extension_id: i.extension_id.clone(),
                version: i.version.clone(),
                host_id: i.host_id.clone(),
                host_version: i.host_version.clone(),
            })
        })
        .await
        .ok_or_else(|| RpcError::oxp(OxpErrorCode::UnknownInstance, format!("unknown instance: {id}")))
}

pub async fn handle_activate(state: &RuntimeState, params: Value) -> Result<Value, RpcError> {
    let r: InstanceRef = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("extension/activate: {e}")))?;
    let snap = snapshot(state, &r.instance_id).await?;

    let ctx = ActivateCtx {
        extension_id: snap.extension_id,
        version: snap.version,
        host: snap.host_id,
        host_version: snap.host_version,
    };
    let res = snap.worker.activate(ctx).await
        .map_err(|e| RpcError::internal(format!("activate dispatch: {e:#}")))?;
    match res {
        Ok(()) => {
            state.with(|s| {
                if let Some(i) = s.instances.get_mut(&r.instance_id) { i.activated = true; }
            }).await;
            tracing::info!(instance_id = %r.instance_id, "extension/activate");
            Ok(json!({ "ok": true }))
        }
        Err(reason) => Err(RpcError::oxp(OxpErrorCode::ExtensionTrapped, format!("activate failed: {reason}"))),
    }
}

#[derive(Debug, Deserialize)]
struct CommandParams {
    #[serde(rename = "instanceId")] instance_id: String,
    #[serde(rename = "commandId")]  command_id: String,
    #[serde(default, rename = "argsJson")] args_json: Option<String>,
}

pub async fn handle_command(state: &RuntimeState, params: Value) -> Result<Value, RpcError> {
    let p: CommandParams = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("extension/command: {e}")))?;
    let snap = snapshot(state, &p.instance_id).await?;
    let res = snap
        .worker
        .command(p.command_id.clone(), p.args_json.unwrap_or_else(|| "null".into()))
        .await
        .map_err(|e| RpcError::internal(format!("command dispatch: {e:#}")))?;
    match res {
        Ok(result_json) => Ok(json!({ "resultJson": result_json })),
        Err(reason) => Err(RpcError::oxp(OxpErrorCode::ExtensionTrapped, format!("command failed: {reason}"))),
    }
}

pub async fn handle_event(state: &RuntimeState, params: Value) -> Result<(), RpcError> {
    #[derive(Deserialize)]
    struct EventParams {
        #[serde(rename = "instanceId")] instance_id: String,
        /// For phase 2 we accept a UTF-8 string and pass its bytes
        /// through to the component. The wire format hardens later.
        #[serde(default)] payload: Option<String>,
    }
    let p: EventParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => { tracing::warn!(error = %e, "extension/event bad params"); return Ok(()); }
    };
    let snap = match snapshot(state, &p.instance_id).await {
        Ok(s) => s,
        Err(_) => { tracing::warn!(instance_id = %p.instance_id, "event for unknown instance"); return Ok(()); }
    };
    let bytes = p.payload.unwrap_or_default().into_bytes();
    if let Err(e) = snap.worker.event(bytes).await {
        tracing::warn!(error = %e, "event dispatch failed");
    }
    Ok(())
}

pub async fn handle_deactivate(state: &RuntimeState, params: Value) -> Result<Value, RpcError> {
    let r: InstanceRef = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("extension/deactivate: {e}")))?;
    let snap = snapshot(state, &r.instance_id).await?;
    let res = snap.worker.deactivate().await
        .map_err(|e| RpcError::internal(format!("deactivate dispatch: {e:#}")))?;
    state.with(|s| {
        if let Some(i) = s.instances.get_mut(&r.instance_id) { i.activated = false; }
    }).await;
    match res {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(reason) => Err(RpcError::oxp(OxpErrorCode::ExtensionTrapped, format!("deactivate failed: {reason}"))),
    }
}

pub async fn handle_unload(state: &RuntimeState, params: Value) -> Result<(), RpcError> {
    let r: InstanceRef = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("extension/unload: {e}")))?;
    let removed = state.with(|s| s.instances.remove(&r.instance_id)).await;
    if let Some(inst) = removed {
        inst.worker.shutdown().await;
    } else {
        tracing::warn!(instance_id = %r.instance_id, "unload for unknown instance");
    }
    Ok(())
}

pub async fn handle_reload(state: &RuntimeState, params: Value) -> Result<(), RpcError> {
    let r: InstanceRef = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("extension/reload: {e}")))?;
    let exists = state.with(|s| s.instances.contains_key(&r.instance_id)).await;
    if !exists {
        return Err(RpcError::oxp(
            OxpErrorCode::UnknownInstance,
            format!("unknown instance: {}", r.instance_id),
        ));
    }
    tracing::info!(instance_id = %r.instance_id, "extension/reload (stub — re-instantiation TBD)");
    Ok(())
}

/// Cheap deterministic-ish suffix from extension+version. Not security
/// sensitive — only needs to be unique within this process run.
fn next_instance_suffix(ext: &str, ver: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hash: u64 = 1469598103934665603;
    for b in ext.bytes().chain(b":".iter().copied()).chain(ver.bytes()) {
        hash ^= b as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{:x}{:02x}", hash & 0xffff, n & 0xff)
}
