# OXP Quickstart

Build a sandboxed `.wasm` extension once, run it in **VS Code** _and_
**JetBrains** IDEs (IntelliJ, PyCharm, WebStorm, GoLand, Rider, RustRover,
CLion, DataGrip) without recompiling.

This guide takes ~10 minutes.

---

## 1. Install the OXP host adapter

The host adapter is what makes your IDE aware of OXP extensions. It is
available on all major marketplaces.

### VS Code / Cursor / Windsurf / VSCodium

Search **"OXP"** in the Extensions view (Ctrl+Shift+X), or install from
the terminal:

```bash
code --install-extension oxprotocol.oxp-vscode
```

### JetBrains (IntelliJ, PyCharm, WebStorm, GoLand, Rider, CLion, …)

**Settings** → **Plugins** → **Marketplace** → search **"OXP"** → Install → restart.

> **Alternative:** if you have the `oxp` CLI installed, running
> `oxp install @any/extension` will auto-install the host adapter for you
> when it is not already present.

---

## 2. Scaffold an extension

You need a recent Rust toolchain (`rustup`) and Node ≥ 22.

```bash
# Add the wasm component target once.
rustup target add wasm32-wasip2

# Scaffold a starter project.
npx @oxprotocol/create-oxp my-ext --template hello-rust
cd my-ext

# Build the .wasm component.
cargo build --release --target wasm32-wasip2
```

The compiled artifact lands at:

```
target/wasm32-wasip2/release/my_ext.wasm
```

---

## 3. Install into your IDE from a local file

Use the CLI to install directly from the built `.wasm` file:

```bash
oxp install-url file://$(pwd)/target/wasm32-wasip2/release/my_ext.wasm
```

The CLI auto-detects your installed IDEs, installs the OXP host adapter if
needed, and loads your extension. Approve the permission prompt that appears.

> For remote distribution later, host the `.wasm` at any `https://` URL and
> swap the `file://` path. `http://` is only allowed for `localhost` / `127.0.0.1`.

### Verify it loaded

- **VS Code / Cursor / Windsurf**: **Cmd-Shift-P** → **OXP: Show Installed Extensions**
- **JetBrains**: Open the **OXP** tool window (right side) → **Installed** tab

---

## 4. Iterate with hot-reload

For an active development loop, use `oxp dev` instead — it watches the
project, rebuilds on every `src/lib.rs` change, and reloads the extension in
the connected IDE automatically:

```bash
oxp dev
```

The EDH (Extension Development Host) window opens automatically. Edit
`src/lib.rs`, save — the IDE picks up the new build within a second.

`oxp dev` serves the bundle over WebSocket locally; no file URL needed.

---

## What your extension can do (today)

- **Render UI** through `oxp:ui/v1` (declarative; the host renders
  HTML/components, your wasm just emits state).
- **Receive command invocations** from the host via `extension/command`.
- **Request permissions** declaratively in your `oxp.json` manifest. The
  user approves them once, before activation.

The full WIT interface lives in [`packages/wit/wit/`](packages/wit/wit/).

---

## Distributing your extension

Push the `.wasm` to any HTTPS-reachable URL — GitHub releases, S3,
your own domain. Users install it via **Install from URL…** with no
app-store gatekeeping.

For signed releases and the public registry, see [SPEC.md](SPEC.md).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not locate oxp-runtime` (JetBrains, dev only) | Set `OXP_RUNTIME=/path/to/oxp-runtime` env var, or run `bash hosts/jetbrains/scripts/stage-runtime.sh`. |
| `download failed (NOT_WASM)` | The URL didn't return a wasm component (check the magic bytes — first four are `\x00asm`). |
| `download failed (SCHEME_NOT_ALLOWED)` | `http://` is only allowed for localhost. Use `https://` or `file://`. |
| Permission dialog doesn't appear | Make sure the host extension is the latest release — older builds had an EDT bug on JetBrains. |

For more, see [AGENTS.md](AGENTS.md) and [ARCHITECTURE-WASM-PIVOT.md](ARCHITECTURE-WASM-PIVOT.md).
