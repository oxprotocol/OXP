# OXP Quickstart

Build a sandboxed `.wasm` extension once, run it in **VS Code** _and_
**JetBrains** IDEs (IntelliJ, PyCharm, WebStorm, GoLand, Rider, RustRover,
CLion, DataGrip) without recompiling.

This guide takes ~10 minutes.

---

## 1. Install the host extensions

Download the latest release artifacts from
<https://github.com/oxprotocol/oxp/releases>:

- `oxp-vscode-<version>.vsix` — VS Code host
- `oxp-jetbrains-<version>.zip` — JetBrains host (works in any 2024.3+ IDE)

### VS Code

```bash
code --install-extension oxp-vscode-0.1.0.vsix
```

Or: **Extensions** view → ⋯ menu → **Install from VSIX…** → pick the file.

### JetBrains

In any JetBrains IDE: **Settings** → **Plugins** → ⚙️ → **Install Plugin
from Disk…** → pick the `.zip` → restart.

---

## 2. Scaffold an extension

You need a recent Rust toolchain (`rustup`) and Node 20+.

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

## 3. Serve it locally

```bash
cd target/wasm32-wasip2/release
python3 -m http.server 8765
```

Leave that terminal running.

---

## 4. Install into your IDE

### VS Code

1. **Cmd-Shift-P** → **OXP: Open Runtime Panel** → **Start runtime**.
2. Click **Install from URL…** → paste:
   ```
   http://localhost:8765/my_ext.wasm
   ```
3. Approve the requested permissions in the prompt.
4. Your extension's UI appears as a new editor tab.

### JetBrains

1. Open the **OXP** tool window (right edge).
2. Click the **Runtime** tab → **Start runtime**.
3. Click **From URL…** → paste:
   ```
   http://localhost:8765/my_ext.wasm
   ```
4. Approve the requested permissions in the dialog.
5. Your extension's UI appears as a new tab in the OXP tool window.

> `http://` URLs are only allowed for `localhost` / `127.0.0.1` / `::1`.
> Any other host requires `https://`.

---

## 5. Iterate

Edit `src/lib.rs`, rebuild:

```bash
cargo build --release --target wasm32-wasip2
```

Re-paste the URL — the host re-fetches and reloads automatically.
The bundle is cached by SHA-256 under `~/.oxp/cache/url-installs/`,
so unchanged builds skip the download.

---

## What your extension can do (today)

- **Render UI** through `oxp:ui/v1` (declarative; the host renders
  HTML/components, your wasm just emits state).
- **Receive command invocations** from the host via `extension/command`.
- **Request permissions** declaratively in your `oxp.toml` manifest. The
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
