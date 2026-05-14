import type { DocSection } from "../docs";

export const fundamentalsDocs: DocSection[] = [
  {
    slug: "manifest",
    title: "The Manifest",
    category: "Fundamentals",
    summary:
      "Complete field-by-field reference for oxp.json — the heart of every OXP extension.",
    body: `Every OXP extension is defined by a single \`oxp.json\` file at its root. This manifest declares identity, permissions, entry points, compatibility, and more. It conforms to the JSON Schema at \`spec/v1/manifest.schema.json\`.

## Minimal Example

\`\`\`json
{
  "specVersion": "1",
  "id": "@acme/hello",
  "publisher": "acme",
  "version": "1.0.0",
  "displayName": "Hello Extension",
  "license": "MIT",
  "engines": { "oxp": "^1.0.0" },
  "main": { "ui": "ui/index.html" },
  "permissions": []
}
\`\`\`

## Field Reference

### Identity Fields

| Field | Type | Required | Description |
|---|---|---|---|
| \`specVersion\` | \`"1"\` | ✅ | Always \`"1"\` for v1 extensions |
| \`id\` | string | ✅ | Unique ID in \`@publisher/slug\` format |
| \`publisher\` | string | ✅ | Lowercase kebab-case handle, must match the id |
| \`version\` | string | ✅ | Strict semver 2.0.0 (e.g. \`"1.2.3"\`) |
| \`displayName\` | string | ✅ | Human-readable name shown in UIs |
| \`description\` | string | — | Short description for search and browse |
| \`license\` | string | ✅ | SPDX identifier or \`"UNLICENSED"\` |

### Entry Points

The \`main\` object tells the host how to load your extension:

\`\`\`json
{ "main": { "ui": "ui/index.html" } }
{ "main": { "wasm": "wasm/core.wasm" } }
{ "main": { "ui": "ui/index.html", "wasm": "wasm/core.wasm" } }
\`\`\`

At least one of \`ui\` or \`wasm\` is required. Setting both creates a **hybrid-v1** bundle.

### Bundle Kind

\`\`\`json
{ "kind": "ui-v1" }
\`\`\`

Explicit classification. When omitted, derived from \`main\`:

- \`main.ui\` only → \`ui-v1\` (declarative, no code)
- \`main.wasm\` only → \`component-v1\` (WASI component)
- Both → \`hybrid-v1\`

### Permissions

\`\`\`json
{
  "permissions": [
    { "id": "fs.read", "scope": ["/workspace/**"], "rationale": "Read project files" },
    { "id": "net.fetch", "scope": ["https://api.example.com/*"], "rationale": "Fetch data" }
  ]
}
\`\`\`

Each permission has an \`id\` from the [capability catalog](/docs/permissions), optional \`scope\` globs, and a \`rationale\` shown to users at install. See [Permissions](/docs/permissions) for the full catalog.

### UI Hints

\`\`\`json
{
  "ui": {
    "components": "oxp-ui-v1",
    "preferredSurface": "panel",
    "themeable": true
  }
}
\`\`\`

| Value | Meaning |
|---|---|
| \`oxp-ui-only\` | Declarative tree only, no code execution path |
| \`oxp-ui-v1\` | Standard V1 component vocabulary |
| \`escape-hatch\` | Full HTML/JS (deprecated — closed by WASM pivot) |

\`preferredSurface\` can be \`"sidebar"\`, \`"panel"\`, \`"editor"\`, \`"modal"\`, or \`"statusbar"\`.

### Host Compatibility

\`\`\`json
{
  "hosts": {
    "vscode": { "compatible": true, "minVersion": "1.95.0" },
    "cursor": { "compatible": true },
    "jetbrains": { "compatible": false, "reason": "L2 adapter pending" }
  }
}
\`\`\`

### Contributions

The \`contributes\` object declares UI surfaces and behaviors your extension registers with the host. Each contribution is **declarative** — the host parses it at install time and wires up the chrome (commands, view containers, menus) without running any of your code. This is what lets a single bundle paint native UI in VS Code, Cursor, Windsurf, VSCodium, **and** JetBrains.

\`\`\`json
{
  "contributes": {
    "commands": [ ... ],
    "viewsContainers": { ... },
    "views": { ... },
    "keybindings": [ ... ],
    "mcpServers": [ ... ]
  }
}
\`\`\`

Contributions may be inlined as shown, or pulled from sibling files for tidiness:

\`\`\`json
{
  "contributes": {
    "commands": "contributions/commands.json",
    "viewsContainers": "contributions/viewsContainers.json"
  }
}
\`\`\`

#### \`contributes.commands\`

Each command registers a callable handler that shows up in the IDE's command palette and can be bound to keybindings, menus, or invoked programmatically by your extension.

\`\`\`json
{
  "contributes": {
    "commands": [
      {
        "id": "hello.greet",
        "title": "Hello: Greet the World",
        "category": "Hello",
        "icon": "$(megaphone)",
        "when": "workspaceFolderCount > 0"
      },
      {
        "id": "hello.refresh",
        "title": "Hello: Refresh View",
        "category": "Hello",
        "icon": "$(refresh)"
      }
    ]
  }
}
\`\`\`

| Field | Type | Required | Description |
|---|---|---|---|
| \`id\` | string | yes | Unique within the extension. Convention: \`<prefix>.<verb>\` (e.g. \`hello.greet\`) |
| \`title\` | string | yes | Shown in the command palette and menus |
| \`category\` | string | no | Groups commands in the palette (e.g. \`"Hello"\` → \`Hello: Greet the World\`) |
| \`icon\` | string | no | Codicon (\`$(name)\`) on VS Code family; mapped to the closest IntelliJ icon on JetBrains |
| \`when\` | string | no | Boolean expression evaluated against host context keys; command is hidden when false |

Commands are dispatched to your extension over the \`commands/execute\` RPC. Register the handler in your extension code:

\`\`\`ts
import { commands } from "@oxprotocol/sdk";

commands.register("hello.greet", async () => {
  // your handler
});
\`\`\`

#### \`contributes.viewsContainers\`

A **view container** is a top-level UI slot in the IDE chrome — the activity-bar icon (VS Code family) or tool-window stripe button (JetBrains) that owns your extension's sidebar.

\`\`\`json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "hello-sidebar",
          "title": "Hello",
          "icon": "media/hello.svg"
        }
      ],
      "panel": [
        {
          "id": "hello-panel",
          "title": "Hello Logs",
          "icon": "$(output)"
        }
      ]
    }
  }
}
\`\`\`

| Field | Type | Required | Description |
|---|---|---|---|
| \`id\` | string | yes | Referenced by \`contributes.views\` to mount views inside this container |
| \`title\` | string | yes | Tooltip text and accessible label |
| \`icon\` | string \\| \`$(codicon)\` | yes | Path to an SVG (16×16, monochrome) **or** a codicon reference |

Two **locations** are supported in v0.1:

- \`activitybar\` — the vertical icon strip on the left in VS Code family, the right tool-window stripe in JetBrains.
- \`panel\` — the horizontal bottom panel in VS Code family, the bottom tool-window strip in JetBrains.

Views inside a container are declared with \`contributes.views\` (keyed by container id) — covered separately in [UI Components](/docs/ui-components).

#### \`contributes.keybindings\`

\`\`\`json
{
  "contributes": {
    "keybindings": [
      { "command": "hello.greet", "key": "ctrl+alt+h", "mac": "cmd+alt+h" }
    ]
  }
}
\`\`\`

#### \`contributes.mcpServers\`

Auto-registers Model Context Protocol servers with the IDE's MCP client. See the [MCP Integration guide](/docs/mcp-integration) for the full schema.

### Categories

Valid categories: \`ai\`, \`database\`, \`data-tools\`, \`debuggers\`, \`devops\`, \`editor\`, \`education\`, \`formatters\`, \`language-support\`, \`linters\`, \`notebooks\`, \`other\`, \`productivity\`, \`scm\`, \`snippets\`, \`testing\`, \`themes\`, \`visualization\`.

### WIT Pin (Component Extensions)

Required for \`component-v1\` and \`hybrid-v1\` bundles:

\`\`\`json
{
  "wit": {
    "package": "oxp:extension",
    "version": "0.1.0",
    "sha256": "a1b2c3..."
  }
}
\`\`\`

The SHA-256 is computed over the canonical form of the WIT world. The registry rejects mismatches on publish; the host refuses to instantiate mismatched components on install.

### Resource Limits

\`\`\`json
{
  "limits": {
    "timeMsPerCall": 100,
    "maxMemoryMb": 64
  }
}
\`\`\`

| Limit | Default | Maximum |
|---|---|---|
| \`timeMsPerCall\` | 100 ms | 5,000 ms |
| \`maxMemoryMb\` | 64 MiB | 256 MiB |

### Auto-Generated Fields

These are set by \`oxp publish\` — do **not** write them by hand:

- **\`integrity.bundleSha256\`** — SHA-256 of the uncompressed tar stream
- **\`integrity.signedBy\`** — publisher key ID
- **\`integrity.signatureAlgo\`** — \`"ed25519"\` or \`"sigstore"\``,
  },
  {
    slug: "ui-components",
    title: "UI Components",
    category: "Fundamentals",
    summary:
      "Build rich extension UIs with the @oxprotocol/ui component vocabulary.",
    body: `\`@oxprotocol/ui\` provides a **frozen V1 component vocabulary** for building extension interfaces. Authors compose a tree of typed components; hosts render them natively (Piye) or via the DOM backend (VS Code webview).

## The Component Set

OXP V1 ships exactly six components. New components require a spec bump — this vocabulary is intentionally small and stable.

| Component | Purpose | Container |
|---|---|---|
| \`Box\` | Generic container with padding and gap | ✅ |
| \`Stack\` | Flexbox-style vertical or horizontal layout | ✅ |
| \`Text\` | Text content with variant styling | — |
| \`Button\` | Clickable action trigger | — |
| \`VirtualList\` | Efficiently render large lists | ✅ |
| \`CodeBlock\` | Syntax-highlighted code display | — |

## Basic Usage

\`\`\`typescript
import { Stack, Text, Button } from "@oxprotocol/ui";
import { defineExtension } from "@oxprotocol/sdk";

export default defineExtension({
  activate(host) {
    host.renderTree(
      Stack({ gap: 2 }, [
        Text("Hello, OXP!", { variant: "heading" }),
        Text("Build once. Install everywhere."),
        Button({ label: "Get Started", action: "start", variant: "primary" }),
      ])
    );
  },
});
\`\`\`

## Component Reference

### Box

Generic container with padding and gap.

\`\`\`typescript
Box({ pad: 4, gap: 2 }, [
  Text("Inside a box"),
])
\`\`\`

| Prop | Type | Description |
|---|---|---|
| \`pad\` | \`0 \\| 1 \\| 2 \\| 3 \\| 4 \\| 6 \\| 8\` | Padding (spacing scale) |
| \`gap\` | \`0 \\| 1 \\| 2 \\| 3 \\| 4 \\| 6 \\| 8\` | Gap between children |
| \`children\` | \`UiNode[]\` | Child components |

### Stack

Flexbox layout — vertical or horizontal.

\`\`\`typescript
Stack({ axis: "horizontal", gap: 2, align: "center" }, [
  Button({ label: "Save", action: "save" }),
  Button({ label: "Cancel", action: "cancel", variant: "ghost" }),
])
\`\`\`

| Prop | Type | Default | Description |
|---|---|---|---|
| \`axis\` | \`"vertical" \\| "horizontal"\` | \`"vertical"\` | Layout direction |
| \`gap\` | spacing scale | — | Gap between children |
| \`align\` | \`"start" \\| "center" \\| "end" \\| "stretch"\` | — | Cross-axis alignment |

### Text

\`\`\`typescript
Text("Hello", { variant: "heading" })
\`\`\`

| Prop | Type | Description |
|---|---|---|
| \`value\` | \`string\` | The text content (first argument) |
| \`variant\` | \`"body" \\| "heading" \\| "caption" \\| "code"\` | Visual style |

### Button

\`\`\`typescript
Button({ label: "Run", action: "run-task", variant: "primary", disabled: false })
\`\`\`

| Prop | Type | Description |
|---|---|---|
| \`label\` | \`string\` | Button text |
| \`action\` | \`string\` | Action ID sent to the host on click |
| \`variant\` | \`"primary" \\| "secondary" \\| "ghost" \\| "danger"\` | Visual style |
| \`disabled\` | \`boolean\` | Disable interaction |

### VirtualList

Efficiently renders large lists. The host may virtualize based on item count.

\`\`\`typescript
VirtualList({
  items: data.map(item => Text(item.name)),
  rowHeight: 28,
})
\`\`\`

### CodeBlock

\`\`\`typescript
CodeBlock({ value: "const x = 42;", language: "ts" })
\`\`\`

## Tree Validation

The \`validateTree()\` function checks that every node in a tree uses a known V1 component kind. It's used by \`oxp pack\` to reject bundles with non-V1 nodes, and by hosts as a runtime guard.

## Render Modes

| Mode | Description |
|---|---|
| **DOM renderer** | \`@oxprotocol/ui/dom\` — renders the tree to real DOM elements in a webview. Used by the VS Code host. |
| **Native renderer** | Host implements the component set in its native toolkit. Used by Piye (GPUI). Same \`.oxp\` bundle, 120fps native UI. |

The beauty of the component vocabulary is that your extension **doesn't need to know** which renderer is active. The same tree works everywhere.`,
  },
  {
    slug: "sdk",
    title: "Extension SDK",
    category: "Fundamentals",
    summary:
      "Use @oxprotocol/sdk to define extensions with typed APIs for host interaction.",
    body: `\`@oxprotocol/sdk\` is the author-facing SDK for OXP extensions. It provides \`defineExtension()\`, the \`HostApi\` interface, and typed wrappers around host capabilities. It works across VS Code webviews, Piye Workers, and \`oxp dev\`.

## defineExtension

Every extension's entry module exports a definition:

\`\`\`typescript
import { defineExtension } from "@oxprotocol/sdk";

export default defineExtension({
  async activate(host) {
    host.log("info", "Extension activated!");
    host.renderHtml("<h1>Hello, OXP!</h1>");
  },
  deactivate(host) {
    host.log("info", "Extension deactivated.");
  },
});
\`\`\`

\`defineExtension()\` is an identity helper — it provides full IntelliSense without any runtime overhead.

## The HostApi

The \`host\` object injected into \`activate()\` provides the runtime API:

| Method | Description |
|---|---|
| \`host.manifest\` | The parsed \`oxp.json\` manifest |
| \`host.files\` | Bundled files as a \`ReadonlyMap<string, Uint8Array>\` |
| \`host.renderHtml(html)\` | Render raw HTML in the extension panel |
| \`host.renderTree(tree)\` | Render an \`@oxprotocol/ui\` component tree |
| \`host.capability(name, args)\` | Call a host capability by name |
| \`host.log(level, message, data)\` | Log to the host output channel |

## Capability Helpers

Instead of stringly-typed \`host.capability()\` calls, use the typed helpers:

### Clipboard

\`\`\`typescript
import { clipboard } from "@oxprotocol/sdk";

const cb = clipboard(host);
const text = await cb.read();
await cb.write("copied!");
\`\`\`

### Storage

\`\`\`typescript
import { storage } from "@oxprotocol/sdk";

const store = storage(host);
await store.set("count", 42);
const val = await store.get("count");
await store.delete("count");
\`\`\`

### Network

\`\`\`typescript
import { net } from "@oxprotocol/sdk";

const api = net(host);
const response = await api.fetch("https://api.example.com/data");
const data = await response.json();
\`\`\`

> Network calls are routed through the capability broker. The user must grant \`net.fetch\` permission, and the URL must match the scope declared in your manifest.

## Typed Manifests

Use \`OxpManifest\` for type-safe manifest access:

\`\`\`typescript
import type { OxpManifest } from "@oxprotocol/sdk";

const manifest: OxpManifest = host.manifest;
console.log(manifest.version);
\`\`\`

## Lifecycle

Extensions follow a simple lifecycle:

1. **Activate** — called once when the extension loads. Set up your UI, register commands, connect to services.
2. **Deactivate** — called on uninstall, host shutdown, or eviction. Clean up resources. Best-effort — the host may kill the instance if this exceeds its time budget.

Both are optional, but at least \`activate\` should be provided to do anything useful.`,
  },
  {
    slug: "permissions",
    title: "Permissions",
    category: "Fundamentals",
    summary:
      "The capability catalog, sensitivity tiers, and how permissions protect users.",
    body: `OXP's permission system is built on the principle of **least privilege**. Extensions declare what they need in the manifest, users consent at install time, and the capability broker enforces grants at runtime. An extension literally cannot call APIs it wasn't granted — the WIT import is simply not linked.

## The Capability Catalog

Every permission has an \`id\` from this catalog, a sensitivity tier, and a description shown at install.

### Ambient Capabilities (always granted)

| ID | Description |
|---|---|
| \`notifications.show\` | Show toast notifications |
| \`statusbar.set\` | Update the status bar |

### Normal Capabilities (prompted at install)

| ID | Description |
|---|---|
| \`fs.read\` | Read files (scoped by glob patterns) |
| \`fs.write\` | Write files (scoped by glob patterns) |
| \`fs.watch\` | Watch file changes |
| \`fs.delete\` | Delete files |
| \`net.fetch\` | Make HTTP requests (scoped by URL patterns) |
| \`clipboard.read\` | Read the clipboard |
| \`clipboard.write\` | Write to the clipboard |
| \`workspace.read\` | Read workspace state (open files, active editor) |
| \`workspace.write\` | Modify workspace state (open/edit files) |
| \`secrets.read\` | Read from the OS keychain |
| \`secrets.write\` | Write to the OS keychain |
| \`events.publish\` | Publish cross-extension events |
| \`events.subscribe\` | Subscribe to cross-extension events |

### Sensitive Capabilities (extra warning)

| ID | Description |
|---|---|
| \`commands.executeHost\` | Execute host-registered commands |

### Verified-Only Capabilities

These require a verified publisher (domain proof or GitHub OAuth):

| ID | Description |
|---|---|
| \`terminal.spawn\` | Spawn terminal processes |
| \`terminal.shell\` | Run shell commands (pipes, redirects) |
| \`process.kill\` | Kill running processes |

## Declaring Permissions

In \`oxp.json\`, each permission entry has three fields:

\`\`\`json
{
  "permissions": [
    {
      "id": "fs.read",
      "scope": ["/workspace/**"],
      "rationale": "Read source files for analysis"
    },
    {
      "id": "net.fetch",
      "scope": ["https://api.github.com/*"],
      "rationale": "Fetch repository metadata from GitHub"
    }
  ]
}
\`\`\`

- **\`id\`** — capability name from the catalog above
- **\`scope\`** — glob patterns restricting what the capability can access
- **\`rationale\`** — plain-text explanation shown to the user

## Install-Time Prompts

When a user runs \`oxp install\`, they see each requested permission with its rationale. They choose:

- **Allow All** — grant every requested permission
- **Customize** — grant/deny individual permissions
- **Deny** — cancel installation

Choices are persisted per \`(publisher, slug)\` in \`grants.json\`. On version updates, if new permissions appear, the user is re-prompted for just the new ones.

## How Permissions Map to WIT Imports

For component-v1 extensions, permissions directly control which WIT interfaces are linked:

| Manifest Permission | WIT Import Unlocked |
|---|---|
| \`fs.read\` | \`oxp:host/fs.read-file\`, \`oxp:host/fs.stat\`, \`oxp:host/fs.list-dir\` |
| \`fs.write\` | \`oxp:host/fs.write-file\` |
| \`net.fetch\` | \`oxp:host/net.fetch\` (URL filtered) |
| \`secrets.read\` | \`oxp:host/secrets.get\` |
| (always) | \`oxp:host/storage\`, \`oxp:host/log\`, \`oxp:host/ui\` |

The registry validates that \`manifest.permissions ⊇ component.imports\` on upload. A mismatch is a publish error. The binary cannot fabricate symbols it did not declare.`,
  },
  {
    slug: "bundle-format",
    title: "Bundle Format",
    category: "Fundamentals",
    summary: "How .oxp bundles are packed, signed, distributed, and verified.",
    body: `OXP bundles are **OCI artifacts** signed with **Sigstore** (or Ed25519 for offline use). Both standards are adopted verbatim — OXP adds only the manifest schema and artifact media types.

## The .oxp File

A \`.oxp\` file is a **POSIX tar** archive compressed with **zstd** level 19.

Key properties:

- **\`oxp.json\` is always the first tar entry** — enables streaming validation
- **Entries are in lexicographic order** — deterministic builds
- **All mtimes are \`1980-01-01T00:00:00Z\`** — identical inputs produce identical hashes
- **Modes: \`0644\` for files, \`0755\` for directories** — reproducible

## Bundle Digest

The digest is the **SHA-256 of the uncompressed tar stream** (not the compressed file). This is stable across recompression and matches how OCI content-addresses layers.

## Per-File Integrity

\`oxp publish\` generates \`.oxp/integrity.json\`:

\`\`\`json
{
  "specVersion": "1",
  "algorithm": "sha-256",
  "files": {
    "oxp.json": "e3b0c44...",
    "ui/index.html": "a4d2...",
    "wasm/core.wasm": "9b1c..."
  }
}
\`\`\`

Hosts verify per-file digests on extract. Mismatches are hard errors.

## Signing

### Ed25519 (default, offline-capable)

Every \`oxp pack\` signs the bundle digest with an Ed25519 key stored at \`~/.oxp/keys/\`. The signature is written to \`.oxp/SIGNATURE\`:

\`\`\`json
{
  "alg": "ed25519",
  "keyId": "ed25519:0x...",
  "signature": "base64...",
  "payload": { "digest": "sha256:...", "signedAt": "rfc3339" }
}
\`\`\`

### Sigstore (keyless, transparency-logged)

For maximum trust, OXP supports Sigstore keyless signing. The signature includes a Fulcio certificate, OIDC identity proof, and Rekor inclusion proof.

## OCI Representation

OXP bundles are stored in any OCI-compliant registry. Media types:

| Media Type | Purpose |
|---|---|
| \`application/vnd.oxp.config.v1+json\` | OCI config (copy of oxp.json) |
| \`application/vnd.oxp.bundle.v1.tar+zstd\` | The .oxp archive layer |
| \`application/vnd.oxp.signature.v1+json\` | Sigstore/Ed25519 signature |

This means Docker Hub, GHCR, ECR, GAR, Harbor, and any OCI registry can host OXP bundles. Mirroring is a single command:

\`\`\`bash
oras copy oci.oxp.sh/acme/postgres:1.4.2 internal.corp/oxp/acme/postgres:1.4.2
\`\`\`

## Size Limits

| Limit | Value |
|---|---|
| Total uncompressed bundle | 64 MiB |
| Individual file | 16 MiB |
| File count | 2,000 |
| UI directory (gzipped) | 300 KiB |
| Wasm component | 8 MiB |`,
  },
  {
    slug: "host-adapters",
    title: "Host Adapters",
    category: "Fundamentals",
    summary:
      "How OXP integrates with VS Code, JetBrains, Cursor, Windsurf, and other IDEs through host adapters.",
    body: `A **host adapter** is a small module that bridges OXP into a specific IDE. It knows how to install, activate, render, and manage OXP extensions using that IDE's own APIs. The adapter is the only OXP-specific code an IDE needs.

## Supported Hosts

| Host | Status | Tier | Notes |
|---|---|---|---|
| VS Code | ✅ Shipped | L0 | \`hosts/vscode/\` — reference implementation |
| Cursor | ✅ Works | L0 | VS Code fork; uses the same adapter |
| Windsurf | ✅ Works | L0 | VS Code fork; uses the same adapter |
| VS Code Insiders | ✅ Works | L0 | VS Code fork; uses the same adapter |
| VSCodium | ✅ Works | L0 | VS Code fork; uses the same adapter |
| JetBrains family | 🔄 In progress | L1 | \`hosts/jetbrains/\` — IntelliJ Platform plugin |
| Piye IDE | 🔄 In progress | L2 (native) | \`hosts/piye/\` — GPUI-based native renderer |
| Zed | 📋 Planned | — | — |
| Theia | 📋 Planned | — | — |

---

## The VS Code Family Host

The VS Code host adapter (\`hosts/vscode/\`) is a standard VS Code extension. Because Cursor, Windsurf, VS Code Insiders, and VSCodium are all forks of VS Code, **the same \`.vsix\` package works in all of them**.

The adapter:

1. **Discovers** OXP extensions from the shared store (\`~/.oxp/host-store/\`)
2. **Activates** them by instantiating the WASI component via the jco backend
3. **Renders** UI trees using \`@oxprotocol/ui/dom\` in a sandboxed webview panel
4. **Mediates** host calls through the capability broker
5. **Enforces** CSP with per-render nonces (\`default-src 'none'\`)

### Commands

| Command | Description |
|---|---|
| \`OXP: Install Extension…\` | Install from the registry |
| \`OXP: Show Installed Extensions\` | List installed OXP extensions |
| \`OXP: Open Extension…\` | Open an installed extension's panel |
| \`OXP: Uninstall Extension…\` | Remove an OXP extension |
| \`OXP: Attach to Dev Server…\` | Connect to \`oxp dev\` for hot-reload |
| \`OXP: Reload Installed Extensions\` | Re-scan and reload all |
| \`OXP: Restart Dev Session\` | Dispose + reconnect (dev mode only) |
| \`OXP: Reload Bundle\` | Re-instantiate from current dev bundle |
| \`OXP: Detach Dev Session\` | Disconnect dev server, leave window open |

### Settings

| Setting | Default | Description |
|---|---|---|
| \`oxp.registry\` | \`https://oxp.sh\` | Registry base URL |
| \`oxp.useSharedStore\` | \`true\` | Use \`~/.oxp/host-store/\` so one \`oxp install\` works across all IDEs |

---

## The JetBrains Host

The JetBrains host (\`hosts/jetbrains/\`) is an IntelliJ Platform plugin that works across the entire JetBrains family: **IntelliJ IDEA, PyCharm, WebStorm, GoLand, Rider, CLion, PhpStorm, DataGrip**, and more.

The plugin:

1. **Discovers** OXP extensions from the same shared store (\`~/.oxp/host-store/\`)
2. **Activates** them via the WASI runtime
3. **Renders** UI trees in a right-side **Tool Window** (equivalent to VS Code's sidebar)
4. **Mediates** host calls through the same capability broker interface
5. Exposes commands via **Help → Find Action** (\`Ctrl+Shift+A\` / \`Cmd+Shift+A\`)

Because the OXP wire protocol is identical across IDE families, **the same \`.oxp\` bundle runs in VS Code and JetBrains without any changes**. The manifest, WIT contract, UI tree, and RPC calls are bit-equivalent.

### VS Code Family vs JetBrains Comparison

| Behavior | VS Code / Cursor / Windsurf | JetBrains (any IntelliJ-Platform IDE) |
|---|---|---|
| Extension UI location | Activity bar → Sidebar panel | Right tool window, OXP stripe button |
| Dev EDH spawn | \`code --new-window <workspace>\` | \`idea\` / \`pycharm\` / … via runtime-bin launcher |
| Command access | Command Palette (\`Ctrl+Shift+P\`) | Find Action (\`Ctrl+Shift+A\`) |
| Output channel | Output panel → \`OXP Dev Host\` | OXP Dev Host tool window (bottom dock) |
| Hot-reload mechanism | WebSocket → \`Extension.dispose()\` + re-instantiate | WebSocket → coroutine cancel + re-instantiate |
| Detach gesture | \`OXP: Detach Dev Session\` command | Tools → OXP → Detach |

---

## The Shared Store

\`oxp install\` places extensions in \`~/.oxp/host-store/\`. Every host adapter — VS Code family and JetBrains — reads from this same directory. A single install makes the extension available everywhere.

\`\`\`
~/.oxp/host-store/
└── @publisher/
    └── slug/
        └── 1.0.0/
            ├── oxp.json
            ├── ui/...
            └── .oxp/
                ├── integrity.json
                └── SIGNATURE
\`\`\`

---

## MCP Client Detection

When \`oxp install\` encounters an MCP server registry entry, it writes the server config into each detected MCP-aware client's config file. Clients are detected by checking whether their config parent directory exists:

| Client | Config file | Key |
|---|---|---|
| Claude Desktop | \`~/Library/Application Support/Claude/claude_desktop_config.json\` | \`mcpServers\` |
| Cursor | \`~/.cursor/mcp.json\` | \`mcpServers\` |
| VS Code (Copilot) | \`~/Library/Application Support/Code/User/mcp.json\` | \`servers\` |
| VS Code Insiders | \`~/Library/Application Support/Code - Insiders/User/mcp.json\` | \`servers\` |
| Windsurf | \`~/.codeium/windsurf/mcp_config.json\` | \`mcpServers\` |

All paths follow platform conventions: \`%APPDATA%\\Roaming\` on Windows, \`$XDG_CONFIG_HOME\` on Linux.

---

## Integration Tiers

### L0 — Sideload (works today)

The IDE does nothing special. OXP installs as a regular extension via the IDE's CLI or extension directory. The VS Code and JetBrains adapters handle everything from within the IDE.

### L1 — Registry Adapter

The IDE surfaces \`oxp.sh\` results in its built-in extension search. Users discover and install OXP extensions natively. The IDE calls the OXP resolve/install APIs behind the scenes. *(JetBrains target.)*

### L2 — Native Renderer

The IDE implements the \`@oxprotocol/ui\` component set in its native toolkit — GPUI for Piye, Swing for a future JetBrains L2. The same \`.oxp\` bundle gets 120fps native rendering without any webview overhead.

---

## Building a Host Adapter

A host adapter needs to:

1. **Import \`@oxprotocol/host-core\`** for the install/verify/activate pipeline
2. **Import \`@oxprotocol/host-runtime\`** for the WASI component runtime
3. **Import \`@oxprotocol/ui/dom\`** (or implement native rendering) for UI
4. **Wire** the IDE's command palette, panel system, and settings to OXP's APIs
5. **Provide** storage, filesystem, and other host capabilities through the broker`,
  },
];
