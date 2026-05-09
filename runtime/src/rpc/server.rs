//! Stdio JSON-RPC server. Owns the reader loop and the outbound writer.
//!
//! Inbound messages are parsed on the read task and dispatched via
//! [`crate::dispatch`]. Outbound messages (responses and runtime-initiated
//! requests/notifications) are funneled through an mpsc channel to a single
//! writer task — guaranteeing serialized framing on stdout.

use anyhow::Result;
use serde_json::Value;
use tokio::io::{stdin, stdout};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::codec::{FrameReader, write_frame};
use super::message::{Inbound, Response};
use crate::dispatch::Dispatcher;
use crate::state::RuntimeState;

/// One outbound payload. Either a serialized JSON value (response or
/// runtime-initiated message) or a shutdown signal.
pub enum Outbound {
    Json(Value),
    Shutdown,
}

pub async fn serve_stdio(state: RuntimeState) -> Result<()> {
    let (tx, mut rx) = mpsc::channel::<Outbound>(64);
    let dispatcher = Dispatcher::new(state, tx.clone());

    // Writer task — single owner of stdout.
    let writer = tokio::spawn(async move {
        let mut out = stdout();
        while let Some(msg) = rx.recv().await {
            match msg {
                Outbound::Json(v) => {
                    let body = match serde_json::to_vec(&v) {
                        Ok(b) => b,
                        Err(e) => {
                            tracing::error!(error=%e, "failed to serialize outbound message");
                            continue;
                        }
                    };
                    if let Err(e) = write_frame(&mut out, &body).await {
                        tracing::error!(error=%e, "stdout write failed; exiting writer");
                        break;
                    }
                }
                Outbound::Shutdown => break,
            }
        }
    });

    // Reader loop — owns stdin. Spawned handlers are tracked in a JoinSet
    // so we can drain them before tearing down the writer.
    let mut reader = FrameReader::new(stdin());
    let mut handlers: JoinSet<()> = JoinSet::new();
    loop {
        tokio::select! {
            biased;

            // Reap completed handlers as they finish so the JoinSet doesn't
            // grow unbounded under load.
            Some(_) = handlers.join_next(), if !handlers.is_empty() => {}

            frame = reader.read_frame() => {
                match frame {
                    Ok(Some(bytes)) => {
                        spawn_handler(&mut handlers, &dispatcher, &tx, bytes);
                        if dispatcher.should_exit() {
                            tracing::info!("exit requested; closing reader");
                            break;
                        }
                    }
                    Ok(None) => {
                        tracing::info!("stdin closed; draining handlers");
                        break;
                    }
                    Err(e) => {
                        tracing::error!(error=%e, "stdin read error; draining handlers");
                        break;
                    }
                }
            }
        }
    }

    // Drain in-flight handlers so their responses make it to stdout.
    while let Some(res) = handlers.join_next().await {
        if let Err(e) = res {
            tracing::warn!(error=%e, "handler task panicked");
        }
    }

    let _ = tx.send(Outbound::Shutdown).await;
    drop(tx);
    let _ = writer.await;
    Ok(())
}

fn spawn_handler(
    handlers: &mut JoinSet<()>,
    dispatcher: &Dispatcher,
    tx: &mpsc::Sender<Outbound>,
    frame: Vec<u8>,
) {
    let dispatcher = dispatcher.clone();
    let tx = tx.clone();
    handlers.spawn(async move {
        let parsed = Inbound::parse(&frame);
        match parsed {
            Ok(Inbound::Request(req)) => {
                let id = req.id.clone();
                let response = match dispatcher.handle_request(&req).await {
                    Ok(value) => Response { jsonrpc: "2.0", id, result: Some(value), error: None },
                    Err(err) => Response { jsonrpc: "2.0", id, result: None, error: Some(err) },
                };
                let value = serde_json::to_value(&response).expect("Response is always serializable");
                let _ = tx.send(Outbound::Json(value)).await;
            }
            Ok(Inbound::Notification(note)) => {
                if let Err(e) = dispatcher.handle_notification(&note).await {
                    tracing::warn!(method = %note.method, error = ?e, "notification handler failed");
                }
            }
            Ok(Inbound::Response(resp)) => {
                dispatcher.handle_inbound_response(resp).await;
            }
            Err(err) => {
                let response = Response { jsonrpc: "2.0", id: Value::Null, result: None, error: Some(err) };
                let value = serde_json::to_value(&response).expect("Response is always serializable");
                let _ = tx.send(Outbound::Json(value)).await;
            }
        }
    });
}
