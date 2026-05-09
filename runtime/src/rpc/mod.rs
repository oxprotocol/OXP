//! JSON-RPC 2.0 over stdio with LSP-style framing.
//!
//! See `spec/v1/host-runtime-rpc.md` §2.

mod codec;
mod message;
pub mod server;

pub use message::{Notification, Request, Response};
pub use server::serve_stdio;
