//! Lifecycle handlers: `initialize`, `shutdown`, `exit`.
//!
//! Spec §5.1, §5.8.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{OxpErrorCode, RpcError};
use crate::state::RuntimeState;

/// Protocol major.minor we implement. Spec freezes this at "1.0" for v1.
pub const PROTOCOL_VERSION: &str = "1.0";

/// WIT worlds this runtime can host.
pub const SUPPORTED_WORLDS: &[&str] = &["oxp:extension@0.1.0"];

#[derive(Debug, Clone, Deserialize)]
pub struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
    pub host: HostInfo,
    pub capabilities: HostCapabilities,
    #[serde(rename = "hostStorePath")]
    pub host_store_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostInfo {
    pub id: String,
    pub version: String,
    pub platform: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct HostCapabilities {
    pub ui: UiCaps,
    pub language: LanguageCaps,
    pub editor: EditorCaps,
    pub fs: FsCaps,
    pub process: ProcessCaps,
    pub secrets: SecretsCaps,
    pub debugger: DebuggerCaps,
    pub terminal: TerminalCaps,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct UiCaps {
    pub webview: bool,
    #[serde(rename = "treeView")] pub tree_view: bool,
    #[serde(rename = "statusBar")] pub status_bar: bool,
    pub notification: bool,
    #[serde(rename = "quickPick")] pub quick_pick: bool,
    #[serde(rename = "inputBox")] pub input_box: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct LanguageCaps {
    pub completions: bool,
    pub hover: bool,
    #[serde(rename = "codeLens")] pub code_lens: bool,
    pub diagnostics: bool,
    pub definition: bool,
    pub references: bool,
    pub rename: bool,
    pub formatting: bool,
    #[serde(rename = "languageServer")] pub language_server: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct EditorCaps {
    pub buffers: bool,
    pub decorations: bool,
    pub selection: bool,
    #[serde(rename = "virtualText")] pub virtual_text: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct FsCaps {
    #[serde(rename = "workspaceScoped")] pub workspace_scoped: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct ProcessCaps {
    pub spawn: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SecretsCaps {
    /// "keychain" | "memory" | "none"
    pub store: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct DebuggerCaps {
    pub dap: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct TerminalCaps {
    pub create: bool,
}

/// Persisted result of a successful `initialize`.
#[derive(Debug, Clone)]
pub struct HostHandshake {
    pub host: HostInfo,
    pub capabilities: HostCapabilities,
    pub host_store_path: String,
}

pub async fn handle_initialize(state: &RuntimeState, params: Value) -> Result<Value, RpcError> {
    let params: InitializeParams = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("initialize: {e}")))?;

    // Major-version check (spec §3 — refuse silent downgrades).
    let host_major = params.protocol_version.split('.').next().unwrap_or("");
    let our_major = PROTOCOL_VERSION.split('.').next().unwrap_or("");
    if host_major != our_major {
        return Err(RpcError::oxp_with(
            OxpErrorCode::WorldMismatch,
            format!(
                "incompatible protocol version: host={} runtime={}",
                params.protocol_version, PROTOCOL_VERSION
            ),
            json!({
                "hostProtocol":    params.protocol_version,
                "runtimeProtocol": PROTOCOL_VERSION,
            }),
        ));
    }

    let handshake = HostHandshake {
        host: params.host.clone(),
        capabilities: params.capabilities,
        host_store_path: params.host_store_path,
    };

    state.with(|s| {
        s.handshake = Some(handshake);
    }).await;

    tracing::info!(host = %params.host.id, version = %params.host.version, "initialize complete");

    Ok(json!({
        "runtimeVersion":  env!("CARGO_PKG_VERSION"),
        "wasmEngine":      "wasmtime/26",
        "supportedWorlds": SUPPORTED_WORLDS,
    }))
}

pub async fn handle_shutdown(state: &RuntimeState) -> Result<Value, RpcError> {
    state.with(|s| s.shutdown_requested = true).await;
    tracing::info!("shutdown received");
    Ok(Value::Null)
}

pub async fn handle_exit(state: &RuntimeState) -> Result<(), RpcError> {
    state.with(|s| s.exit_requested = true).await;
    tracing::info!("exit received");
    Ok(())
}

/// Compute the set of required capabilities the host does not advertise.
/// Returns the missing strings (e.g. `"ui.webview"`).
pub fn missing_caps(host: &HostCapabilities, required: &[String]) -> Vec<String> {
    required
        .iter()
        .filter(|cap| !cap_present(host, cap))
        .cloned()
        .collect()
}

fn cap_present(h: &HostCapabilities, cap: &str) -> bool {
    match cap {
        // ui.*
        "ui.webview"      => h.ui.webview,
        "ui.treeView"     => h.ui.tree_view,
        "ui.statusBar"    => h.ui.status_bar,
        "ui.notification" => h.ui.notification,
        "ui.quickPick"    => h.ui.quick_pick,
        "ui.inputBox"     => h.ui.input_box,
        // language.*
        "language.completions"    => h.language.completions,
        "language.hover"          => h.language.hover,
        "language.codeLens"       => h.language.code_lens,
        "language.diagnostics"    => h.language.diagnostics,
        "language.definition"     => h.language.definition,
        "language.references"     => h.language.references,
        "language.rename"         => h.language.rename,
        "language.formatting"     => h.language.formatting,
        "language.languageServer" => h.language.language_server,
        // editor.*
        "editor.buffers"     => h.editor.buffers,
        "editor.decorations" => h.editor.decorations,
        "editor.selection"   => h.editor.selection,
        "editor.virtualText" => h.editor.virtual_text,
        // misc
        "process.spawn"    => h.process.spawn,
        "debugger.dap"     => h.debugger.dap,
        "terminal.create"  => h.terminal.create,
        // secrets.* — having any store at all counts as "present"
        "secrets" | "secrets.store" => !h.secrets.store.is_empty() && h.secrets.store != "none",
        // fs.* — workspace scoping is the only flag we check today
        "fs"                  => h.fs.workspace_scoped,
        "fs.workspaceScoped"  => h.fs.workspace_scoped,
        // Unknown capability strings are treated as unsupported (fail-closed).
        _ => false,
    }
}
