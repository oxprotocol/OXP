# OXP — Open eXtension Protocol

**One spec. Any IDE. No marketplace lock-in.**

OXP is a small, neutral specification for IDE extensions: a manifest format, a sandboxed runtime, a JSON-RPC SDK, and a sideloading registry. It lets a developer publish an extension once and install it into any IDE that has an OXP host adapter — VS Code, Cursor, Windsurf, VS Code Insiders, and VSCodium today; JetBrains in progress; Zed, Neovim, and others as adapters land.

OXP is to IDE extensions what **LSP** is to language tooling and what **npm** is to JavaScript packages: a thin, boring, standards-based layer that ends N×M integration work.

## What's actually new

Just three things. Everything else is composition of existing standards.

1. **`oxp.json`** — a ~50-field manifest (id, version, permissions, contributions, host compatibility).
2. **`@oxprotocol/ui`** — a fixed component contract (`Box`, `Stack`, `Button`, `Tree`, `VirtualList`, …). Stay inside it and your extension gets the native render path on hosts that support it. Drop out of it (`oxp.ui.escapeHatch`) and you fall back to webview rendering.
3. **CLI host adapters** — one small module per IDE that knows how to install/uninstall/update via that IDE's own tooling. No directory sniffing, no monkey-patching.

## What we do not invent

| Concern | Standard adopted |
|---|---|
| Bundle distribution | **OCI Distribution Spec** |
| Publisher signing | **Sigstore / Cosign** (keyless, Rekor-logged) |
| Logic sandbox | **WASI Component Model** (Preview 2) |
| Wire protocol | **JSON-RPC 2.0** over Unix domain socket / named pipe |
| Discovery API | **Open VSX-compatible** read endpoints |
| Spec governance | **LSP/MCP-style** versioning + RFC process |

Five standards, one schema, one component library. That's the whole platform.

## Three integration tiers for IDE vendors

| Tier | What the IDE does | What users get |
|---|---|---|
| **L0 — Sideload** | Nothing. OXP installs as a regular extension via the IDE's own CLI. | Works today on every Code fork. Webview UI at 60fps. |
| **L1 — Registry adapter** | Surface `oxp.sh` results in the IDE's extension search. | Native discovery; one click install. |
| **L2 — Native renderer** | Implement the `@oxprotocol/ui` component set in the IDE's native toolkit. | 120fps native UI. No webview. Same `.oxp` bundle. |

OXP launches at L0 across all VS Code forks. L1 and L2 are public specs with reference implementations (JetBrains JCEF, Piye GPUI) so any vendor can adopt on their own timeline.

## What this unlocks

- **For developers:** write standard React + Tailwind + Rust/Wasm. Publish once. Install anywhere. AI tools work because the code is conventional.
- **For IDE vendors (Cursor, Zed, JetBrains, and any IDE that wants a native extension story):** an extension story that isn't legally constrained by Microsoft's marketplace ToS. Adopt L1 in a week, L2 when ready.
- **For enterprises:** private OXP registries (OCI-compatible), signed by Sigstore, auditable by default.

## Status

- **V1 spec:** drafting at `spec/v1/`.
- **Registry:** running at `oxp.sh` (this repo).
- **CLI:** Phase 1 in progress.
- **Reference renderer:** Piye IDE (private, native L2).

## Governance

OXP's spec is intended to be donated to a neutral foundation (CNCF Sandbox or Eclipse Foundation) once three external IDE adopters ship L1 or higher. The registry and CLI remain stewarded by the OXP project; the spec belongs to the ecosystem.

---

*Maintained by the OXP project — [oxp.sh](https://oxp.sh). Spec contributions welcome via RFC at [github.com/oxprotocol/OXP](https://github.com/oxprotocol/OXP).*
