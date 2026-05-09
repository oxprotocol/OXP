# oxp.nvim

Neovim host adapter for [OXP](https://oxprotocol.org) — the Open Extension Protocol.

This plugin spawns the standalone `oxp-runtime` binary (Rust + wasmtime) and
speaks the JSON-RPC 2.0 protocol defined in
[`spec/v1/host-runtime-rpc.md`](../../spec/v1/host-runtime-rpc.md). One OXP
extension `.wasm` runs unmodified across Neovim, VS Code, JetBrains IDEs, and
Zed.

## Status

Protocol-validation cut. Implements:

- `initialize` handshake with full Neovim capability descriptor.
- `extension/load` + `activate` + `command` + `deactivate` + `unload`.
- LSP-style `Content-Length` framing over stdio.
- Async libuv-based transport (no blocking, no extra deps).

Not yet wired (in priority order): UI surface mapping (statusline / `vim.notify`
/ `vim.ui.select` / extmarks), language-server bridge, host capability callbacks
(`fs` / `net` / `secrets` / `commands`), streams.

## Install

The plugin is pure Lua; copy or symlink `hosts/neovim/` onto your `runtimepath`,
or with [lazy.nvim](https://github.com/folke/lazy.nvim):

```lua
{
  dir = "/abs/path/to/oxp/hosts/neovim",
  name = "oxp.nvim",
  config = function()
    require("oxp").setup({
      runtime = "/abs/path/to/oxp/runtime/target/release/oxp-runtime",
      log_level = "info",
    })
  end,
}
```

You also need the runtime binary. From the repo root:

```sh
cd runtime && cargo build --release
```

## Usage

```lua
local oxp = require("oxp")

oxp.install("/path/to/extension.wasm", {
  extension_id = "@publisher/slug",
  version = "0.1.0",
  surfaces_required = { "ui.statusBar" },
  on_ready = function(instance_id, err)
    if err then return end
    oxp.command(instance_id, "hello.greet", { name = "world" })
  end,
})
```

## Smoke test

From the repo root:

```sh
cd runtime && cargo build
cd ../examples/hello-rust && cargo build --target wasm32-wasip2 --release
cd ../..
nvim --headless --clean -u hosts/neovim/scripts/smoke_init.lua +qa
```

Expected: process exits 0 and the last line on stdout is `SMOKE OK`.

## Files

| Path | Purpose |
|---|---|
| [lua/oxp/init.lua](lua/oxp/init.lua) | Plugin module — transport, framing, public API. |
| [scripts/smoke_init.lua](scripts/smoke_init.lua) | End-to-end test harness. |
