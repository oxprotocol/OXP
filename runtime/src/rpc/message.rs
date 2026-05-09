//! JSON-RPC 2.0 message envelopes.
//!
//! We accept and emit the three canonical shapes: Request, Response,
//! Notification. We do not implement Batch (the spec disallows it).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::RpcError;

/// Inbound message kinds. Discriminated by the presence of `id` and `method`.
#[derive(Debug)]
pub enum Inbound {
    Request(Request),
    Notification(Notification),
    Response(Response),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Notification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct InboundRaw {
    #[serde(default)]
    jsonrpc: Option<String>,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<Value>,
}

impl Inbound {
    pub fn parse(bytes: &[u8]) -> Result<Self, RpcError> {
        let raw: InboundRaw = serde_json::from_slice(bytes)
            .map_err(|e| RpcError::parse_error(format!("invalid JSON: {e}")))?;

        if raw.jsonrpc.as_deref() != Some("2.0") {
            return Err(RpcError {
                code: -32600,
                message: "Invalid Request: jsonrpc must be \"2.0\"".into(),
                data: None,
            });
        }

        let jsonrpc = raw.jsonrpc.unwrap();

        match (raw.id, raw.method, raw.result, raw.error) {
            // Request: id + method
            (Some(id), Some(method), None, None) => Ok(Inbound::Request(Request {
                jsonrpc,
                id,
                method,
                params: raw.params,
            })),
            // Notification: method, no id
            (None, Some(method), None, None) => Ok(Inbound::Notification(Notification {
                jsonrpc,
                method,
                params: raw.params,
            })),
            // Response: id + (result or error), no method
            (Some(id), None, result, error_val) => {
                let error = match error_val {
                    None => None,
                    Some(v) => Some(serde_json::from_value::<ResponseErrorWire>(v)
                        .map_err(|e| RpcError::parse_error(format!("invalid error object: {e}")))?
                        .into()),
                };
                Ok(Inbound::Response(Response {
                    jsonrpc: "2.0",
                    id,
                    result,
                    error,
                }))
            }
            _ => Err(RpcError {
                code: -32600,
                message: "Invalid Request: not a valid JSON-RPC envelope".into(),
                data: None,
            }),
        }
    }
}

#[derive(Deserialize)]
struct ResponseErrorWire {
    code: i32,
    message: String,
    #[serde(default)]
    data: Option<Value>,
}

impl From<ResponseErrorWire> for RpcError {
    fn from(w: ResponseErrorWire) -> Self {
        RpcError { code: w.code, message: w.message, data: w.data }
    }
}
