import type { DocSection } from "../docs";

export const gettingStartedDocs: DocSection[] = [
  {
    slug: "installation",
    title: "Installation",
    category: "Getting Started",
    summary:
      "Install the OXP CLI and set up your development environment in under two minutes.",
    body: `Getting started with OXP takes less than two minutes. You need Node.js, a package manager, and you're ready to build your first extension.

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | ≥ 22 | LTS recommended. Check with \`node -v\` |
| **pnpm** | ≥ 10 | Or npm / yarn — all work |
| **Git** | Any | For version control |

OXP extensions can be written in **TypeScript** (declarative UI, HTML-based) or **Rust** (WASI components). For Rust extensions you also need:

| Requirement | Version | Notes |
|---|---|---|
| **Rust** | stable | Install via [rustup](https://rustup.rs/) |
| **wasm32-wasip2 target** | — | \`rustup target add wasm32-wasip2\` |

## Install the CLI

The OXP CLI ships as a single npm package. Pick whichever package manager you already have — there is **no separate installer to download**.

:::tip Choose your manager
All three are first-class. The CLI is identical regardless of how you install it.
:::

### Persistent install (recommended)

\`\`\`bash title="npm"
npm  i -g @oxprotocol/cli
\`\`\`

\`\`\`bash title="pnpm"
pnpm add -g @oxprotocol/cli
\`\`\`

\`\`\`bash title="yarn"
yarn global add @oxprotocol/cli
\`\`\`

After install, verify with:

\`\`\`bash
oxp --version
# 0.1.0
\`\`\`

### One-shot (no install)

If you just want to scaffold a project without a global install:

\`\`\`bash
npx @oxprotocol/cli@latest create my-ext
pnpm dlx @oxprotocol/cli create my-ext
yarn dlx @oxprotocol/cli create my-ext
\`\`\`

### npm create shortcut

For scaffolding only, the dedicated \`create-oxp\` wrapper plays nicely with the \`npm create\` convention:

\`\`\`bash
npm  create oxp@latest my-ext
pnpm create oxp my-ext
yarn create oxp my-ext
\`\`\`

## Environment Variables

The CLI respects two environment variables for configuration:

| Variable | Default | Purpose |
|---|---|---|
| \`OXP_REGISTRY\` | \`https://oxp.sh\` | Base URL of the OXP registry |
| \`OXP_HOME\` | \`~/.oxp\` | Config + credentials directory |

For production use, set the registry to the public instance:

\`\`\`bash
export OXP_REGISTRY=https://oxp.sh
\`\`\`

## Credentials

When you run \`oxp login\`, your API token is stored at \`~/.oxp/credentials\` with mode \`0600\` (owner-only read/write). The CLI sends it as \`Authorization: Bearer <raw>\` on authenticated requests.

You can rotate your token at any time:

\`\`\`bash
oxp token rotate
\`\`\`

## Setting Up from Source (Contributors)

If you want to contribute to OXP itself, clone the monorepo:

\`\`\`bash
git clone https://github.com/oxp-dev/oxp.git
cd oxp
pnpm install
pnpm build
\`\`\`

For local development with a database, spin up Postgres and MinIO:

\`\`\`bash
docker compose up -d
pnpm --filter @oxprotocol/web db:push
pnpm dev
\`\`\`

This gives you a local registry at \`http://localhost:3000\` with a Postgres database and S3-compatible object storage.

## What's Next

Now that you have the CLI installed, head to [Your First Extension](/docs/first-extension) to build and run your first OXP extension in under five minutes.`,
  },
  {
    slug: "first-extension",
    title: "Your First Extension",
    category: "Getting Started",
    summary:
      "Build, run, and hot-reload your first OXP extension in under five minutes.",
    body: `This tutorial walks you through creating, running, and hot-reloading your very first OXP extension. By the end, you'll have a working extension running in VS Code with live reload.

## Step 1: Scaffold the Project

\`\`\`bash
oxp create hello-world
cd hello-world
\`\`\`

This creates a new directory with the **hello-html** template (the default). You'll see:

\`\`\`
hello-world/
├── oxp.json           The extension manifest
├── ui/
│   └── index.html     Your extension's UI
└── README.md
\`\`\`

## Step 2: Examine the Manifest

Open \`oxp.json\`:

\`\`\`json title="oxp.json"
{
  "specVersion": "1",
  "id": "@yourname/hello-world",
  "publisher": "yourname",
  "version": "0.0.1",
  "displayName": "Hello World",
  "description": "Hello, OXP world.",
  "license": "MIT",
  "categories": ["other"],
  "engines": { "oxp": "^1.0.0" },
  "main": { "ui": "ui/index.html" },
  "ui": { "components": "oxp-ui-only", "preferredSurface": "panel" },
  "permissions": []
}
\`\`\`

Key fields:

- **\`id\`** — unique identifier in \`@publisher/slug\` format
- **\`main.ui\`** — path to your HTML entry point
- **\`permissions\`** — empty because this extension doesn't need any capabilities beyond rendering UI
- **\`ui.components\`** — set to \`oxp-ui-only\` which means declarative mode (no executable code)

## Step 3: Start the Dev Server

\`\`\`bash
oxp dev
\`\`\`

You'll see output like:

\`\`\`
╭───────────────────────────────────────────────────────────╮
│  oxp dev — DEV MODE (signature bypass, do not ship)       │
│  ws:    ws://localhost:7373/dev                            │
│  http:  http://localhost:7373/info                         │
│  root:  /path/to/hello-world                              │
╰───────────────────────────────────────────────────────────╯
\`\`\`

The dev server watches your files, re-packs on every change, and pushes updates over WebSocket. Connected hosts hot-reload instantly.

## Step 4: Open in VS Code

1. Open VS Code with the OXP host extension installed
2. Run the command **OXP: Attach to Dev Server…**
3. Enter the dev server URL: \`ws://localhost:7373/dev\`
4. Your extension appears in a panel

You'll see a "DEV: signature bypass" badge — this is expected. In dev mode, Ed25519 signing is skipped for speed.

:::warning Dev mode is local-only
The \`oxp dev\` server bypasses signature verification. **Never** point it at a remote host you don't control. For shipping bundles, always use \`oxp pack\` + \`oxp publish\`.
:::

## Step 5: Make Changes

Edit \`ui/index.html\`. As soon as you save, the dev server re-packs and the host hot-reloads your extension. No restart needed.

## Step 6: Choose a Template

OXP ships four templates for different use cases:

| Template | Command | Description |
|---|---|---|
| \`hello-html\` | \`oxp create -t hello-html myext\` | Static HTML UI (default) |
| \`hello-tree\` | \`oxp create -t hello-tree myext\` | Declarative \`oxp-ui-v1\` tree (no HTML needed) |
| \`hello-code\` | \`oxp create -t hello-code myext\` | TypeScript extension with logic |
| \`hello-rust\` | \`oxp create -t hello-rust myext\` | Rust WASI component |

For your first extension, \`hello-html\` or \`hello-tree\` are the simplest starting points. Move to \`hello-rust\` when you need logic beyond declarative UI.

## Step 7: Pack and Publish

When you're ready to share:

\`\`\`bash
oxp pack                    # Build a signed .oxp bundle
oxp login                   # Authenticate with the registry
oxp publish                 # Upload to oxp.sh
\`\`\`

The \`pack\` command creates a deterministic, Ed25519-signed \`.oxp\` bundle in your \`dist/\` directory. The \`publish\` command uploads it to the registry where anyone can install it.

## What's Next

- [Project Structure](/docs/project-structure) — understand every file in an OXP project
- [The Manifest](/docs/manifest) — deep dive into \`oxp.json\` fields
- [UI Components](/docs/ui-components) — build rich UIs with \`@oxprotocol/ui\`
- [Development Workflow](/docs/dev-workflow) — master \`oxp dev\` and hot-reloading`,
  },
  {
    slug: "project-structure",
    title: "Project Structure",
    category: "Getting Started",
    summary:
      "Anatomy of an OXP extension: every file, every directory, what's required and what's optional.",
    body: `Every OXP extension follows a standard directory structure. Understanding it helps you organize your code, add features, and avoid common mistakes.

## Full Layout

\`\`\`
my-extension/
├── oxp.json                    REQUIRED — the manifest
├── README.md                   Optional — surfaced on the extension page
├── CHANGELOG.md                Optional
├── LICENSE                     REQUIRED if license is not "UNLICENSED"
├── icons/
│   └── icon.svg                Referenced by manifest.icon
├── ui/                         Present when manifest.main.ui is set
│   ├── index.html              Entry document (CSP-locked)
│   ├── assets/
│   │   ├── main.[hash].js      ES2022, no eval
│   │   ├── main.[hash].css     Bundled styles
│   │   └── *.{woff2,svg,png}   Bundled assets
│   └── chunks/                 Code-split lazy chunks
├── wasm/                       Present when manifest.main.wasm is set
│   ├── core.wasm               WASI Component Model, Preview 2
│   └── core.d.ts               Generated TS types (informative)
├── contributions/              Files referenced by manifest.contributes
│   ├── commands.json
│   ├── views.json
│   ├── menus.json
│   └── keybindings.json
└── locales/                    Optional i18n catalogues
    ├── en.json                 REQUIRED if any locale present
    └── <bcp47>.json
\`\`\`

## Required Files

Every extension **must** have:

- **\`oxp.json\`** — the manifest. This is the heart of your extension. It declares identity, permissions, entry points, and compatibility.
- **\`LICENSE\`** — required unless your manifest sets \`license: "UNLICENSED"\`.
- **At least one entry point** — either \`ui/index.html\` (for UI extensions) or \`wasm/core.wasm\` (for component extensions), or both (hybrid).

## The Manifest (\`oxp.json\`)

The manifest is a JSON file conforming to \`spec/v1/manifest.schema.json\`. See the [Manifest Reference](/docs/manifest) for a complete field-by-field guide.

## UI Directory

If your extension has a user interface (most do), the \`ui/\` directory contains the HTML, CSS, JavaScript, and assets that render it.

### Constraints

These are enforced at \`oxp pack\` and again at \`oxp publish\`:

| Rule | Limit |
|---|---|
| Total \`ui/**\` size (gzipped) | ≤ 300 KiB (warn at 200) |
| Inline \`<script>\` blocks | Forbidden |
| \`eval\`, \`new Function\` | Forbidden |
| External fonts/images/CSS | Forbidden — bundle them |
| Service workers | Forbidden |

## Wasm Directory

For **component-v1** and **hybrid-v1** extensions, the \`wasm/\` directory contains your compiled WASI component.

| Rule | Value |
|---|---|
| Format | WASI Component Model, Preview 2 |
| Max size | ≤ 8 MiB per component |
| Initial memory | ≤ 16 MiB |
| Max memory | ≤ 256 MiB |

## Contributions Directory

The \`contributions/\` directory contains JSON files that declare commands, views, menus, keybindings, and other IDE-level contributions. Each file is referenced by a field in \`manifest.contributes\`.

## Locales Directory

If your extension supports internationalization, place BCP 47 locale files in \`locales/\`. If any locale is present, \`en.json\` is **required** as the fallback.

## Reserved Paths

The following paths are reserved and must not appear in your source:

| Path | Purpose |
|---|---|
| \`.oxp/integrity.json\` | Per-file SHA-256 manifest (added by \`oxp publish\`) |
| \`.oxp/SIGNATURE\` | Ed25519 or Sigstore signature (added by \`oxp publish\`) |

## Path Rules

All files must follow these rules:

- File names must match \`^[A-Za-z0-9._-][A-Za-z0-9._/-]{0,254}$\`
- No symlinks, hardlinks, devices, FIFOs, or sockets
- No path may resolve outside the bundle root (no \`../\` traversal)
- Total uncompressed size must not exceed **64 MiB**
- Individual files must not exceed **16 MiB**
- File count must not exceed **2,000**

## Build Output

When you run \`oxp pack\`, a \`.oxp\` file is created in \`dist/\`:

\`\`\`
dist/
└── hello-world-0.0.1.oxp
\`\`\`

This is a POSIX tar archive compressed with zstd (level 19). The \`.oxp\` suffix is the public contract — it's what gets uploaded to the registry and installed by users.`,
  },
];
