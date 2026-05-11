# OXP Vision (LOCKED)

> **OXP = Open Extension Protocol.**
> One extension, written once, runs as a **real** extension in every supported
> IDE — using the same dev workflow developers already know.
> The goal is to **end IDE extension lock-in.**

## Non-negotiables

1. **Write once, run everywhere.** Authors write **one** OXP extension in
   TypeScript against the OXP API. The CLI compiles it into a **real native
   artifact** per IDE:
   - `.vsix` → VS Code, Cursor, Windsurf, Antigravity, VSCodium
   - `.zip`  → JetBrains family (IntelliJ, WebStorm, PyCharm, …)
   - Lua plugin → Neovim
   - Zed extension → Zed

2. **Mirror the workflow developers already know.** Clicking *Run / F5* opens
   a dedicated **host window** with the extension live — exactly like
   VS Code's Extension Development Host. Same mental model on every IDE.

3. **Real extension capabilities — eventually.** OXP is not a
   sandbox-webview product. The webview panel is **one** contribution point
   inside the OXP API, alongside commands, menus, keybindings, status bar,
   tree views, language providers, terminals, debuggers, file-system access.

4. **Community first, then giants.** Scope grows from small community
   extensions (utilities, side panels, dashboards) outward. We don't try to
   ship a GitLens / Jupyter / Copilot equivalent on day one — those need a
   proven community and API surface first.

## Architecture

- [spec/v1/oxp-api.md](spec/v1/oxp-api.md) — the **frozen IDE-agnostic API
  surface**. Derived from the *intersection* of capabilities exposed by
  VS Code, JetBrains, Neovim, and Zed. Contribution points, lifecycle,
  permission flags. *(To be drafted.)*
- `hosts/<ide>/runtime/` — one **adapter per IDE** mapping the OXP API to
  the IDE's native API. Written once by us. Each adapter is a thin shim;
  e.g. `oxp.commands.register(...)` → `vscode.commands.registerCommand(...)`
  / `AnAction` / `vim.api.nvim_create_user_command` / Zed equivalent.
- `packages/cli` — `oxp build` transpiles one OXP source into one native
  artifact per target.
- **Dev UX per IDE:** clicking Run spawns a **new IDE window** dedicated to
  the running OXP extension (mirrors VS Code's EDH). Hot reload across that
  window.

## Current state (May 2026)

| Layer                                          | Status              |
| ---------------------------------------------- | ------------------- |
| Signed bundle format + reproducible hashes     | ✅ shipped          |
| Registry + marketplace web app                 | ✅ shipped          |
| CLI: build / pack / publish / IDE detection    | ✅ shipped (0.1.13) |
| VS Code host: install + webview panel + hot reload | ✅ shipped (0.2.4) |
| F5-equivalent new-window UX                    | ⏳ in progress      |
| OXP API contract (frozen v1)                   | ⏳ next             |
| VS Code adapter (full contribution points)     | 🟡 partial          |
| JetBrains adapter                              | 🟡 scaffold only    |
| Neovim adapter                                 | 🟡 scaffold only    |
| Zed adapter                                    | ❌ not started      |
| CLI transpiler (one src → many targets)        | ❌ not started      |

## Priority order

1. **VS Code:** F5-equivalent new-window UX. ← *now*
2. **OXP API v1 contract** written into `spec/v1/oxp-api.md`.
3. **JetBrains** minimal viable adapter + new-window UX.
4. **Neovim** minimal viable adapter.
5. **Zed** minimal viable adapter.
6. CLI transpiler: one OXP source → multiple native artifacts.
7. Expand OXP API surface toward giants once community adopts.

## Decision rule for every future change

> *Does this serve "one extension, every IDE, real capabilities,
> mirroring the workflow developers already know"?*
> If no, don't ship it.
