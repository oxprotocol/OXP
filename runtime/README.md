# oxp-runtime

Standalone wasm component runtime for OXP extensions.

- Spec: [`spec/v1/host-runtime-rpc.md`](../spec/v1/host-runtime-rpc.md)
- Transport: JSON-RPC 2.0 over stdio with LSP-style `Content-Length` framing.
- Spawned by every IDE host plugin (vscode / jetbrains / zed / neovim / piye / cli).
- One process per IDE window. Many extensions per process.

## Build

```bash
cd runtime
cargo build --release
./target/release/oxp-runtime --host vscode --rpc stdio
```

## Status

Phase 1 (current): RPC framing, lifecycle handshake, capability negotiation,
error model. No wasmtime integration yet — `extension/load` returns
`CAPABILITY_UNSUPPORTED` with `data.reason = "not-implemented"`.

Phase 2: wasmtime + WIT component loading + `oxp:host/*` import linkage.

Phase 3: bundle verification (signature, sha-pinned world, manifest schema).

Phase 4: per-host plugins (jetbrains, zed, neovim) consuming this binary.
