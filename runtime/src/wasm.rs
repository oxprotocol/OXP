//! Wasmtime component runtime — phase 2.
//!
//! Loads a `wasm32-wasip2` component, links the `oxp:host/*` imports,
//! and exposes a small async API the JSON-RPC layer uses to drive the
//! component's exports (`lifecycle`, `ui-handler`, `command-handler`).
//!
//! Concurrency model: each loaded extension runs as its own tokio task
//! ("worker") that owns its `wasmtime::Store`. Callers send commands via
//! an mpsc channel and await a oneshot reply. This keeps `Store` (which
//! is `!Sync`) confined to a single task, avoids per-call locking, and
//! gives us a single place to enforce per-instance fuel/epoch limits in
//! a later milestone.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, OnceLock};

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc, oneshot};
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiView};

use crate::error::OxpErrorCode;
use crate::host_rpc::HostRpc;
use crate::rpc::server::Outbound;
use crate::state::RuntimeState;

// Generate bindings from `runtime/wit/extension.wit` (kept in sync by
// build.rs). `async: true` makes every host import an async fn so we can
// do real I/O on host side without blocking the wasm task.
wasmtime::component::bindgen!({
    world: "extension",
    path: "wit",
    async: true,
    with: {
        // No resource types in this world yet.
    },
    trappable_imports: true,
});

/// Per-store host data. Owns WASI + capability-broker state.
pub struct HostState {
    pub extension_id: String,
    pub instance_id: String,
    pub permissions: Vec<String>,
    /// Outbound channel back to the JSON-RPC writer task. Used by host
    /// imports (`ui.render`, `ui.set_status`, …) for fire-and-forget
    /// notifications.
    pub outbound: mpsc::Sender<Outbound>,
    /// Request/response handle. All gated capabilities (fs, net, secrets,
    /// commands) and persistent storage round-trip through the host via
    /// this — the runtime itself does not touch the user's machine.
    pub host_rpc: HostRpc,
    pub wasi: WasiCtx,
    pub table: ResourceTable,
}

impl WasiView for HostState {
    fn ctx(&mut self) -> &mut WasiCtx {
        &mut self.wasi
    }
    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
}

// ───────────────────────── host import impls ─────────────────────────

use exports::oxp::extension::lifecycle as ext_lifecycle;
use exports::oxp::extension::ui_handler as ext_ui_handler;
use oxp::host::commands::Host as CommandsHost;
use oxp::host::fs::{FsError, Host as FsHost};
use oxp::host::log::{Host as LogHost, Level};
use oxp::host::net::{Host as NetHost, NetError};
use oxp::host::secrets::Host as SecretsHost;
use oxp::host::storage::Host as StorageHost;
use oxp::host::ui::Host as UiHost;

#[wasmtime::component::__internal::async_trait]
impl LogHost for HostState {
    async fn log(&mut self, lvl: Level, message: String) -> wasmtime::Result<()> {
        let ext = &self.extension_id;
        let inst = &self.instance_id;
        // Mirror to local tracing so `--log` and stderr captures still work.
        match lvl {
            Level::Trace => tracing::trace!(target: "oxp::ext", extension = %ext, instance = %inst, "{message}"),
            Level::Debug => tracing::debug!(target: "oxp::ext", extension = %ext, instance = %inst, "{message}"),
            Level::Info  => tracing::info!(target:  "oxp::ext", extension = %ext, instance = %inst, "{message}"),
            Level::Warn  => tracing::warn!(target:  "oxp::ext", extension = %ext, instance = %inst, "{message}"),
            Level::Error => tracing::error!(target: "oxp::ext", extension = %ext, instance = %inst, "{message}"),
        }
        // Also forward to the host so the IDE log can surface it. Spec §6.1.
        let level_str = match lvl {
            Level::Trace => "trace",
            Level::Debug => "debug",
            Level::Info  => "info",
            Level::Warn  => "warn",
            Level::Error => "error",
        };
        self.host_rpc.notify("log/write", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "level":       level_str,
            "message":     message,
        })).await;
        Ok(())
    }
}

#[wasmtime::component::__internal::async_trait]
impl StorageHost for HostState {
    async fn get(&mut self, key: String) -> wasmtime::Result<Option<Vec<u8>>> {
        let v = self.host_rpc.request("storage/get", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "key":         key,
        })).await.map_err(|e| anyhow!("storage/get: {}", e.message))?;
        // Result shape: { "value": base64-string | null }
        match v.get("value") {
            Some(Value::Null) | None => Ok(None),
            Some(Value::String(b64)) => {
                use base64::Engine as _;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| anyhow!("storage/get: invalid base64: {e}"))?;
                Ok(Some(bytes))
            }
            other => Err(anyhow!("storage/get: unexpected value field: {other:?}")),
        }
    }
    async fn set(&mut self, key: String, value: Vec<u8>) -> wasmtime::Result<()> {
        use base64::Engine as _;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&value);
        self.host_rpc.request("storage/set", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "key":         key,
            "value":       b64,
        })).await.map_err(|e| anyhow!("storage/set: {}", e.message))?;
        Ok(())
    }
    async fn delete(&mut self, key: String) -> wasmtime::Result<()> {
        self.host_rpc.request("storage/delete", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "key":         key,
        })).await.map_err(|e| anyhow!("storage/delete: {}", e.message))?;
        Ok(())
    }
    async fn keys(&mut self) -> wasmtime::Result<Vec<String>> {
        let v = self.host_rpc.request("storage/keys", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
        })).await.map_err(|e| anyhow!("storage/keys: {}", e.message))?;
        let arr = v.get("keys")
            .and_then(|x| x.as_array())
            .ok_or_else(|| anyhow!("storage/keys: missing 'keys' array"))?;
        Ok(arr.iter().filter_map(|s| s.as_str().map(String::from)).collect())
    }
}

#[wasmtime::component::__internal::async_trait]
impl UiHost for HostState {
    async fn render(&mut self, tree: Vec<u8>) -> wasmtime::Result<()> {
        // ui/render is a notification (spec §6.1). Send the JSON tree as a
        // string so hosts don't have to base64-decode in the common case.
        let payload = match std::str::from_utf8(&tree) {
            Ok(s) => json!({
                "instanceId":   self.instance_id,
                "extensionId":  self.extension_id,
                "treeJson":     s,
            }),
            Err(_) => {
                use base64::Engine as _;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&tree);
                json!({
                    "instanceId":   self.instance_id,
                    "extensionId":  self.extension_id,
                    "treeBase64":   b64,
                })
            }
        };
        self.host_rpc.notify("ui/render", payload).await;
        Ok(())
    }
    async fn set_status(&mut self, text: String, tooltip: Option<String>) -> wasmtime::Result<()> {
        self.host_rpc.notify("ui/setStatus", json!({
            "instanceId":   self.instance_id,
            "extensionId":  self.extension_id,
            "text":         text,
            "tooltip":      tooltip,
        })).await;
        Ok(())
    }
    async fn notify(&mut self, message: String, buttons: Vec<String>) -> wasmtime::Result<Option<String>> {
        // ui/notify is a request (spec §6.1) — host returns the chosen button
        // label or null. Use a longer timeout because this can block on a
        // user dialog.
        let v = self.host_rpc.request_with_timeout(
            "ui/notify",
            json!({
                "instanceId":  self.instance_id,
                "extensionId": self.extension_id,
                "message":     message,
                "buttons":     buttons,
            }),
            std::time::Duration::from_secs(300),
        ).await.map_err(|e| anyhow!("ui/notify: {}", e.message))?;
        match v.get("choice") {
            Some(Value::Null) | None => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.clone())),
            other => Err(anyhow!("ui/notify: unexpected choice: {other:?}")),
        }
    }
}

// Gated capabilities — all RPC out to the host. The host enforces the
// per-extension permission scope and signals violations via the standard
// `-32004 PERMISSION_DENIED` error envelope, which we translate back to
// the matching WIT variant so wasm code keeps the typed error model.

fn fs_error_from_rpc(err: crate::error::RpcError) -> FsError {
    if err.code == OxpErrorCode::PermissionDenied as i32 {
        let scope = err.data.as_ref()
            .and_then(|d| d.get("scope"))
            .and_then(|s| s.as_str())
            .unwrap_or("");
        return FsError::Forbidden(scope.to_string());
    }
    if let Some(data) = err.data.as_ref() {
        if let Some(kind) = data.get("kind").and_then(|k| k.as_str()) {
            match kind {
                "notFound" => return FsError::NotFound,
                "tooLarge" => {
                    let bytes = data.get("bytes").and_then(|b| b.as_u64()).unwrap_or(0);
                    return FsError::TooLarge(bytes);
                }
                _ => {}
            }
        }
    }
    FsError::Io(err.message)
}

fn net_error_from_rpc(err: crate::error::RpcError) -> NetError {
    if err.code == OxpErrorCode::PermissionDenied as i32 {
        let scope = err.data.as_ref()
            .and_then(|d| d.get("scope"))
            .and_then(|s| s.as_str())
            .unwrap_or("");
        return NetError::Forbidden(scope.to_string());
    }
    if let Some(data) = err.data.as_ref() {
        if let Some(kind) = data.get("kind").and_then(|k| k.as_str()) {
            match kind {
                "timeout"  => return NetError::Timeout,
                "tooLarge" => {
                    let bytes = data.get("bytes").and_then(|b| b.as_u64()).unwrap_or(0);
                    return NetError::TooLarge(bytes);
                }
                _ => {}
            }
        }
    }
    NetError::Transport(err.message)
}

#[wasmtime::component::__internal::async_trait]
impl FsHost for HostState {
    async fn read_file(&mut self, path: String) -> wasmtime::Result<Result<Vec<u8>, FsError>> {
        let res = self.host_rpc.request("fs/readFile", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "path":        path,
        })).await;
        Ok(match res {
            Ok(v) => {
                use base64::Engine as _;
                let b64 = v.get("bytes").and_then(|x| x.as_str()).unwrap_or("");
                base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| FsError::Io(format!("invalid base64 from host: {e}")))
            }
            Err(e) => Err(fs_error_from_rpc(e)),
        })
    }
    async fn write_file(&mut self, path: String, bytes: Vec<u8>) -> wasmtime::Result<Result<(), FsError>> {
        use base64::Engine as _;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let res = self.host_rpc.request("fs/writeFile", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "path":        path,
            "bytes":       b64,
        })).await;
        Ok(match res {
            Ok(_) => Ok(()),
            Err(e) => Err(fs_error_from_rpc(e)),
        })
    }
    async fn delete(&mut self, path: String) -> wasmtime::Result<Result<(), FsError>> {
        let res = self.host_rpc.request("fs/delete", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "path":        path,
        })).await;
        Ok(match res {
            Ok(_) => Ok(()),
            Err(e) => Err(fs_error_from_rpc(e)),
        })
    }
    async fn stat(&mut self, path: String) -> wasmtime::Result<Result<oxp::host::fs::FileStat, FsError>> {
        let res = self.host_rpc.request("fs/stat", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "path":        path,
        })).await;
        Ok(match res {
            Ok(v) => Ok(oxp::host::fs::FileStat {
                size:     v.get("size").and_then(|x| x.as_u64()).unwrap_or(0),
                is_dir:   v.get("isDir").and_then(|x| x.as_bool()).unwrap_or(false),
                mtime_ms: v.get("mtimeMs").and_then(|x| x.as_u64()).unwrap_or(0),
            }),
            Err(e) => Err(fs_error_from_rpc(e)),
        })
    }
    async fn list_dir(&mut self, path: String) -> wasmtime::Result<Result<Vec<String>, FsError>> {
        let res = self.host_rpc.request("fs/listDir", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "path":        path,
        })).await;
        Ok(match res {
            Ok(v) => {
                let arr = v.get("entries").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                Ok(arr.into_iter().filter_map(|s| s.as_str().map(String::from)).collect())
            }
            Err(e) => Err(fs_error_from_rpc(e)),
        })
    }
}

#[wasmtime::component::__internal::async_trait]
impl NetHost for HostState {
    async fn fetch(
        &mut self,
        req: oxp::host::net::HttpRequest,
    ) -> wasmtime::Result<Result<oxp::host::net::HttpResponse, NetError>> {
        use base64::Engine as _;
        let body_b64 = req.body.as_ref().map(|b| {
            base64::engine::general_purpose::STANDARD.encode(b)
        });
        let headers: Vec<Value> = req.headers.iter()
            .map(|(k, v)| json!([k, v]))
            .collect();
        let res = self.host_rpc.request_with_timeout("net/fetch", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "method":      req.method,
            "url":         req.url,
            "headers":     headers,
            "body":        body_b64,
        }), std::time::Duration::from_secs(60)).await;
        Ok(match res {
            Ok(v) => {
                let status = v.get("status").and_then(|x| x.as_u64()).unwrap_or(0) as u16;
                let headers: Vec<(String, String)> = v.get("headers")
                    .and_then(|x| x.as_array())
                    .map(|arr| arr.iter().filter_map(|pair| {
                        let p = pair.as_array()?;
                        Some((p.get(0)?.as_str()?.to_string(), p.get(1)?.as_str()?.to_string()))
                    }).collect())
                    .unwrap_or_default();
                let body_b64 = v.get("body").and_then(|x| x.as_str()).unwrap_or("");
                let body = base64::engine::general_purpose::STANDARD
                    .decode(body_b64)
                    .map_err(|e| NetError::Transport(format!("invalid base64 body: {e}")))?;
                Ok(oxp::host::net::HttpResponse { status, headers, body })
            }
            Err(e) => Err(net_error_from_rpc(e)),
        })
    }
}

#[wasmtime::component::__internal::async_trait]
impl SecretsHost for HostState {
    async fn get(&mut self, key: String) -> wasmtime::Result<Option<String>> {
        let v = self.host_rpc.request("secrets/get", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "key":         key,
        })).await.map_err(|e| anyhow!("secrets/get: {}", e.message))?;
        Ok(v.get("value").and_then(|x| x.as_str()).map(String::from))
    }
    async fn set(&mut self, key: String, value: String) -> wasmtime::Result<()> {
        self.host_rpc.request("secrets/set", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "key":         key,
            "value":       value,
        })).await.map_err(|e| anyhow!("secrets/set: {}", e.message))?;
        Ok(())
    }
    async fn delete(&mut self, key: String) -> wasmtime::Result<()> {
        self.host_rpc.request("secrets/delete", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "key":         key,
        })).await.map_err(|e| anyhow!("secrets/delete: {}", e.message))?;
        Ok(())
    }
}

#[wasmtime::component::__internal::async_trait]
impl CommandsHost for HostState {
    async fn execute(&mut self, id: String, args_json: String) -> wasmtime::Result<Result<String, String>> {
        let res = self.host_rpc.request("commands/execute", json!({
            "extensionId": self.extension_id,
            "instanceId":  self.instance_id,
            "commandId":   id,
            "argsJson":    args_json,
        })).await;
        Ok(match res {
            Ok(v) => Ok(v.get("resultJson").and_then(|x| x.as_str()).unwrap_or("null").to_string()),
            Err(e) => Err(e.message),
        })
    }
}

// ───────────────────────── engine + linker ─────────────────────────

static ENGINE: OnceLock<Engine> = OnceLock::new();

fn engine() -> &'static Engine {
    ENGINE.get_or_init(|| {
        let mut cfg = Config::new();
        cfg.async_support(true);
        cfg.wasm_component_model(true);
        cfg.consume_fuel(false); // fuel/epoch landing in a later phase
        Engine::new(&cfg).expect("wasmtime engine init")
    })
}

fn make_linker() -> Result<Linker<HostState>> {
    let mut linker = Linker::<HostState>::new(engine());
    // WASI bits — wasm32-wasip2 components may import wasi:cli/io even
    // when the extension never explicitly uses them. Linking the full
    // sync surface is the cheapest way to keep instantiation working.
    wasmtime_wasi::add_to_linker_async(&mut linker)
        .context("link wasi imports")?;
    // OXP host imports.
    Extension::add_to_linker(&mut linker, |s: &mut HostState| s)
        .context("link oxp:host imports")?;
    Ok(linker)
}

// ───────────────────────── instance worker ─────────────────────────

/// A loaded, instantiated component running in its own tokio task.
#[derive(Clone)]
pub struct WorkerHandle {
    tx: mpsc::Sender<WorkerMsg>,
}

enum WorkerMsg {
    Activate {
        ctx: ext_lifecycle::ActivateCtx,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Deactivate {
        reply: oneshot::Sender<Result<(), String>>,
    },
    Command {
        id: String,
        args_json: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    Event {
        bytes: Vec<u8>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Shutdown,
}

impl WorkerHandle {
    pub async fn activate(&self, ctx: ext_lifecycle::ActivateCtx) -> Result<Result<(), String>> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(WorkerMsg::Activate { ctx, reply: tx }).await
            .map_err(|_| anyhow!("worker is gone"))?;
        rx.await.map_err(|_| anyhow!("worker dropped reply"))
    }
    pub async fn deactivate(&self) -> Result<Result<(), String>> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(WorkerMsg::Deactivate { reply: tx }).await
            .map_err(|_| anyhow!("worker is gone"))?;
        rx.await.map_err(|_| anyhow!("worker dropped reply"))
    }
    pub async fn command(&self, id: String, args_json: String) -> Result<Result<String, String>> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(WorkerMsg::Command { id, args_json, reply: tx }).await
            .map_err(|_| anyhow!("worker is gone"))?;
        rx.await.map_err(|_| anyhow!("worker dropped reply"))
    }
    pub async fn event(&self, bytes: Vec<u8>) -> Result<Result<(), String>> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(WorkerMsg::Event { bytes, reply: tx }).await
            .map_err(|_| anyhow!("worker is gone"))?;
        rx.await.map_err(|_| anyhow!("worker dropped reply"))
    }
    pub async fn shutdown(&self) {
        let _ = self.tx.send(WorkerMsg::Shutdown).await;
    }
}

/// Resolve `bundle_path` to a wasm component file. Accepts either a
/// `.wasm` path directly, or a directory containing `extension.wasm`.
pub fn resolve_component_path(bundle_path: &str) -> Result<std::path::PathBuf> {
    let p = Path::new(bundle_path);
    if p.is_file() {
        return Ok(p.to_path_buf());
    }
    if p.is_dir() {
        let candidate = p.join("extension.wasm");
        if candidate.is_file() {
            return Ok(candidate);
        }
        return Err(anyhow!("bundle directory has no extension.wasm: {bundle_path}"));
    }
    Err(anyhow!("bundle path does not exist: {bundle_path}"))
}

/// Compile + instantiate the component, then spawn its worker task.
pub async fn spawn_worker(
    extension_id: String,
    instance_id: String,
    permissions: Vec<String>,
    component_path: std::path::PathBuf,
    outbound: mpsc::Sender<Outbound>,
    state: RuntimeState,
) -> Result<WorkerHandle> {
    let engine = engine().clone();
    let bytes = tokio::fs::read(&component_path).await
        .with_context(|| format!("read component {}", component_path.display()))?;
    let component = Component::from_binary(&engine, &bytes)
        .context("decode wasm component")?;
    let linker = make_linker()?;

    let host_rpc = HostRpc::new(outbound.clone(), state);
    let host = HostState {
        extension_id: extension_id.clone(),
        instance_id: instance_id.clone(),
        permissions,
        outbound,
        host_rpc,
        wasi: WasiCtxBuilder::new().build(),
        table: ResourceTable::new(),
    };
    let mut store = Store::new(&engine, host);

    let bindings = Extension::instantiate_async(&mut store, &component, &linker)
        .await
        .context("instantiate component")?;

    let (tx, mut rx) = mpsc::channel::<WorkerMsg>(16);

    tokio::spawn(async move {
        let bindings = bindings;
        let mut store = store;
        while let Some(msg) = rx.recv().await {
            match msg {
                WorkerMsg::Activate { ctx, reply } => {
                    let res = bindings
                        .oxp_extension_lifecycle()
                        .call_activate(&mut store, &ctx)
                        .await;
                    let _ = reply.send(flatten(res));
                }
                WorkerMsg::Deactivate { reply } => {
                    let res = bindings
                        .oxp_extension_lifecycle()
                        .call_deactivate(&mut store)
                        .await;
                    let _ = reply.send(flatten(res));
                }
                WorkerMsg::Command { id, args_json, reply } => {
                    let res = bindings
                        .oxp_extension_command_handler()
                        .call_on_command(&mut store, &id, &args_json)
                        .await;
                    let _ = reply.send(flatten(res));
                }
                WorkerMsg::Event { bytes, reply } => {
                    let res = bindings
                        .oxp_extension_ui_handler()
                        .call_on_event(&mut store, &bytes)
                        .await;
                    let mapped: Result<(), String> = match res {
                        Ok(Ok(())) => Ok(()),
                        Ok(Err(e)) => Err(format_event_error(e)),
                        Err(trap) => Err(format!("trap: {trap:#}")),
                    };
                    let _ = reply.send(mapped);
                }
                WorkerMsg::Shutdown => break,
            }
        }
        tracing::debug!(instance = %store.data().instance_id, "worker exiting");
    });

    Ok(WorkerHandle { tx })
}

fn flatten<T>(r: wasmtime::Result<Result<T, String>>) -> Result<T, String> {
    match r {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(trap) => Err(format!("trap: {trap:#}")),
    }
}

fn format_event_error(e: ext_ui_handler::EventError) -> String {
    match e {
        ext_ui_handler::EventError::UnknownTarget(s) => format!("unknown-target: {s}"),
        ext_ui_handler::EventError::InvalidPayload(s) => format!("invalid-payload: {s}"),
        ext_ui_handler::EventError::Internal(s) => format!("internal: {s}"),
    }
}

/// Re-exports so `extension.rs` can build the activate context.
pub use ext_lifecycle::ActivateCtx;

/// Convenience holder kept in `state::Inner.workers`.
pub type Workers = Arc<Mutex<HashMap<String, WorkerHandle>>>;
