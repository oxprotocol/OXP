import type { DocSection } from "../docs";

export const techniquesDocs: DocSection[] = [
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
    summary: "Master oxp dev: file watching, hot-reload, and the full development loop.",
    body: `\`oxp dev\` is your primary development tool. It watches your project, re-packs on every change, and pushes updates to connected hosts over WebSocket — giving you instant hot-reload without going through publish.

## Starting the Dev Server

\`\`\`bash
oxp dev              # default port 7373
oxp dev --port 8080  # custom port
oxp dev ./my-ext     # explicit project directory
\`\`\`

## What Happens

1. **Initial build** — \`oxp dev\` packs your extension and starts serving it
2. **File watching** — chokidar watches your project directory (ignoring \`.git\`, \`node_modules\`, \`dist/*.oxp\`, \`.next\`)
3. **Auto-repack** — on any file change, debounced at 100ms, the bundle is rebuilt
4. **WebSocket push** — connected hosts receive a \`reload\` message with the new bundle
5. **HTTP endpoints** — for hosts that prefer polling over WebSocket

## Endpoints

| Endpoint | Method | Response |
|---|---|---|
| \`ws://localhost:7373/dev\` | WebSocket | JSON reload messages |
| \`http://localhost:7373/info\` | GET | Manifest, digest, bundle size |
| \`http://localhost:7373/manifest\` | GET | Raw oxp.json |
| \`http://localhost:7373/bundle\` | GET | Raw .oxp bytes |

## WebSocket Protocol

Connected hosts receive JSON messages:

\`\`\`json
{
  "kind": "reload",
  "manifest": { ... },
  "digest": "sha256:a1b2c3...",
  "bundle": "<base64>",
  "builtAt": 1714820400000,
  "dev": true
}
\`\`\`

On pack failure:

\`\`\`json
{
  "kind": "error",
  "message": "Schema validation failed: ..."
}
\`\`\`

## Signature Bypass

> **Important:** Dev mode skips Ed25519 signing for speed. The host displays a loud "DEV: signature bypass" badge while connected. The production publish flow is unchanged.

## Connecting VS Code

1. Start \`oxp dev\` in your terminal
2. Open VS Code
3. Run command **OXP: Attach to Dev Server…**
4. Enter the WebSocket URL (\`ws://localhost:7373/dev\`)
5. Your extension panel appears and hot-reloads on every save

## Tips

- **Fast feedback loop** — save → see changes in ~100ms
- **Multiple hosts** — connect VS Code, Cursor, and Piye simultaneously
- **Error recovery** — if a pack fails, dev keeps running and shows the error; fix the issue and save again
- **Port conflicts** — use \`--port\` or set \`OXP_DEV_PORT\` env var`,
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
