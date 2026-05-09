# OXP — Open Extension Protocol (VS Code host)

Run universal OXP extensions (`.wasm` components) inside VS Code.
One extension binary, every editor — see <https://oxprotocol.org>.

## Features

- **Install from URL** — paste any `https://…wasm` (or `file://`) and the
  extension is fetched, hashed, cached, and loaded into a sandboxed wasm
  runtime.
- **Permission prompts** — capabilities declared by the extension are
  surfaced before activation. Cancel = no install.
- **In-IDE rendering** — wasm components draw their UI through the
  `oxp:ui/v1` interface, hosted in a dedicated webview tab.

## Usage

1. **OXP: Open Runtime Panel** (Command Palette) → **Start runtime**.
2. **OXP: Install Extension from URL…** → paste a URL.
3. Approve requested permissions → the extension UI appears as a new tab.

For local development, point at a static file server:

```bash
python3 -m http.server 8765
# then install from http://localhost:8765/your_extension.wasm
```

`http://` is allowed only for `localhost` / `127.0.0.1` / `::1`.

## License

Apache-2.0
