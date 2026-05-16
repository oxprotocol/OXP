# OXP Host for VS Code

**One extension bundle. Every editor.**

Write your extension once as a sandboxed `.wasm` component and ship it to
VS Code, Cursor, Windsurf, VSCodium, and JetBrains IDEs — no recompiling,
no forking, no IDE-specific APIs. See [oxp.sh](https://oxp.sh).

---

## What is OXP?

[OXP (Open Extension Protocol)](https://oxp.sh) is an open specification for
editor extensions distributed as signed, sandboxed WebAssembly **components**
(WASI Preview 2). The same `.oxp` bundle runs unchanged in any OXP-compatible
host:

| Host              | Status            | Marketplace                                           |
| ----------------- | ----------------- | ----------------------------------------------------- |
| VS Code           | ✅ Stable         | (this extension)                                      |
| Cursor            | ✅ Stable         | (same extension — works out of the box)               |
| Windsurf          | ✅ Stable         | (same extension — works out of the box)               |
| VSCodium          | ✅ Stable         | (same extension — works out of the box)               |
| JetBrains         | 🔄 In progress    | [JetBrains Marketplace](https://plugins.jetbrains.com)|
| Piye              | 🔄 In progress    | —                                                     |

This package is the **VS Code host**: it fetches, verifies, sandboxes, and
renders OXP extensions inside VS Code and compatible forks.

---

## Features

- **Install from any URL** — paste any `https://…/extension.oxp` (or `file://`)
  and the bundle is downloaded, sha256-verified, Ed25519-signature-checked,
  cached, and loaded into a sandboxed wasm runtime.
- **Registry browser** — discover extensions at [oxp.sh](https://oxp.sh) and
  install with one click via the `oxp://` protocol handler.
- **Capability-based permissions** — every extension declares the capabilities
  it needs (`net.fetch`, `fs.read`, `terminal.shell`, …) in its manifest. The
  host shows them in a consent dialog **before** activation. Cancel = no
  install. No surprises.
- **In-IDE rendering** — wasm components draw their UI through the `oxp:ui/v1`
  interface (HTML/CSS in a sandboxed webview, or a declarative component tree).
  No arbitrary JS injection, no native Electron bypasses.
- **Live dev sessions** — attach the host to a local `oxp dev` server and your
  extension hot-reloads on every save into a dedicated activity-bar view.
- **Deterministic bundles** — every published `.oxp` is reproducible
  (sorted, mtime-stripped tar + zstd) and signed with Ed25519. The digest in
  the registry matches the bytes you load locally.

---

## Quick start

### Install an extension from oxp.sh

The easiest path is the CLI — it handles download, verification, and host
registration in one command:

```bash
npm install -g @oxprotocol/cli
oxp install @publisher/extension-name
```

Approve the permission consent prompt and the extension's UI appears as a new
panel in VS Code.

You can also install directly from the Command Palette:

1. Open the Command Palette (⇧⌘P / Ctrl+Shift+P).
2. Run **OXP: Install Extension from URL…** and paste any `.oxp` URL.
3. Approve the requested capabilities.
4. The extension's UI appears as a new tab.

### Install from a local file

```bash
# Build your extension
oxp pack
# → dist/myext-0.0.1.oxp

# Install it directly
oxp install-url file:///absolute/path/to/dist/myext-0.0.1.oxp
```

Or use the Command Palette: **OXP: Install Extension from URL…** with a
`file:///` path.

---

## Building your own extension

```bash
npm create oxp@latest my-ext       # scaffold a new extension
cd my-ext
npm install
oxp dev                            # hot-reload dev session in VS Code
oxp pack                           # build a signed .oxp bundle
oxp publish                        # ship to https://oxp.sh
```

Templates available:

| Template      | Description                                            |
| ------------- | ------------------------------------------------------ |
| `hello-html`  | React + TypeScript in a sandboxed webview              |
| `hello-tree`  | Declarative `oxp:ui/v1` component tree (no JS bundle)  |
| `hello-code`  | TypeScript host-runtime extension                      |
| `hello-rust`  | Full WASI Preview 2 component in Rust                  |

The CLI's `oxp icon` subcommand generates icons from templates, emoji, or SVG:

```bash
oxp icon init -t terminal              # built-in template
oxp icon from "🚀"                     # emoji icon (via Twemoji)
oxp icon from "OXP" --bg "#7c3aed"     # monogram
oxp icon convert mylogo.svg --size 256 # rasterise existing SVG
```

See the full guide at [oxp.sh/docs](https://oxp.sh/docs).

---

## Commands

| Command                                  | Description                                    |
| ---------------------------------------- | ---------------------------------------------- |
| `OXP: Open Runtime Panel`                | Open the runtime dashboard                     |
| `OXP: Install Extension…`                | Install a `.oxp` from the registry             |
| `OXP: Install Extension from URL…`       | Install a `.oxp` from any HTTPS or file URL    |
| `OXP: Open Extension…`                   | Open an installed extension's UI panel         |
| `OXP: Show Installed Extensions`         | List all installed OXP extensions              |
| `OXP: Uninstall Extension…`              | Remove an installed extension                  |
| `OXP: Start Dev Session`                 | Begin a live-reload dev session                |
| `OXP: Attach to Dev Server…`             | Attach to a running `oxp dev` server           |
| `OXP: Stop Dev Session`                  | End the current dev session                    |
| `OXP: Show Dev Session Output`           | Tail dev-server logs                           |
| `OXP: Reload Installed Extensions`       | Re-scan the install directory                  |
| `OXP: Stop Runtime`                      | Shut down the wasm runtime                     |
| `OXP: Activate URL Extension from CLI…`  | Load an extension passed via the `oxp://` URI  |

---

## Security

- **Sandboxing.** Extensions run inside the host-managed wasm runtime with no
  ambient authority. They cannot read your filesystem, open network sockets, or
  spawn terminal processes unless they explicitly declare — and you approve —
  the matching capability.
- **Verification.** Every bundle's sha256 is computed locally and compared
  to the value in `oxp.json` and the registry metadata. Ed25519 signatures are
  verified against the publisher's public key on every install.
- **Allowlists.** `net.fetch` permissions can be scoped to specific hosts
  (`https://api.example.com/*`); `fs.read` to specific paths. Wildcards are
  rejected for sensitive capabilities.
- **No native code.** Every OXP extension is a `.wasm` component. There is no
  path for an extension to load a native dylib or `.node` addon.

Report security issues to <security@oxp.sh>. See
[SECURITY.md](https://github.com/oxprotocol/oxp/blob/main/SECURITY.md).

---

## Troubleshooting

**The activity-bar icon shows a blank square.**
You may have an older OXP extension installed from a different publisher. List
with `code --list-extensions --show-versions | grep oxp` and uninstall stale
entries (`code --uninstall-extension oxp.oxp-vscode`).

**An extension fails to load with `WIT_SHA_MISMATCH`.**
The extension was built against a different revision of the `oxp:extension`
world than this host supports. Ask the publisher to rebuild against the current
pin (run `oxp doctor` to see yours).

**Permissions dialog never appears.**
Open **OXP: Open Runtime Panel** and check that the runtime is running.
Permission prompts route through the runtime — if it's not started, installs
will queue.

**`download failed (NOT_WASM)`.**
The URL didn't return a valid wasm component. Check the magic bytes — the first
four bytes of a valid component are `\x00asm`.

**`download failed (SCHEME_NOT_ALLOWED)`.**
Plain `http://` is only allowed for `localhost` / `127.0.0.1`. Use `https://`
or `file://` for everything else.

---

## Links

- Documentation — <https://oxp.sh/docs>
- CLI & SDK     — <https://www.npmjs.com/package/@oxprotocol/cli>
- Source        — <https://github.com/oxprotocol/oxp>
- Issues        — <https://github.com/oxprotocol/oxp/issues>

## License

Apache-2.0
