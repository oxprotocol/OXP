//! oxp-runtime — standalone wasm component runtime for OXP extensions.
//!
//! See `spec/v1/host-runtime-rpc.md` for the wire protocol this binary
//! implements. This file is the entry point; the actual RPC plumbing lives
//! in [`crate::rpc`] and the dispatch logic in [`crate::dispatch`].

// Phase-1 scaffolding: several fields and helpers exist for phase-2 wasm
// integration and will fire dead-code warnings until then. Re-enable once
// wasmtime is wired up.
#![allow(dead_code)]

mod cli;
mod dispatch;
mod error;
mod extension;
mod host_rpc;
mod lifecycle;
mod permissions;
mod rpc;
mod state;
mod streams;
mod surfaces;
mod wasm;

use anyhow::Result;
use tracing_subscriber::EnvFilter;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<()> {
    // Logs go to stderr; stdin/stdout are reserved for JSON-RPC.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(EnvFilter::try_from_env("OXP_LOG").unwrap_or_else(|_| EnvFilter::new("info")))
        .with_target(false)
        .init();

    let args = cli::Args::parse();
    tracing::info!(host = %args.host, rpc = %args.rpc, "oxp-runtime starting");

    let state = state::RuntimeState::new();
    rpc::serve_stdio(state).await
}
