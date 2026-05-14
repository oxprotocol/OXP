import type { DocSection } from "../docs";

export const techniquesDocs: DocSection[] = [
  {
    slug: "mcp-integration",
    title: "Managing MCP Servers",
    category: "Techniques",
    summary: "Install MCP servers once and OXP automatically configures every AI-aware IDE and client on your machine — with built-in reachability verification and rollback.",
    body: `## OXP as a Universal MCP Router

OXP is not just an extension protocol — it is the fastest way to wire MCP servers into every AI-aware IDE on your machine simultaneously.

Instead of editing JSON config files for VS Code, Cursor, Windsurf, and Claude Desktop separately, you run one command and OXP injects the server configuration into all of them automatically.

\`\`\`bash
oxp install @modelcontextprotocol/server-github
\`\`\`

That single command:

1. Fetches the server spec from the OXP registry
2. Detects every installed AI client (VS Code, VS Code Insiders, Cursor, Windsurf, Claude Desktop)
3. Merges the launcher entry into each client's config file, atomically
4. Probes the server with a live MCP \`initialize\` handshake and reports reachability

Sample output:

\`\`\`
✓ MCP install: @modelcontextprotocol/server-github
  launcher: npx -y @modelcontextprotocol/server-github
  clients:
    - Claude Desktop        — installed ✓
    - Cursor                — installed ✓
    - VS Code (Copilot)     — installed ✓
  verified reachable ✓
  restart the affected client(s) to load the new server.
  log: ~/.oxp/logs/mcp-install.jsonl
\`\`\`

---

## Installing MCP Servers

### From the OXP Registry

\`\`\`bash
oxp install @modelcontextprotocol/server-github
oxp install @modelcontextprotocol/server-filesystem
oxp install @upstash/context7-mcp
\`\`\`

### From a deep link

\`\`\`bash
oxp install --from oxp://mcp/github
\`\`\`

### Browse the full library

Open the [MCP Library](/mcp) in your browser and click **Install** on any server.

---

## How Auto-Injection Works

OXP writes the server config into the standard config location each client expects. The write is atomic — a temporary file is written then renamed — so you never get a partially-written config, even if the process is interrupted.

| Client | Config file |
|---|---|
| Claude Desktop | \`~/Library/Application Support/Claude/claude_desktop_config.json\` (macOS) |
| Cursor | \`~/.cursor/mcp.json\` |
| VS Code (Copilot) | \`~/Library/Application Support/Code/User/mcp.json\` (macOS) |
| VS Code Insiders | \`~/Library/Application Support/Code - Insiders/User/mcp.json\` (macOS) |
| Windsurf | \`~/.codeium/windsurf/mcp_config.json\` |

On **Windows**, \`Application Support\` paths map to \`%APPDATA%\\Roaming\`. On **Linux**, they follow XDG (\`$XDG_CONFIG_HOME\` or \`~/.config/\`).

OXP only writes to a client whose parent config directory already exists — you won't get a stale config entry for a client you don't have installed.

---

## Reachability Verification

After injecting the config, OXP spawns the server process and runs a live MCP \`initialize\` handshake (8-second timeout). The result is shown inline and written to the log:

\`\`\`
  verified reachable ✓
\`\`\`

or, if something is wrong:

\`\`\`
  not reachable: timed out — server did not respond to initialize (may need credentials)
  (server is configured — check credentials or restart client)
\`\`\`

The server **is still configured** even when the probe fails — most probe failures are credential issues (the server crashes immediately when \`YOUR_API_KEY\` is missing), not installation problems. Set the required env vars in the client's settings UI after installing, then the server will start cleanly.

:::tip
Env var values that look like placeholders (\`YOUR_API_KEY\`, \`<token>\`, \`CHANGE_ME\`) are automatically stripped before the probe runs, so the probe failure message is meaningful rather than "server exited with code 1".
:::

---

## Install Logs

Every install, update, and probe operation appends a JSON line to \`~/.oxp/logs/mcp-install.jsonl\`:

\`\`\`json
{"ts":"2025-05-14T10:00:00Z","kind":"install","id":"@modelcontextprotocol/server-github","client":"claude-desktop","status":"ok"}
{"ts":"2025-05-14T10:00:00Z","kind":"install","id":"@modelcontextprotocol/server-github","client":"cursor","status":"ok"}
{"ts":"2025-05-14T10:00:00Z","kind":"probe","id":"@modelcontextprotocol/server-github","status":"reachable"}
\`\`\`

The log is append-only, written with mode 0600 in a 0700 directory — readable only by your user. It is the first place to look when something goes wrong.

---

## Removing a Server

\`\`\`bash
oxp mcp rollback @modelcontextprotocol/server-github
\`\`\`

This removes the server entry from every detected client's config file — the exact inverse of \`oxp install\`. OXP touches only the server's own key; no other config is modified or removed.

Sample output:

\`\`\`
oxp mcp rollback: @modelcontextprotocol/server-github
  ✓ removed from Claude Desktop    ~/Library/Application Support/Claude/claude_desktop_config.json
  ✓ removed from Cursor            ~/.cursor/mcp.json
  · VS Code (Copilot) — not configured
  restart the affected client(s) to apply the change.
  log: ~/.oxp/logs/mcp-install.jsonl
\`\`\`

Use \`--json\` for machine-readable output (useful in scripts):

\`\`\`bash
oxp mcp rollback @modelcontextprotocol/server-github --json
\`\`\`

---

## Checking Server Health

### oxp doctor — MCP section

\`oxp doctor\` includes a dedicated MCP section. It reads every detected client's config, deduplicates server specs by launcher command, and probes each unique server in parallel (bounded at 8 s per server):

\`\`\`
MCP servers:
  Claude Desktop  (~/Library/Application Support/Claude/claude_desktop_config.json)
    • server-github                  reachable ✓
    • server-filesystem              not reachable — timed out (may need credentials)
  Cursor  (~/.cursor/mcp.json)
    • server-github                  reachable ✓
\`\`\`

\`\`\`bash
oxp doctor         # human-readable with MCP section
oxp doctor --json  # machine-readable; includes a top-level \`mcp\` array
\`\`\`

The \`--json\` output shape for the MCP section:

\`\`\`json
{
  "mcp": [
    {
      "id": "claude-desktop",
      "name": "Claude Desktop",
      "configPath": "~/Library/Application Support/Claude/claude_desktop_config.json",
      "servers": [
        { "slug": "server-github", "command": "npx", "args": [...], "reachable": true }
      ]
    }
  ]
}
\`\`\`

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Server installed but not appearing in client | Client needs restart | Restart the IDE or Claude Desktop |
| \`not reachable: command not found: npx\` | npx not on PATH | Ensure Node.js is installed; some clients don't inherit the full shell PATH |
| \`not reachable: timed out\` | Server needs credentials | Set required env vars in the client's MCP settings UI |
| Re-running install shows "skipped (already configured)" | Entry already identical | This is correct — OXP is idempotent. No action needed. |
| Rollback skipped one client | Client not detected | The client's config parent directory must exist for detection to work |
`,
  },
  {
    slug: "rust-extensions",
    title: "Rust Extensions",
    category: "Techniques",
    summary: "Build high-performance WASI component extensions in Rust with full type safety.",
    body: `Rust is the **recommended language** for OXP extensions that need logic beyond declarative UI. The toolchain is mature, the output is tiny, and you get the full safety guarantees of the WASI Component Model sandbox.

## Prerequisites

\`\`\`bash
rustup target add wasm32-wasip2
\`\`\`

## Scaffold a Rust Extension

\`\`\`bash
oxp create -t hello-rust my-rust-ext
cd my-rust-ext
\`\`\`

This creates:

\`\`\`
my-rust-ext/
├── Cargo.toml
├── build.rs
├── src/
│   └── lib.rs
├── wit/
│   ├── oxp-host.wit
│   └── oxp-extension.wit
└── oxp.json
\`\`\`

## Cargo Configuration

\`\`\`toml
[package]
name = "my-rust-ext"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.36"

[profile.release]
opt-level = "s"
lto = true
strip = true
codegen-units = 1
\`\`\`

Key points:

- **\`crate-type = ["cdylib"]\`** — produces a dynamic library, which is what \`wasm32-wasip2\` needs
- **\`wit-bindgen\`** — generates Rust bindings from the WIT contracts
- **Release profile** — optimized for small binary size

## Implementing the Extension

\`\`\`rust
wit_bindgen::generate!({
    world: "extension",
    path: "wit",
    generate_all,
});

use exports::oxp::extension::lifecycle::{ActivateCtx, Guest as LifecycleGuest};
use exports::oxp::extension::ui_handler::{EventError, Guest as UiHandlerGuest};
use exports::oxp::extension::command_handler::Guest as CommandHandlerGuest;
use oxp::host::log::{log, Level};

struct Component;

impl LifecycleGuest for Component {
    fn activate(ctx: ActivateCtx) -> Result<(), String> {
        log(Level::Info, &format!(
            "hello from {} v{} on {}",
            ctx.extension_id, ctx.version, ctx.host
        ));
        Ok(())
    }

    fn deactivate() -> Result<(), String> {
        log(Level::Info, "goodbye");
        Ok(())
    }
}

impl UiHandlerGuest for Component {
    fn on_event(_event: Vec<u8>) -> Result<(), EventError> {
        Ok(())
    }
}

impl CommandHandlerGuest for Component {
    fn on_command(id: String, _args_json: String) -> Result<String, String> {
        Ok(format!("\\"unhandled:{}\\"", id))
    }
}

export!(Component);
\`\`\`

Your extension must implement three traits:

- **\`LifecycleGuest\`** — \`activate()\` and \`deactivate()\`
- **\`UiHandlerGuest\`** — \`on_event()\` for UI interactions
- **\`CommandHandlerGuest\`** — \`on_command()\` for command palette actions

## Available Host Imports

Inside your Rust extension, you can call host capabilities:

\`\`\`rust
use oxp::host::log::{log, Level};
use oxp::host::storage::{get, set, delete};
use oxp::host::ui::{render, notify, set_status};
use oxp::host::fs::{read_file, write_file};  // requires fs.read/fs.write permission
use oxp::host::net::fetch;                    // requires net.fetch permission
\`\`\`

## Build and Pack

\`\`\`bash
cargo build --release --target wasm32-wasip2
mkdir -p build
cp target/wasm32-wasip2/release/my_rust_ext.wasm build/
oxp pack
\`\`\`

## Manifest for Rust Extensions

\`\`\`json
{
  "specVersion": "1",
  "kind": "component-v1",
  "id": "@yourname/my-rust-ext",
  "publisher": "yourname",
  "version": "0.1.0",
  "displayName": "My Rust Extension",
  "license": "MIT",
  "engines": { "oxp": "^1.0.0" },
  "main": { "wasm": "build/my_rust_ext.wasm" },
  "wit": {
    "package": "oxp:extension",
    "version": "0.1.0",
    "sha256": "<computed-by-oxp-create>"
  },
  "permissions": []
}
\`\`\`

The \`wit.sha256\` is automatically set by \`oxp create\` — it's the SHA-256 of the canonical WIT world this CLI was built against.`,
  },
  {
    slug: "declarative-ui",
    title: "Declarative UI",
    category: "Techniques",
    summary: "Build entire extension UIs without code using the oxp-ui-v1 declarative tree format.",
    body: `The \`hello-tree\` template lets you build complete extension UIs **without any executable code**. The UI is defined as a JSON tree of \`@oxprotocol/ui\` components. This is the safest possible extension type — no JS, no Wasm, no attack surface beyond the tree data.

## Create a Declarative Extension

\`\`\`bash
oxp create -t hello-tree my-tree-ext
cd my-tree-ext
\`\`\`

## The Tree File

Instead of \`ui/index.html\`, a \`hello-tree\` extension has a \`ui/tree.json\`:

\`\`\`json
{
  "kind": "stack",
  "gap": 3,
  "children": [
    { "kind": "text", "value": "Hello from OXP", "variant": "heading" },
    { "kind": "text", "value": "This entire UI is declarative JSON. No code." },
    {
      "kind": "stack",
      "axis": "horizontal",
      "gap": 2,
      "children": [
        { "kind": "button", "label": "Action A", "action": "a", "variant": "primary" },
        { "kind": "button", "label": "Action B", "action": "b", "variant": "secondary" }
      ]
    },
    {
      "kind": "code",
      "value": "console.log('rendered by the host');",
      "language": "js"
    }
  ]
}
\`\`\`

## Security Guarantees

Declarative \`ui-v1\` bundles are validated by \`assertBundlePolicy\` at both CLI pack time and registry upload:

- **No \`.js\`, \`.mjs\`, \`.cjs\`, \`.jsx\`, \`.ts\`, \`.tsx\` files allowed**
- **No \`.wasm\`, \`.sh\`, \`.exe\`, \`.dll\`, \`.so\`, \`.dylib\` files allowed**
- **The JSON tree is validated against the \`oxp-ui-v1\` schema**

This makes \`ui-v1\` extensions safe to install from _any_ publisher — there is no code execution path.

## When to Use Declarative UI

Use declarative UI when:

- Your extension displays static or configuration-driven content
- You want maximum trust from users (no code = no risk)
- The UI is simple enough to express as a component tree
- You want the fastest possible install (no Wasm compilation)

Move to \`component-v1\` (Rust) when you need:

- Dynamic data from APIs
- Complex state management
- File system operations
- Custom business logic`,
  },
  {
    slug: "dev-workflow",
    title: "Development Workflow",
    category: "Techniques",
    summary:
      "Master oxp dev: automatic Extension Development Host, hot-reload, and the full development loop.",
    body: `\`oxp dev\` is your primary development tool. **You run one command** — the CLI packs your extension, spawns a fresh **Extension Development Host (EDH)** window of your IDE, attaches it to the dev session, and starts watching files. Save anything → re-pack → live reload. No "attach" command. No WebSocket URL to remember. No configuration.

## Starting a Dev Session

\`\`\`bash
oxp dev                    # default: open the IDE you ran it from
oxp dev --host vscode      # force a specific host family
oxp dev --host jetbrains   # spawn an IntelliJ-family EDH
oxp dev ./my-ext           # explicit project directory
oxp dev --port 8080        # custom dev-server port (default 7373)
\`\`\`

The CLI auto-detects your IDE family from \`$TERM_PROGRAM\`, \`$VSCODE_PID\`, or by walking up the process tree. Pass \`--host\` to override.

## What Happens, In Order

1. **Initial build** — the project is packed once. Schema validation and policy checks run; failures abort before any window opens.
2. **Dev server up** — an HTTP + WebSocket server binds on \`localhost:7373\` (or \`--port\`).
3. **EDH spawn** — the CLI writes an autostart marker (\`$OXP_HOME/edh/autostart.json\`) and launches a new IDE window with the marker workspace. The host extension reads the marker on activation and attaches automatically.
4. **Native render** — your extension appears in the OXP **activity-bar icon → sidebar view**. UI panels, commands, status-bar items, and registered MCP servers are all live.
5. **Watch + reload** — chokidar watches the project (ignoring \`.git\`, \`node_modules\`, \`dist/*.oxp\`, \`.next\`, \`target\`). On any change, debounced 100 ms, the bundle is re-packed and pushed to the EDH over WebSocket. The host disposes the previous instance and re-instantiates the new one in place — no window reload needed.
6. **End session** — press \`Ctrl+C\` in the terminal. The dev server shuts down, the EDH window closes itself, and the autostart marker is cleared.

## The Status Bar

Every connected host shows a session indicator in the status bar:

| Indicator | Meaning |
|---|---|
| \`$(plug) OXP Dev\` | Connected, idle |
| \`$(sync~spin) OXP Dev\` | Re-pack in progress |
| \`$(check) OXP Dev · v0.1.2\` | Last reload succeeded, shows packed version |
| \`$(error) OXP Dev\` | Last pack failed — click to open the output channel |

Click the status item to focus the **OXP Dev Host** output channel.

## The Output Channel

A dedicated output channel — **OXP Dev Host** in VS Code, **OXP Dev Host** tool window in JetBrains — streams every event:

\`\`\`
[12:04:01.022] pack ok · 184 KB · sha256:a1b2c3…
[12:04:01.041] reload → 1 client(s) connected
[12:04:18.503] file changed · src/panel.tsx
[12:04:18.612] pack failed · TS2304: Cannot find name 'Foo'
\`\`\`

This is the first place to look when something behaves unexpectedly.

## The Error Boundary

Runtime errors inside your extension are caught by the host's error boundary and surfaced in the sidebar as a structured panel:

- Error message and stack
- Manifest version and bundle digest
- A **Restart** button that re-instantiates the extension without losing your dev session

If a pack fails, the **previous good bundle remains loaded** — you keep working with the last-known-good version until your next save succeeds.

## Hot Reload Semantics

Hot reload **re-instantiates** your extension — it does not preserve in-memory state. If you want stateful reloads, write your state to disk via the \`storage/*\` capability and re-hydrate on activation.

UI panels keep their scroll position and form values across reloads when their \`id\` is stable.

## Endpoints (for tooling)

The dev server exposes a small HTTP/WS API. You generally don't touch these directly — the host adapter does — but they're useful for custom tooling:

| Endpoint | Method | Response |
|---|---|---|
| \`ws://localhost:7373/dev\` | WebSocket | JSON reload messages |
| \`http://localhost:7373/info\` | GET | Manifest, digest, bundle size |
| \`http://localhost:7373/manifest\` | GET | Raw oxp.json |
| \`http://localhost:7373/bundle\` | GET | Raw .oxp bytes |

## Signature Bypass in Dev

:::warning
Dev mode skips Ed25519 signing for speed. The EDH paints a **"DEV: signature bypass"** badge in the sidebar header for the entire session. The production \`oxp publish\` flow is unchanged — every published bundle is signed and verified.
:::

## VS Code Family vs JetBrains

| Behavior | VS Code / Cursor / Windsurf / VSCodium | JetBrains (IDEA / PyCharm / WebStorm / …) |
|---|---|---|
| EDH spawn mechanism | \`code --new-window <marker-workspace>\` | \`idea --line 1 <marker-workspace>\` via runtime-bin launcher |
| Sidebar location | Activity bar, \`OXP\` icon | Right tool window, \`OXP\` stripe button |
| Output channel name | \`OXP Dev Host\` (Output panel) | \`OXP Dev Host\` (Run tool window) |
| Hot-reload mechanism | WebSocket → \`Extension.dispose()\` + re-instantiate | WebSocket → coroutine cancel + re-instantiate |

The wire protocol is identical. The same \`.oxp\` bundle, the same WIT contract, the same host calls.

## Common Patterns

- **Multiple IDEs at once** — start \`oxp dev\` in one terminal, then run \`oxp dev attach --host jetbrains\` in another. Both EDHs reload from the same dev server.
- **Network dev server** — use \`--bind 0.0.0.0\` and \`--port 7373\` to attach a remote host (e.g. a JetBrains EDH on another machine).
- **Pack-only mode** — run \`oxp dev --no-spawn\` if you want the server but want to attach the EDH yourself with \`oxp dev attach\`.
- **Recovering a stuck session** — \`oxp dev clean\` removes \`$OXP_HOME/edh/autostart.json\` if a window was force-closed and refuses to re-attach.

## Next Steps

- [Extension Development Host](/docs/edh) — full reference for the EDH window: chrome, commands, output channel.
- [Publishing](/docs/publishing) — when you're ready to ship.`,
  },
  {
    slug: "edh",
    title: "Extension Development Host",
    category: "Techniques",
    summary:
      "The EDH window: how oxp dev spawns it, its chrome, commands, output channel, error boundary, and lifecycle.",
    body: `The **Extension Development Host (EDH)** is the IDE window in which your in-development extension runs. It is a real, full-fidelity instance of your IDE — VS Code, Cursor, Windsurf, VSCodium, or any IntelliJ-family product — with the OXP host adapter loaded and your extension auto-attached to the running dev session.

You never spawn the EDH manually. \`oxp dev\` does it for you.

## Why a Separate Window?

Running your extension in the same window where you edit its source has historically been the standard "F5" experience — but it has real costs:

- **State pollution** — your dev environment (open files, debug sessions) collides with your extension's runtime state.
- **Crash blast radius** — a bug in your extension can take down your editor.
- **Indistinguishable bundles** — it's hard to tell what version of your extension is running.

The OXP EDH puts your extension in its own pristine window, with its own activity-bar icon, its own permissions, and a loud header indicating it's a dev session. Your source window stays untouched.

## Automatic Spawn

When you run \`oxp dev\`:

1. The CLI packs your extension.
2. It writes an **autostart marker** to \`$OXP_HOME/edh/autostart.json\` (default \`~/.oxp/edh/autostart.json\`). The marker contains: dev-server URL, project path, IDE family, host PID, and an expiry timestamp.
3. It launches the IDE with a clean workspace (no folder, no SCM context). Example: \`code --new-window /tmp/oxp-edh-<sessionId>\`.
4. The OXP host extension activates in the new window, reads the marker (only if its expiry is fresh and PID is alive), and **connects to the dev server immediately**. No command palette step. No prompt.
5. Your extension renders in the sidebar.

If the marker is missing or expired, the new window starts as a normal editor — no auto-attach. Run \`oxp dev clean\` to clear stale markers.

## Anatomy of an EDH Window

\`\`\`
┌──────────────────────────────────────────────────────────────────┐
│ File  Edit  …                                  OXP Dev (v0.1.2) │ ← title bar tag
├───┬──────────────────────────────────────────────────────────────┤
│ ⓘ │   Your extension's sidebar view                              │
│ 🔍│   ─────────────────────────────                              │
│ 📦│   DEV: signature bypass                                      │ ← header chip
│ ▶ │                                                              │
│ 🅾 │ ◄── OXP activity-bar icon (clicked, sidebar visible)         │
│   │                                                              │
├───┴──────────────────────────────────────────────────────────────┤
│ $(plug) OXP Dev · v0.1.2 · session 4f3a   …other status items…  │ ← status bar
└──────────────────────────────────────────────────────────────────┘
\`\`\`

Key elements:

- **Activity-bar / tool-window icon** — labelled \`OXP\`. The host adds it the moment a dev session attaches.
- **Sidebar view** — renders \`oxp-ui-v1\` or \`hybrid-v1\` UI natively. For \`webview-v1\`, an isolated webview iframe is mounted here.
- **DEV chip** — always visible in dev mode; the production install path never shows this.
- **Status bar / status widget** — connection state, session id, packed version (see [Development Workflow](/docs/dev-workflow#the-status-bar) for the icon legend).
- **Title-bar suffix** — \`OXP Dev (vX.Y.Z)\` so you can tell EDH windows apart at a glance.

## Command Palette

The EDH exposes a small set of commands under the \`OXP:\` prefix:

| Command | What it does |
|---|---|
| **OXP: Restart Dev Session** | Disposes the extension, reconnects to the dev server, re-loads the latest bundle |
| **OXP: Reload Bundle** | Asks the dev server for the current bundle and re-instantiates without reconnecting |
| **OXP: Open Output (Dev Host)** | Focuses the **OXP Dev Host** output channel |
| **OXP: Show Manifest** | Opens the active bundle's \`oxp.json\` read-only |
| **OXP: Show Bundle Info** | Pops a modal with digest, size, signedBy (or \`unsigned (dev)\`), packed-at timestamp |
| **OXP: Detach Dev Session** | Disconnects but leaves the window open; useful for inspecting the last-known state |

In JetBrains hosts, the same commands are reachable via **Help → Find Action** (\`Ctrl/Cmd+Shift+A\`).

## Output Channel

The **OXP Dev Host** channel logs everything: file events, pack results, reload pushes, RPC call traces (at info level), and unhandled errors.

In VS Code family: **View → Output → OXP Dev Host**.
In JetBrains: **OXP Dev Host** tool window (bottom dock).

Set \`OXP_LOG=debug\` before \`oxp dev\` to include per-RPC tracing.

## Error Boundary

Every host call (\`storage/*\`, \`http/*\`, \`editor/*\`, …) is wrapped in an error boundary on the host side. When your extension throws:

1. The boundary catches the error and serializes it (message, stack, RPC method, args).
2. The sidebar view switches to an **error panel** showing the structured failure.
3. The status bar turns red: \`$(error) OXP Dev\`.
4. The error is appended to the output channel.
5. A **Restart** button re-instantiates the extension without restarting the IDE.

The host extension itself never crashes. The blast radius of a misbehaving extension is exactly one sidebar view.

## Hot Reload

When the dev server pushes a new bundle:

1. The host receives the WebSocket \`reload\` message.
2. The current extension instance's \`dispose()\` is awaited (up to 2 s).
3. The new bundle is verified (digest match, manifest schema, policy).
4. A new instance is constructed; \`activate()\` is invoked.
5. The sidebar is re-rendered in place.

Total time, typical: **100–250 ms** from save to visible update.

State across reload: UI form values and scroll positions are preserved for views with stable \`id\`s. In-memory JS variables are **not** — persist them through \`storage/*\` if you need durability.

## Ending the Session

Press \`Ctrl+C\` in the terminal where \`oxp dev\` is running. The CLI:

1. Sends a \`shutdown\` frame to every connected host.
2. The EDH window dismisses its sidebar, removes the activity-bar icon, and closes itself.
3. The dev server stops listening.
4. The autostart marker is deleted.

You can also use **OXP: Detach Dev Session** in the EDH if you want the window to stay open after the server stops — the extension stays loaded as a frozen snapshot of the last bundle (useful for screenshots).

## VS Code Family vs JetBrains

| Aspect | VS Code / Cursor / Windsurf / VSCodium | JetBrains (any IntelliJ-Platform IDE) |
|---|---|---|
| Window launch | \`code --new-window\` (or \`cursor\`, \`windsurf\`, \`codium\`) | \`idea\` / \`pycharm\` / \`webstorm\` / … via \`runtime-bin/\` launcher |
| Sidebar | Activity bar, OXP icon | Right tool window, OXP stripe button |
| Detach gesture | Close window or \`OXP: Detach Dev Session\` | Close window or **Tools → OXP → Detach** |
| Output | Output panel, \`OXP Dev Host\` channel | Tool window, \`OXP Dev Host\` |
| Restart shortcut | Command palette → **OXP: Restart Dev Session** | Find Action → **OXP: Restart Dev Session** |

The contract is identical. Bundle, manifest, signature, WIT pin, RPC calls — all bit-equivalent across families.

## Troubleshooting

- **Window opened but extension didn't appear** — check the **OXP Dev Host** output channel. Most often a pack/validation error.
- **EDH won't attach** — run \`oxp dev clean\` and start again. A stale autostart marker can block re-attach.
- **Wrong IDE launched** — pass \`--host vscode\` or \`--host jetbrains\` explicitly.
- **Port in use** — \`oxp dev --port 8080\` (or set \`OXP_DEV_PORT\`).
- **Auto-detected wrong launcher** (e.g. \`code\` instead of \`cursor\`) — set \`OXP_IDE_LAUNCHER=cursor\` in your shell environment.

## Next Steps

- [Development Workflow](/docs/dev-workflow) — the surrounding loop.
- [Publishing](/docs/publishing) — graduate from EDH to the real registry.`,
  },
  {
    slug: "publishing",
    title: "Publishing Extensions",
    category: "Techniques",
    summary: "The complete publish pipeline: login, pack, sign, publish, and token management.",
    body: `Publishing an OXP extension involves four steps: authenticate, generate a signing key, pack the bundle, and upload. Every bundle is cryptographically signed and verified end-to-end.

## Step 1: Authenticate

\`\`\`bash
oxp login                   # email + password in the terminal
oxp login --browser          # OAuth device flow via the browser
\`\`\`

The terminal login flow works like Expo — type your email and password directly. The browser flow generates a short code you enter on the web, then the CLI polls until authorized.

Tokens are stored at \`~/.oxp/credentials\` (mode 0600).

## Step 2: Generate a Signing Key

\`\`\`bash
oxp keygen
# → ed25519:0xABCD1234...
\`\`\`

This creates an Ed25519 keypair at \`~/.oxp/keys/\` and prints the public key ID. The public key is registered with the registry on your first publish.

## Step 3: Pack the Bundle

\`\`\`bash
oxp pack
# → dist/my-ext-0.1.0.oxp (sha256:a1b2c3...)
\`\`\`

\`oxp pack\` does the following:

1. **Validates** \`oxp.json\` against the JSON Schema
2. **Enforces** bundle policy (no code in \`ui-v1\`, WIT pin check for \`component-v1\`)
3. **Packs** into a deterministic tar+zstd archive
4. **Hashes** the uncompressed tar → bundle digest
5. **Signs** with your Ed25519 key
6. **Writes** \`dist/<slug>-<version>.oxp\`

## Step 4: Publish

\`\`\`bash
oxp publish
# or
oxp publish dist/my-ext-0.1.0.oxp
\`\`\`

The registry:

1. **Authenticates** your token and checks scope (\`publish:@handle/*\` or per-package)
2. **Re-validates** the manifest and bundle policy server-side
3. **Verifies** the WIT pin matches the server's world (for component bundles)
4. **Checks** TOFU key pinning — if you've published before, the key must match
5. **Stores** the bundle, manifest, and signature
6. **Returns** the published version details

## Token Management

### Scoped Tokens

Publish tokens are scoped. You can create tokens that only allow publishing to specific packages:

- \`publish:@acme/*\` — publish any package under @acme
- \`publish:@acme/specific-ext\` — publish only @acme/specific-ext
- \`publish:*\` — publish anything (admin, legacy)

### Token Rotation

\`\`\`bash
oxp token rotate [--days 90] [--name "CI token"] [--scope "publish:@acme/*"]
\`\`\`

Rotation mints a successor token, retires the old one with a 5-minute grace window (so in-flight publishes finish), and atomically updates \`~/.oxp/credentials\`.

### Default Expiry

Tokens expire after **90 days** by default. Use \`--days N\` to customize.

## TOFU Key Pinning

On your first publish, the registry pins your Ed25519 public key to your publisher handle. Subsequent publishes must use the same key. If you need to rotate your signing key, follow the key rotation flow (requires re-authentication).

The host also maintains a local TOFU store at \`~/.oxp/trust.json\`. If a known publisher suddenly publishes with a different key, installation is blocked with a \`KEY_PINNING_VIOLATION\` error.

## Versioning Strategy

OXP uses strict **semver 2.0.0**. The registry enforces:

- Versions must be valid semver
- Versions cannot be re-published (immutable)
- Yanked versions can be marked but not deleted`,
  },
];
