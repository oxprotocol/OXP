//! OXP-specific JSON-RPC error codes.
//!
//! Source of truth: `spec/v1/host-runtime-rpc.md` §10.
//!
//! Standard JSON-RPC 2.0 codes (`-32700`, `-32600`, `-32601`, `-32602`,
//! `-32603`) are produced directly by the framing/dispatch layer.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum OxpErrorCode {
    SignatureInvalid     = -32001,
    WorldMismatch        = -32002,
    CapabilityUnsupported = -32003,
    PermissionDenied     = -32004,
    ExtensionTrapped     = -32005,
    FuelExhausted        = -32006,
    BundleCorrupt        = -32007,
    UnknownInstance      = -32008,
    StreamBroken         = -32009,
    HostTimeout          = -32010,
    SurfaceUnsupported   = -32011,
}

impl OxpErrorCode {
    pub fn symbol(self) -> &'static str {
        use OxpErrorCode::*;
        match self {
            SignatureInvalid      => "SIGNATURE_INVALID",
            WorldMismatch         => "WORLD_MISMATCH",
            CapabilityUnsupported => "CAPABILITY_UNSUPPORTED",
            PermissionDenied      => "PERMISSION_DENIED",
            ExtensionTrapped      => "EXTENSION_TRAPPED",
            FuelExhausted         => "FUEL_EXHAUSTED",
            BundleCorrupt         => "BUNDLE_CORRUPT",
            UnknownInstance       => "UNKNOWN_INSTANCE",
            StreamBroken          => "STREAM_BROKEN",
            HostTimeout           => "HOST_TIMEOUT",
            SurfaceUnsupported    => "SURFACE_UNSUPPORTED",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn oxp(code: OxpErrorCode, message: impl Into<String>) -> Self {
        Self { code: code as i32, message: message.into(), data: None }
    }

    pub fn oxp_with(code: OxpErrorCode, message: impl Into<String>, data: Value) -> Self {
        Self { code: code as i32, message: message.into(), data: Some(data) }
    }

    pub fn method_not_found(method: &str) -> Self {
        Self {
            code: -32601,
            message: format!("Method not found: {method}"),
            data: None,
        }
    }

    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self { code: -32602, message: message.into(), data: None }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self { code: -32603, message: message.into(), data: None }
    }

    pub fn parse_error(message: impl Into<String>) -> Self {
        Self { code: -32700, message: message.into(), data: None }
    }
}
