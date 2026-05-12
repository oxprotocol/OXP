# OXP Host for VS Code

**Run universal OXP extensions (`.wasm` components) inside VS Code.**
One extension binary, every editor — write it once, ship it to VS Code,
JetBrains, Neovim, and the web. See <https://oxprotocol.org>.

---

## What is OXP?

[OXP (Open Extension Protocol)](https://oxprotocol.org) is an open
specification for editor extensions distributed as sandboxed WebAssembly
**components** (WASI Preview 2). The same `.oxp` bundle runs unchanged
in any OXP-compatible host:

| Host       | Status   | Marketplace                                                |
| ---------- | -------- | ---------------------------------------------------------- |
| VS Code    | Stable   | (this extension)                                           |
| JetBrains  | Stable   | <https://github.com/oxprotocol/oxp/releases>               |
| Neovim     | Beta     | <https://github.com/oxprotocol/oxp/tree/main/hosts/neovim> |

This package is the **VS Code host**: it fetches, verifies, sandboxes,
and renders OXP extensions.

---

## Features

- **Install from URL** — paste any `https://…/extension.oxp` (or
  `file://`) and the bundle is downloaded, sha256-verified, signature-
  checked, cached, and loaded into a sandboxed wasm runtime.
- **Marketplace browser** — discover extensions at
  [oxp.sh](https://oxp.sh) and install with one click via the `oxp://`
  protocol handler.
- **Capability-based permissions** — every extension declares the
  capabilities it needs (`net.fetch`, `fs.read`, `shell.exec`, …) in
  its manifest. The host shows them in a consent dialog **before**
  activation. Cancel = no install.
- **In-IDE rendering** — wasm components draw their UI through the
  `oxp:ui/v1` interface (HTML/CSS in a sandboxed webview, or a
  declarative component tree). No native Electron code, no
  arbitrary JS injection.
- **Live dev sessions** — point the host at a local dev server with
  `oxp dev` (from `@oxprotocol/cli`) and the extension hot-reloads
  on save into a dedicated activity-bar view.
- **Deterministic bundles** — every published `.oxp` is reproducible
  (sorted, mtime-stripped tar + zstd) and signed with Ed25519. The
  digest in the marketplace matches the bytes you load.

---

## Quick start

### Install an extension from oxp.sh

1. Open the Command Palette (⇧⌘P / Ctrl+Shift+P).
2. Run **OXP: Open Runtime Panel** → click **Start runtime**.
3. Run **OXP: Install Extension from URL…** and paste the URL of any
   `.oxp` bundle (e.g. from <https://oxp.sh>).
4. Approve the requested capabilities.
5. The extension's UI appears as a new tab.

Try the showcase extensions:

| Extension              | Description                                      | URL                                  |
| ---------------------- | ------------------------------------------------ | ------------------------------------ |
| `@aldgar/env-checker`  | Reports your active Node / Python / git versions | <https://oxp.sh/@aldgar/env-checker>  |
| `@aldgar/git-panel`    | Status + recent commits panel                    | <https://oxp.sh/@aldgar/git-panel>    |
| `@aldgar/color-tokens` | Design-token preview swatches                    | <https://oxp.sh/@aldgar/color-tokens> |

### Install from a local file

```bash
# Build your extension
oxp pack
# → dist/myext-0.0.1.oxp
```

Then **OXP: Install Extension from URL…** with
`file:///absolute/path/to/dist/myext-0.0.1.oxp`.

### Install from a local HTTP server (dev)

```bash
python3 -m http.server 8765
# then install from http://localhost:8765/myext-0.0.1.oxp
```

Plain `http://` is allowed **only** for `localhost`, `127.0.0.1`, and
`::1`. Everything else requires HTTPS.

---

## Building your own extension

```bash
npm create oxp@latest my-ext       # or: npx @oxprotocol/cli create my-ext
cd my-ext
npm install
oxp dev                            # open VS Code → OXP activity bar
                                   # → live-reload session
oxp pack                           # build a signed .oxp bundle
oxp publish                        # ship to https://oxp.sh
```

Templates available:

- `hello-html`  — React + TS in a sandboxed webview
- `hello-tree`  — declarative `oxp-ui-v1` component tree (no JS)
- `hello-code`  — TypeScript host-runtime extension
- `hello-rust`  — full component-v1 (WASI P2) Rust extension

Every template ships with a default `icon.svg` + `icon.png` you can
edit. The CLI's `oxp icon` subcommand can regenerate icons from
templates, emoji, or arbitrary SVG:

```bash
oxp icon init -t terminal              # built-in template
oxp icon from "🚀"                     # emoji icon (via Twemoji)
oxp icon from "OXP" --bg "#7c3aed"     # monogram
oxp icon convert mylogo.svg --size 256 # rasterise existing SVG
```

See the full guide at <https://oxprotocol.org/docs>.

---

## Commands

| Command                              | Description                       |
| ------------------------------------ | --------------------------------- |
| `OXP: Open Runtime Panel`            | Open the runtime dashboard        |
| `OXP: Install Extension from URL…`   | Install a `.oxp` from any URL     |
| `OXP: Show Installed Extensions`     | List installed OXP extensions     |
| `OXP: Uninstall Extension…`          | Remove an installed extension     |
| `OXP: Start Dev Session`             | Begin a live-reload dev session   |
| `OXP: Stop Dev Session`              | End the current dev session       |
| `OXP: Show Dev Session Output`       | Tail dev-server logs              |
| `OXP: Stop Runtime`                  | Shut down the wasm runtime        |
| `OXP: Reload Installed Extensions`   | Re-scan the install dir           |

---

## Security

- **Sandboxing.** Extensions run inside the host-managed wasm runtime
  with no ambient authority. They cannot read your filesystem, open
  network sockets, or spawn processes unless they declare — and you
  approve — the matching capability.
- **Verification.** Every bundle's sha256 is computed locally and
  compared to the value in `oxp.json` and the marketplace metadata.
  Ed25519 signatures are verified against the publisher's public key
  on every install.
- **Allowlists.** `net.fetch` permissions can be scoped to specific
  hosts (`https://api.example.com/*`); `fs.read` to specific paths.
  Wildcards are rejected for sensitive capabilities.
- **No native code.** Every OXP extension is a `.wasm` component.
  There is no path for an extension to load a native dylib or `.so`.

Report security issues to <security@oxprotocol.org>. See
[SECURITY.md](https://github.com/oxprotocol/oxp/blob/main/SECURITY.md).

---

## Troubleshooting

**The activity-bar icon shows a blank square.**
You may have an older OXP extension installed from a different
publisher. List with `code --list-extensions --show-versions | grep
oxp` and uninstall stale entries
(`code --uninstall-extension oxp.oxp-vscode`).

**An extension fails to load with `WIT_SHA_MISMATCH`.**
The extension was built against a different revision of the
`oxp:extension` world than this host supports. Ask the publisher to
rebuild against the current pin (run `oxp doctor` to see yours).

**Permissions dialog never appears.**
Open **OXP: Open Runtime Panel** and check that the runtime is
running. Permission prompts route through the runtime; if it's not
started, the install will queue.

---

## Links

- Specification — <https://oxprotocol.org/spec>
- CLI & SDK     — <https://www.npmjs.com/package/@oxprotocol/cli>
- Source        — <https://github.com/oxprotocol/oxp>
- Issues        — <https://github.com/oxprotocol/oxp/issues>

## License

Apache-2.0
