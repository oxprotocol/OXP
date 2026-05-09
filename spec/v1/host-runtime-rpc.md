# OXP Host ↔ Runtime RPC — spec v1

> Status: **review-ready** (frozen on sign-off) · Track: foundational  
> Sibling docs: [protocol.md](./protocol.md), [bundle.md](./bundle.md), [`oxp-extension.wit`](../../packages/wit/wit/oxp-extension.wit), [`oxp-host.wit`](../../packages/wit/wit/oxp-host.wit)

## Table of contents

0. [Why this exists](#0-why-this-exists)
1. [Architecture](#1-architecture)
2. [Transport & framing](#2-transport--framing)
3. [Versioning rules](#3-versioning-rules)
4. [Lifecycle](#4-lifecycle)
5. [Message catalogue — Host → Runtime](#5-message-catalogue--host--runtime)
6. [Message catalogue — Runtime → Host](#6-message-catalogue--runtime--host)
7. [Capability negotiation](#7-capability-negotiation)
8. [Surface registration & per-IDE bridge table](#8-surface-registration--per-ide-bridge-table)
9. [Pressure test: JetBrains, Zed, Neovim](#9-pressure-test-jetbrains-zed-neovim)
10. [Error model](#10-error-model)
11. [Security boundary](#11-security-boundary)
12. [Sequence diagrams](#12-sequence-diagrams)
13. [Open questions resolved for v1](#13-open-questions-resolved-for-v1)
14. [What this unlocks](#14-what-this-unlocks)

---

## 0. Why this exists

OXP extensions are WebAssembly components. Every IDE we support — VS Code, Cursor, Windsurf, VSCodium, JetBrains (IntelliJ Platform), Zed, Neovim — needs to (a) load that component, (b) honour its capability manifest, and (c) surface its commands / panels / completions through the IDE's native API.

Embedding a wasm runtime *inside* every host is impractical: JetBrains is JVM, Neovim is Lua, Zed has its own evolving extension ABI. We instead:

1. Ship **one standalone runtime binary** (`oxp-runtime`, Rust + wasmtime), per platform.
2. Define **one JSON-RPC contract** every host plugin speaks to it.
3. Make IDE plugins thin glue layers (~500–1500 LOC each).

This document **is** that contract. Any IDE that implements §5 and §6 inherits the entire OXP catalogue at zero per-extension cost. **Get this wrong and we rewrite four codebases.**

---

## 1. Architecture

```
┌─────────────────────┐     spawn / stdio     ┌──────────────────────┐
│   IDE host plugin   │ ─────────────────────▶│     oxp-runtime      │
│  (vscode, jetbrains,│ ◀──── JSON-RPC 2.0 ───│   (Rust + wasmtime)  │
│   zed, neovim, …)   │                       │                      │
└──────────┬──────────┘                       │  · loads .oxp bundle │
           │ native IDE API                   │  · verifies signature│
           ▼                                  │  · links WIT imports │
   ┌────────────────┐                         │  · runs component    │
   │   IDE itself   │                         │  · enforces caps     │
   └────────────────┘                         └──────────────────────┘
```

Key invariants:

- **One `oxp-runtime` process per IDE window.** Many extensions per process.
- **The host plugin is dumb.** It marshals RPC ↔ native IDE API. No wasm, no signature verification, no capability logic. (Security rationale in §11.)
- **Bidirectional JSON-RPC 2.0.** Either side can issue requests and notifications.

---

## 2. Transport & framing

| Concern | Choice |
|---|---|
| Channel | stdin/stdout of `oxp-runtime --host <id> --rpc stdio` |
| Framing | LSP-style: `Content-Length: <bytes>\r\n\r\n<utf8 json>` |
| Encoding | UTF-8 JSON; `application/vscode-jsonrpc; charset=utf-8` |
| Concurrency | Requests matched by `id`; both sides may have many in flight |
| stderr | Human-readable runtime logs only — never protocol |
| Binary blobs | Base64 in JSON for ≤256 KB; **stream channel** (§5.6) for larger |

Rationale: stdio framing is exactly what every IDE plugin SDK already supports for LSP. We get tooling, debuggers, and inspectors for free. Java/Kotlin LSP4J, `nvim_rpc`, Zed's LSP client, and `vscode-jsonrpc` all speak this dialect natively.

---

## 3. Versioning rules

- `protocolVersion` is the only handshake version. v1 = `"1.0"`.
- v1 method/parameter/result shapes are **frozen** on sign-off. Additions go to v1.x via `capabilities` negotiation; breakages go to v2.
- Unknown methods → JSON-RPC `-32601 Method not found`. Hosts must tolerate unknown notifications (drop silently).
- The runtime refuses to start if the host's `protocolVersion` major ≠ runtime's. **No silent downgrades.**
- The runtime refuses to load any bundle whose `manifest.runtimeRequirements.protocolVersion` is incompatible with itself.

---

## 4. Lifecycle

### 4.1 Process lifecycle

| Phase | Trigger | Notes |
|---|---|---|
| **spawn** | Host launches `oxp-runtime` | Path is sha-pinned; never PATH-resolved (§11). |
| **handshake** | Host sends `initialize` | Carries host capabilities + `hostStorePath`. |
| **ready** | Runtime returns `initialize` result | Runtime accepts `extension/load`. |
| **shutdown** | Host sends `shutdown` then `exit` | Runtime deactivates all, flushes storage, exits 0. |
| **crash** | Runtime exits non-zero | Host restarts with exponential backoff + user notification. |

### 4.2 Extension lifecycle (inside the runtime)

```
load → activate → (running: many command/event RPCs) → deactivate → unload
```

Mirrors `oxp:extension/lifecycle` in the WIT. Host drives every transition.

---

## 5. Message catalogue — Host → Runtime

> Convention: `request` = expects response; `notification` = fire-and-forget.

### 5.1 `initialize` *(request)*

```jsonc
// params
{
  "protocolVersion": "1.0",
  "host": {
    "id":       "vscode" | "cursor" | "windsurf" | "vscodium"
              | "jetbrains" | "zed" | "neovim" | "piye" | "cli",
    "version":  "1.93.0",
    "platform": "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "win32-x64" | "win32-arm64"
  },
  "capabilities": {
    "ui": {
      "webview":      true,
      "treeView":     true,
      "statusBar":    true,
      "notification": true,
      "quickPick":    true,
      "inputBox":     true
    },
    "language": {
      "completions":    true,
      "hover":          true,
      "codeLens":       true,
      "diagnostics":    true,
      "definition":     true,
      "references":     true,
      "rename":         true,
      "formatting":     true,
      "languageServer": true
    },
    "editor": {
      "buffers":     true,
      "decorations": true,
      "selection":   true,
      "virtualText": true
    },
    "fs":       { "workspaceScoped": true },
    "process":  { "spawn": false },
    "secrets":  { "store": "keychain" | "memory" | "none" },
    "debugger": { "dap": true },
    "terminal": { "create": true }
  },
  "hostStorePath": "/Users/me/.oxp/host-store"
}

// result
{
  "runtimeVersion":  "0.1.0",
  "wasmEngine":      "wasmtime-25",
  "supportedWorlds": ["oxp:extension@0.1.0"]
}
```

> **Capability negotiation is the universal-IDE contract.** A bundle requiring `ui.webview` cannot run on Neovim (`webview: false`). Runtime enforces this at load → returns `CAPABILITY_UNSUPPORTED` (§10). Host never has to fake a surface. (See §7.)

### 5.2 `extension/load` *(request)*

```jsonc
// params
{
  "extensionId": "@aldgar/hello",
  "version":     "0.1.0",
  "bundlePath":  "/Users/me/.oxp/host-store/@aldgar/hello/0.1.0",
  "permissions": [
    "fs.read:./**",
    "net.fetch:https://api.example.com/*"
  ]
}

// result
{ "instanceId": "ext-7af3", "exports": ["lifecycle","ui-handler","command-handler"] }

// errors
//  -32001 SIGNATURE_INVALID
//  -32002 WORLD_MISMATCH
//  -32003 CAPABILITY_UNSUPPORTED  (data: { missing: ["ui.webview"] })
//  -32004 PERMISSION_DENIED
//  -32007 BUNDLE_CORRUPT
```

### 5.3 `extension/activate` *(request)*

Calls the component's exported `lifecycle.activate`. Result `{ ok, reason? }`.

### 5.4 `extension/command` *(request)*

```jsonc
// params
{ "instanceId": "ext-7af3", "commandId": "hello.greet", "argsJson": "{\"name\":\"world\"}" }
// result
{ "resultJson": "\"Hello, world!\"" }
```

### 5.5 `extension/event` *(notification)*

Fire-and-forget UI/editor event. Carries opaque payload routed to `ui-handler.on-event`. Examples: button click in a webview, tree node expand, completion item resolve, document change tick, **surface invocation** (user runs a registered command).

```jsonc
{ "instanceId": "ext-7af3",
  "eventType":  "surface.invoke" | "ui.click" | "editor.changed" | "...",
  "surfaceId":  "cmd-greet",        // when applicable
  "payload":    { /* free-form */ } }
```

### 5.6 `stream/open` `stream/data` `stream/close` *(notifications, both directions)*

For payloads >256 KB or open-ended streams (HTTP downloads, language-server traffic, file watch events). A stream is a tagged channel within the same stdio pipe.

```jsonc
// stream/open
{ "streamId": "s-12", "purpose": "net.fetch.body", "encoding": "binary" }
// stream/data
{ "streamId": "s-12", "data": "<base64>" }
// stream/close
{ "streamId": "s-12", "ok": true }   // or { ok: false, error: "…" }
```

### 5.7 `extension/deactivate` *(request)* · `extension/unload` *(notification)*

### 5.8 `shutdown` *(request)* · `exit` *(notification)*

LSP-style termination. Runtime must drain in-flight RPCs before responding to `shutdown`.

### 5.9 `host/grantPermission` *(notification)*

Used when a runtime-issued permission prompt resolves (see §6 `host/promptPermission`):

```jsonc
{ "instanceId": "ext-7af3",
  "scope":      "net.fetch:https://newhost.com/*",
  "decision":   "grant" | "deny" | "always" | "never" }
```

### 5.10 `extension/reload` *(notification)*

For `oxp dev`. Runtime re-loads from `bundlePath`; if `manifest.hotReload: true`, skips re-running `activate` for fast iteration.

---

## 6. Message catalogue — Runtime → Host

These are how the wasm component reaches the IDE. Each one corresponds to a WIT host import or a surface registration.

### 6.1 Always-on capability RPCs

| Method | Direction | WIT origin | Purpose |
|---|---|---|---|
| `log/write` | notification | `oxp:host/log.log` | Structured log line. |
| `storage/get` `storage/set` `storage/delete` `storage/keys` | request | `oxp:host/storage` | Per-(publisher, slug) KV. |
| `ui/render` | notification | `oxp:host/ui.render` | Push serialized [oxp-ui-v1](./protocol.md) tree. Host reconciles. |
| `ui/setStatus` | notification | `oxp:host/ui.set-status` | Status bar text + tooltip. |
| `ui/notify` | request | `oxp:host/ui.notify` | Toast; returns clicked button label or null. |
| `ui/showQuickPick` | request | (new) | Searchable picker. Returns selected item. |
| `ui/showInputBox` | request | (new) | Single-line input prompt. Returns string. |

### 6.2 Gated capability RPCs (one permission required per group)

| Method | Permission | WIT origin |
|---|---|---|
| `fs/readFile` `fs/writeFile` `fs/delete` `fs/stat` `fs/listDir` `fs/watch` | `fs.{read,write,delete}` | `oxp:host/fs` |
| `net/fetch` | `net.fetch:<origin-pattern>` | `oxp:host/net` |
| `secrets/get` `secrets/set` `secrets/delete` | `secrets.{read,write}` | `oxp:host/secrets` |
| `commands/execute` | `commands.executeHost` | `oxp:host/commands` |
| `process/spawn` | `process.spawn` | (new) |
| `terminal/create` `terminal/write` `terminal/dispose` | `terminal.create` | (new) |

`fs/watch` is a notification stream — host emits `fs/watchEvent` notifications keyed by a `watchId` returned at registration.

### 6.3 Editor RPCs (always-on if host advertises `editor.*`)

| Method | Capability | Purpose |
|---|---|---|
| `editor/getActiveBuffer` | `editor.buffers` | `{ uri, languageId, version, lineCount }`. |
| `editor/getBufferText` | `editor.buffers` | Range or full doc. Streams >256 KB. |
| `editor/applyEdit` | `editor.buffers` | Workspace edit (range replacements). |
| `editor/getSelection` | `editor.selection` | Cursor/selection in active editor. |
| `editor/setDecorations` | `editor.decorations` | Decoration set keyed by `decorationTypeId`. |
| `editor/setVirtualText` | `editor.virtualText` | Inline annotations (vscode decorations, neovim extmarks, jetbrains inlays). |

### 6.4 Surface registration RPCs (notifications)

These let the wasm component register IDE surfaces declaratively. Each carries a runtime-side `surfaceId`; the host stores its native handle and uses the `surfaceId` for callbacks (events, dispose).

| Method | Required capability |
|---|---|
| `surface/registerCommand` | (none — always available) |
| `surface/registerStatusItem` | `ui.statusBar` |
| `surface/registerTreeView` | `ui.treeView` |
| `surface/registerWebview` | `ui.webview` |
| `surface/registerCompletionProvider` | `language.completions` |
| `surface/registerCodeLensProvider` | `language.codeLens` |
| `surface/registerHoverProvider` | `language.hover` |
| `surface/registerDefinitionProvider` | `language.definition` |
| `surface/registerReferenceProvider` | `language.references` |
| `surface/registerRenameProvider` | `language.rename` |
| `surface/registerFormattingProvider` | `language.formatting` |
| `surface/registerDiagnostics` | `language.diagnostics` |
| `surface/registerLanguageServer` | `language.languageServer` |
| `surface/registerDebugAdapter` | `debugger.dap` |
| `surface/dispose` | — |

Host **must** acknowledge each registration with a `surface/ack` response carrying its native handle, **or** error with `SURFACE_UNSUPPORTED` if the surface isn't supported on this IDE.

When a surface fires (e.g. user invokes a registered command), the host sends `extension/event` (§5.5) back to the runtime with `eventType: "surface.invoke"` and the `surfaceId`.

### 6.5 Permission prompts

| Method | Direction | Purpose |
|---|---|---|
| `host/promptPermission` | request | Runtime asks host to prompt user. Host shows IDE-native modal, replies with `host/grantPermission` (§5.9). |

This is how a running extension can request a *new* permission scope (e.g. user clicks "connect to GitHub" → extension needs `net.fetch:https://api.github.com/*`). Without it, mid-session capability extension is impossible.

---

## 7. Capability negotiation

The single rule that makes "build once, run everywhere" honest.

1. Host advertises capabilities in `initialize.capabilities`.
2. Each extension's manifest declares:
   ```jsonc
   "surfaces": {
     "required": ["language.completions", "ui.statusBar"],
     "optional": ["ui.webview"]
   }
   ```
3. On `extension/load` runtime computes `unsupported = required − host.capabilities`.
4. If non-empty → fail with `CAPABILITY_UNSUPPORTED { missing }`. Host surfaces this to the user as a clean message.
5. Optional surfaces missing → activate in degraded mode; runtime tells the component via `activate-ctx.degraded: ["ui.webview"]`. The component decides whether to operate without that surface or to gracefully fail.

A JetBrains user installing a webview-heavy extension gets a precise "your IDE does not support webviews; this extension requires one" message — not a silent crash, not a fake widget.

---

## 8. Surface registration & per-IDE bridge table

| OXP surface | VS Code / Cursor / Windsurf / VSCodium | JetBrains (IntelliJ Platform) | Zed | Neovim |
|---|---|---|---|---|
| `registerCommand` | `commands.registerCommand` | `AnAction` + `ActionManager.registerAction` | slash-cmd / `extension.cmd` | `nvim_create_user_command` |
| `registerStatusItem` | `window.createStatusBarItem` | `StatusBarWidgetFactory` | n/a (deny) | lualine source registry |
| `registerTreeView` | `window.createTreeView` + `TreeDataProvider` | `ToolWindowManager` + `Tree` | n/a (deny) | quickfix / nvim-tree shim |
| `registerWebview` | `window.createWebviewPanel` | `JBCefBrowser` (JCEF) | n/a (deny) | n/a (deny) |
| `registerCompletionProvider` | `languages.registerCompletionItemProvider` | `CompletionContributor` | LSP-only | nvim-cmp source |
| `registerCodeLensProvider` | `languages.registerCodeLensProvider` | `CodeVisionProvider` (or Inlay) | Zed code-lens API | virtual text via extmarks |
| `registerHoverProvider` | `languages.registerHoverProvider` | `DocumentationProvider` | LSP-only | `vim.lsp.handlers` parallel |
| `registerDefinitionProvider` | `languages.registerDefinitionProvider` | `GotoDeclarationHandler` | LSP-only | `vim.lsp.buf.definition` parallel |
| `registerReferenceProvider` | `languages.registerReferenceProvider` | `FindUsagesHandler` | LSP-only | `vim.lsp.buf.references` parallel |
| `registerRenameProvider` | `languages.registerRenameProvider` | `RenamePsiElementProcessor` | LSP-only | `vim.lsp.buf.rename` parallel |
| `registerFormattingProvider` | `languages.registerDocumentFormattingEditProvider` | `Formatter` extension point | `format` | `vim.lsp.buf.format` parallel |
| `registerDiagnostics` | `languages.createDiagnosticCollection` | `Annotator` | LSP-only | `vim.diagnostic.set` |
| `registerLanguageServer` | spawn child + LSP client | `LspServerSupportProvider` (2024.2+) | LSP first-class | `vim.lsp.start` |
| `registerDebugAdapter` | `debug.registerDebugAdapterDescriptorFactory` | `DebugProcess` + `RunConfiguration` | (deny in v1) | `nvim-dap` shim |

Cells marked **n/a (deny)** mean the host plugin returns `CAPABILITY_UNSUPPORTED` if an extension tries to register that surface. The capability negotiation in §7 should normally prevent this from being attempted.

---

## 9. Pressure test: JetBrains, Zed, Neovim

This section is the reason the doc exists. For each non-VSCode IDE I walked the §6 catalogue against the IDE's actual API, looking for things we'd be unable to bridge. Findings + decisions below.

### 9.1 JetBrains (IntelliJ Platform 2024.x)

**Bridges cleanly:**
- `registerCommand` → `AnAction.actionPerformed`. Host plugin registers a synthetic `AnAction` and dispatches `extension/event`. ✅
- `registerStatusItem` → `StatusBarWidgetFactory`. ✅
- `registerTreeView` → `ToolWindowManager.registerToolWindow` + `Tree` whose model is fed by `ui/render`. ✅
- `registerWebview` → `JBCefBrowser` (Chromium embedded). Bidirectional via `JBCefJSQuery`. ✅
- `registerCompletionProvider` → `CompletionContributor` running on a read-action thread. ✅
- `registerCodeLensProvider` → `CodeVisionProvider` (since 2022.2). ✅
- `registerLanguageServer` → IntelliJ Platform shipped first-class LSP support in 2024.2 via `LspServerSupportProvider`. We don't have to write our own LSP client. ✅
- `registerDiagnostics` → `Annotator` extension. ✅
- `editor/setVirtualText` → `Inlay` API. ✅
- `secrets` → `PasswordSafe`. ✅
- `process/spawn` → `OSProcessHandler`. ✅
- `terminal/create` → `TerminalToolWindowManager.createLocalShellWidget`. ✅

**Friction / gaps found:**
- **No equivalent of `vscode.window.createOutputChannel`.** Decision: route via `ui/notify` for one-shot messages and via the VFS-backed `ConsoleView` only when an extension explicitly opens a tool window. No separate RPC.
- **JetBrains `CompletionContributor` runs on a read-action thread with a soft 500ms latency budget.** Round-tripping to the runtime can hit it. Decision: declare a 250ms target SLO for `registerCompletionProvider` callbacks; runtime must batch + cache. Document for extension authors.
- **Modal threading.** All UI updates must hit the EDT. Plugin wraps into `ApplicationManager.invokeLater`. Internal concern; no protocol change.
- **Webview ↔ wasm event payload size.** `JBCefJSQuery` strings can be megabytes. Use `stream/*` for >256 KB. ✅ already in spec.

**Verdict: zero protocol gaps.** The plugin is real work (~1500 LOC Kotlin), but the protocol holds.

### 9.2 Zed (`zed_extension_api` 0.4.x)

**Bridges cleanly:**
- `registerCommand` → Zed slash-commands and the action registry. ✅
- `registerLanguageServer` → Zed's first-class LSP support. ✅
- `registerCompletionProvider`, `registerHoverProvider`, `registerDefinitionProvider`, `registerDiagnostics` → **via LSP child only.** Zed exposes no non-LSP APIs for these. Decision: cross-IDE extensions that want completions on Zed must use `registerLanguageServer`. We document this; protocol unaffected.
- `registerCodeLensProvider` → Zed code-lens extension API. ✅
- `editor/setVirtualText` → Zed inlay hints (LSP) or extension diagnostics. ✅
- `fs`, `net`, `process` → `zed_extension_api` host imports. ✅
- `terminal/create` → Zed terminal extension API. ✅

**Friction / gaps found:**
- **No webview, no tree view, no status bar in 0.4.** Decision: `ui.webview / ui.treeView / ui.statusBar` capabilities = `false`. Extensions requiring them can't install on Zed. This is the **right** answer — faking them would be worse than refusing.
- **Zed runs extensions inside its own wasm sandbox.** A *different* wasm runtime from ours. We do **not** integrate at that level — we ship the IDE plugin as a Zed extension whose only job is to spawn `oxp-runtime` as a sidecar. Costs us a process; gains protocol uniformity. **Decision: sidecar pattern, not wasm-on-wasm.**
- **Zed extension API not yet 1.0 stable.** Risk: API shifts. Mitigation: pin `zed_extension_api` version per `oxp-host-zed` release; never auto-update.

**Verdict: zero protocol gaps.** Some surfaces are denied on Zed; that's expected and handled by §7.

### 9.3 Neovim (≥ 0.10)

**Bridges cleanly:**
- `registerCommand` → `nvim_create_user_command`. ✅
- `registerCompletionProvider` → nvim-cmp source registration (most common) or `vim.lsp.completion`. ✅
- `registerHoverProvider` → custom handler via `BufRead` autocmd, displayed via `vim.lsp.util.open_floating_preview`. ✅
- `registerDefinitionProvider`, `registerReferenceProvider`, `registerRenameProvider` → register as parallel handlers in a `vim.lsp` namespace, or run an embedded null-ls-style server. Decision: Lua plugin runs an in-process "OXP virtual LSP" that registers into `vim.lsp` for these. Hidden from extension authors.
- `registerDiagnostics` → `vim.diagnostic.set`. ✅
- `editor/setVirtualText` / `setDecorations` → `nvim_buf_set_extmark` with `virt_text` and highlight groups. ✅
- `registerLanguageServer` → `vim.lsp.start`. ✅
- `secrets` → no native vault. Decision: `secrets.store: "memory"` by default; capability flag is honest. (Document: "use a system keyring plugin if you need persistent secrets.")
- `terminal/create` → `:terminal` + `nvim_open_term`. ✅

**Friction / gaps found:**
- **No webview.** `ui.webview: false`. Same handling as Zed.
- **No tree view widget.** Recommendation in spec: extensions targeting Neovim should provide a quickfix-list fallback for what would be a tree view on richer hosts. Or register a quickfix-backed tree if `ui.treeView: false`.
- **`registerStatusItem`** is awkward — Neovim has many statusline plugins. Decision: Lua plugin exports a registry that lualine et al. consume; we don't push into the active statusline directly. Functionally `ui.statusBar: true` but actual rendering depends on user's statusline. Document the integration.
- **Single-threaded.** Lua plugin must avoid blocking I/O on the main loop while waiting for runtime RPC. Use `vim.loop`/`uv` async + callbacks. Internal concern.
- **Bundle install path.** No app sandbox. CLI installs into `~/.oxp/host-store`; Lua plugin reads from there. No special handling.

**Verdict: zero protocol gaps.** Same denial pattern as Zed for unsupported UI surfaces.

### 9.4 Cross-cutting findings (already applied to v1 spec above)

These came out of the pressure test:

1. **`stream/*`** — needed for at least three real surfaces (large `net/fetch` bodies, webview ↔ wasm event payloads in JetBrains, file watch events).
2. **`host/promptPermission` + `host/grantPermission`** — every IDE has native modal/notification; otherwise we'd force extensions to bake their own consent UI in their webview.
3. **`ui.quickPick` and `ui.inputBox`** as first-class capabilities — every IDE has them and extensions universally want them.
4. **`registerLanguageServer` is the universal escape hatch.** Zed effectively *requires* it for completions/hover/etc. Documented as the recommended pattern for cross-IDE language tooling.
5. **`debugger.dap`** added so extensions can ship debug adapters once and have them work across VS Code, JetBrains (DAP support 2024+), and nvim-dap.
6. **No surface needed bidirectional reactive streams beyond what `stream/*` covers.** File watching, terminal output, and LSP traffic all fit the chunked-notification pattern.

### 9.5 What we explicitly *don't* support in v1

| Not supported | Why | Path forward |
|---|---|---|
| `ui.webview` on Zed/Neovim | Hosts have no equivalent | Require extension to provide non-webview fallback |
| Multi-window shared runtime | Per-window isolation > efficiency | Revisit if memory becomes an issue |
| Native UI widgets outside webview/tree/status | Wildly divergent across hosts | Use `ui/render` (oxp-ui-v1) only |
| Synchronous blocking host calls from wasm | Wasmtime supports it but deadlocks naive plugins | All host imports are async-shaped at WIT level |
| Telemetry channel | Privacy/trust footgun | Add post-launch only if opt-in |

---

## 10. Error model

JSON-RPC 2.0 error objects. OXP-specific codes in **-32000 … -32099**.

| Code | Symbol | When |
|---|---|---|
| -32001 | `SIGNATURE_INVALID` | Bundle signature failed verification |
| -32002 | `WORLD_MISMATCH` | WIT world sha pinned in manifest ≠ runtime's |
| -32003 | `CAPABILITY_UNSUPPORTED` | Required surface unavailable on this host |
| -32004 | `PERMISSION_DENIED` | Operation outside granted scope |
| -32005 | `EXTENSION_TRAPPED` | wasm trap; instance is poisoned |
| -32006 | `FUEL_EXHAUSTED` | Compute budget hit |
| -32007 | `BUNDLE_CORRUPT` | Tar/zstd unpack failed or manifest invalid |
| -32008 | `UNKNOWN_INSTANCE` | `instanceId` not loaded |
| -32009 | `STREAM_BROKEN` | Other side closed mid-stream |
| -32010 | `HOST_TIMEOUT` | Host RPC didn't respond within SLO |
| -32011 | `SURFACE_UNSUPPORTED` | Surface registration on a host that denies it |

Errors carry a `data` object where useful: `CAPABILITY_UNSUPPORTED { missing: [...] }`, `PERMISSION_DENIED { scope: "..." }`.

---

## 11. Security boundary

- **The runtime is the trust boundary.** Signature verification, capability scope enforcement, fuel limits, at-rest secret encryption all live in `oxp-runtime`. Host plugins are untrusted plumbing — they may *ask* for things the user didn't grant; the runtime says no.
- **Hosts run unprivileged.** No host plugin needs filesystem-wide read or network access.
- **Hosts spawn the runtime from a sha-pinned path.** Shipped with the plugin or downloaded into a sha-locked location. **Never PATH-resolved.**
- **Permissions are scoped.** `fs.read:./**` differs from `fs.read:/**`. Runtime parses scopes; hosts never see them.
- **stdin/stdout is the only channel.** No shared filesystem state, no IPC sockets, no network ports between host and runtime.
- **Per-extension wasm instances.** One extension trapping does not affect others.

---

## 12. Sequence diagrams

### 12.1 Cold start + activate

```
Host                    Runtime
 │  spawn oxp-runtime ──▶│
 │  initialize ─────────▶│
 │ ◀──────── result ─────│
 │  extension/load  ────▶│  · verify sig · check world sha · check caps
 │ ◀──────── result ─────│
 │  extension/activate ─▶│  · invoke lifecycle.activate
 │ ◀── surface/register* (×N)
 │  surface/ack ────────▶│
 │ ◀──────── result ─────│
```

### 12.2 User invokes a registered command

```
Host                            Runtime
 │  (user clicks AnAction)
 │  extension/event {            │
 │    eventType: "surface.invoke",
 │    surfaceId: "cmd-greet"   } ▶│
 │                               │  route to command-handler.on-command
 │                          ◀── ui/notify (request)
 │ ── result ───────────────────▶│
```

### 12.3 Net fetch with permission prompt

```
Host                       Runtime
 │ ◀── net/fetch (req) ─────│  url=https://api.github.com/...
 │                          │  permission check fails
 │ ── error -32004 ────────▶│
 │ ◀── host/promptPermission│  scope=net.fetch:https://api.github.com/*
 │ (modal to user)          │
 │ ── host/grantPermission ▶│  decision=always
 │ ◀── net/fetch (req) ─────│  retried by component
 │ ── response ────────────▶│
```

---

## 13. Open questions resolved for v1

| Question | Decision | Why |
|---|---|---|
| One runtime per IDE window vs shared daemon | **Per window.** | Blast-radius isolation > memory savings. Revisit if real users complain. |
| JSON vs msgpack on the wire | **JSON for control, opaque bytes for `ui/render`.** | Tooling/debug-ability wins; `ui/render` already opaque so msgpack still possible inside. |
| Streaming in v1 | **Yes via `stream/*`.** | Pressure test (§9) showed three real needs. |
| Hot-reload during `oxp dev` | **`extension/reload` notification, manifest opt-in `hotReload: true`.** | Already needed for DX; trivial addition. |
| `commands/execute` reflection | **Punt.** | Try-and-handle-error is fine for v1. |
| Telemetry channel | **None in v1.** | Privacy/trust risk; can add opt-in later. |
| Sidecar vs. embed on Zed | **Sidecar.** | Protocol uniformity > one fewer process. |
| Wasm-on-JVM for JetBrains | **Sidecar — no embed.** | Avoids Chicory perf hit and per-platform JVM packaging. |
| Multi-instance per extension | **One instance per (extensionId, version).** | Multiple wasm instances of same extension would break storage namespacing. |

---

## 14. What this unlocks

Once a host plugin implements §5/§6/§7/§8, it inherits the entire OXP catalogue at zero per-extension cost.

- **JetBrains plugin** = Kotlin project that spawns `oxp-runtime`, implements ~30 RPC methods → IntelliJ Platform SDK.
- **Zed extension** = Rust crate that spawns `oxp-runtime`, implements the same against `zed_extension_api`.
- **Neovim plugin** = ~500 lines of Lua doing the same against `vim.api`.
- **VS Code / Cursor / Windsurf / VSCodium** = single VSIX (already exists).

Extension authors never see a per-IDE distinction. They write one wasm component, target `oxp:extension@0.1.0`, declare `surfaces.required`, and ship.

That is the universal protocol promise. **This document is the contract that delivers it.**
