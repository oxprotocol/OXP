import type { DocSection } from "../docs";

export const overviewDocs: DocSection[] = [
  {
    slug: "overview",
    title: "Overview",
    category: "Overview",
    summary:
      "What OXP is today, what ships in v0.1, what's coming in v0.2 and v1.0, and the developer journey from create to install.",
    body: `**OXP** is the **Open eXtension Protocol** — an open, neutral specification for IDE extensions. Write your extension once, sign it, publish it to a signed registry, and install it into any IDE that ships an OXP host adapter. **No editor lock-in. No marketplace gatekeeping. No N×M integration tax.**

This page is the honest, level-headed view: what OXP is, what works **today** in v0.1, what's actively shipping in v0.2, and the longer arc toward v1.0.

## What OXP Is

OXP is three things working together:

1. **A protocol** — the v1 specification (\`spec/v1/\`) covering the manifest, bundle format, WIT contracts, and JSON-RPC host calls.
2. **A signed registry** — \`oxp.sh\` distributes \`.oxp\` bundles signed with Ed25519, with TOFU key pinning and OCI-compatible storage.
3. **A cross-IDE runtime** — host adapters that run the **same** \`.oxp\` bundle in **VS Code, Cursor, Windsurf, VSCodium, and JetBrains** with bit-identical conformance fingerprints.

Everything else — the CLI, the SDK, the UI component vocabulary — is composition over those three.

## What v0.1 Supports Today

These features are shipped, tested by the cross-host conformance suite, and live in production.

| Capability | VS Code family | JetBrains | Notes |
|---|---|---|---|
| **UI panels** (\`oxp-ui-v1\` tree or HTML) | ✅ | ✅ | Native render path in both |
| **Commands** (\`contributes.commands\`) | ✅ | ✅ | Title + when + handler |
| **Status bar items** | ✅ | ✅ | Text + tooltip + click handler |
| **MCP servers** (\`contributes.mcpServers\`) | ✅ | ✅ | Auto-registered with the IDE's MCP client |
| **Extension Development Host** (\`oxp dev\`) | ✅ | ✅ | Auto-spawned, hot-reload, error boundary |
| **WASI components** (Rust / TS via jco) | ✅ | ✅ | WASI Preview 2, capability broker |
| **Signed publish** (\`oxp publish\`) | ✅ | ✅ | Ed25519, TOFU pinning, scoped tokens |

Hosts: \`hosts/vscode\` covers **VS Code, Cursor, Windsurf, and VSCodium**. \`hosts/jetbrains\` covers **IntelliJ IDEA, WebStorm, PyCharm, GoLand, RustRover, and the rest of the IntelliJ Platform family**.

## On the Roadmap for v0.2

Specified in WIT, in active integration. Rolls out as conformance tests go green — not on a fixed calendar.

- **\`contributes.viewsContainers\`** — declarative activity-bar / tool-window icons that produce native chrome on every host.
- **\`editor/*\` API** — read selections, apply edits, decorate ranges, register code lenses.
- **\`stream/*\` RPCs** — long-running streaming for log tail, build output, incremental search.
- **Tree views** — virtualized trees with native renderers (currently HTML-only).
- **Webview messaging API** — typed bidirectional postMessage for full-screen editors.
- **Neovim host adapter** — third reference host. WIT is identical; Lua adapter in progress.

## Looking Toward v1.0

The v1 milestone is about depth, not new surfaces.

- **L2 native renderers everywhere** — every host paints \`@oxprotocol/ui\` components with the IDE's native toolkit (no webview fallback).
- **Spec donated to a neutral foundation** (CNCF Sandbox or Eclipse) once three external IDE vendors ship L1 or higher.
- **Marketplace adapters** — first-class read-side bridges from \`oxp.sh\` into VS Code Marketplace, JetBrains Marketplace, and Open VSX.
- **Reproducible builds** — every bundle's tar+zstd output is byte-identical from source, with a public \`oxp reproduce\` verifier.
- **Enterprise registries** — fully documented self-hosting path on any OCI registry, with SAML/SCIM in the web UI.

## The Developer Journey in One Glance

\`\`\`
   create  ──►  develop  ──►  pack  ──►  publish  ──►  install
   ────────     ─────────     ──────     ─────────     ─────────
   oxp create   oxp dev       oxp pack   oxp publish   oxp install
   pick a       EDH window    tar+zstd   to oxp.sh     in any
   template     auto-opens    +Ed25519   signed +      OXP host
                hot-reload    signature  TOFU-pinned
\`\`\`

Each step is one command. No marketplace review queue, no manual signing dance, no per-IDE packaging step.

### 1. Create

\`\`\`bash
oxp create my-ext           # interactive picker
oxp create my-ext -t hello-react   # React + TypeScript template
\`\`\`

Five templates ship today: \`hello-html\` (React + TypeScript, the default), \`hello-react\` (alias), \`hello-tree\` (declarative JSON tree, no JS), \`hello-code\` (TS extension with logic), \`hello-rust\` (WASI component).

### 2. Develop

\`\`\`bash
oxp dev
\`\`\`

The CLI spawns an **Extension Development Host** window of your IDE automatically. Your extension appears in the sidebar. Save a file → bundle re-packs → host hot-reloads. No manual WebSocket URL, no "attach" command, no configuration. Press \`Ctrl+C\` in the terminal to end the session — the EDH window closes itself. See [Development Workflow](/docs/dev-workflow) and the [EDH guide](/docs/edh) for details.

### 3. Pack

\`\`\`bash
oxp pack
\`\`\`

Produces a deterministic, Ed25519-signed \`.oxp\` bundle in \`dist/\`. Bundle policy is enforced locally (size limits, kind/permissions consistency, WIT pin for components).

### 4. Publish

\`\`\`bash
oxp login                     # one-time, stores token in ~/.oxp/credentials
oxp publish                   # uploads dist/<slug>-<version>.oxp
\`\`\`

The registry re-validates the manifest, re-checks the bundle policy, verifies the signature, and enforces TOFU key pinning. The default registry is **\`https://oxp.sh\`** — no localhost setup required to ship to real users.

### 5. Install

\`\`\`bash
oxp install @yourname/my-ext            # any registered OXP host
\`\`\`

The host downloads the bundle, verifies its signature against the pinned key, shows the install-time permission prompt, and activates the extension.

## What You Will *Not* Find in OXP

OXP is intentionally small. These are out of scope:

- **A new language.** Extensions are written in TypeScript, JavaScript, or Rust.
- **A new UI framework.** \`@oxprotocol/ui\` is a *vocabulary* (Box, Stack, Button, Text, …) — the host paints it however it likes.
- **A new package manager.** \`oxp\` is a thin CLI; pnpm/npm/yarn handle dependencies.
- **A new identity system.** Sigstore for code signing, OIDC for keyless flows, OCI for distribution.

The whole stack composes existing standards. The novelty is the *composition*.

## Where to Go Next

- [Installation](/docs/installation) — get the CLI in two minutes.
- [Your First Extension](/docs/first-extension) — build, run, hot-reload, ship.
- [Development Workflow](/docs/dev-workflow) — master \`oxp dev\` and the EDH.
- [Extension Development Host](/docs/edh) — full reference for the dev window.
- [The Manifest](/docs/manifest) — every field in \`oxp.json\`.
- [Architecture](/docs/architecture) — internals, package graph, runtime topology.`,
  },
  {
    slug: "introduction",
    title: "Introduction",
    category: "Overview",
    summary:
      "What OXP is, why it exists, and how it changes IDE extensions forever.",
    body: `OXP — the **Open eXtension Protocol** — is a small, neutral specification for IDE extensions. It lets a developer publish an extension _once_ and install it into _any_ IDE that has an OXP host adapter. **VS Code, JetBrains, and Neovim** all run conformant OXP hosts today; Cursor, Windsurf, and VSCodium inherit support via the VS Code adapter. More adapters land as the ecosystem fills in.

OXP is to IDE extensions what **LSP** is to language tooling and what **npm** is to JavaScript packages: a thin, boring, standards-based layer that ends the N×M integration problem.

:::info Spec v1 · Status
The v1 spec is finalized. Runtime **v0.1** is shipped: same WASI bundle produces an identical fingerprint on VS Code, JetBrains, and Neovim (verified by \`scripts/cross-host-conformance.sh\`). The registry is live at \`oxp.sh\`. The CLI is feature-complete. Phase A security controls are shipped — see [Security Model](/docs/security-model) before installing third-party bundles.
:::

## Why OXP Exists

Today, building an IDE extension means picking a single editor and locking into its ecosystem. A VS Code extension won't run in JetBrains. A JetBrains plugin won't run in Zed. Each ecosystem has its own manifest format, its own APIs, its own marketplace, and its own review process. If you want to support three editors, you write three extensions.

OXP eliminates this. One manifest. One bundle format. One CLI. Publish once, install everywhere.

## What OXP Invents

Just three things. Everything else is composition of existing standards.

1. **\`oxp.json\`** — a manifest format (~50 fields) covering identity, version, permissions, contributions, and host compatibility.
2. **\`@oxprotocol/ui\`** — a fixed component contract (\`Box\`, \`Stack\`, \`Button\`, \`Text\`, \`VirtualList\`, \`CodeBlock\`). Stay inside it and your extension gets the native render path on hosts that support it. Drop out of it and you fall back to webview rendering.
3. **CLI host adapters** — one small module per IDE that knows how to install, uninstall, and update via that IDE's own tooling. No directory sniffing, no monkey-patching.

## What OXP Does Not Invent

| Concern | Standard Adopted |
|---|---|
| Bundle distribution | **OCI Distribution Spec** |
| Publisher signing | **Sigstore / Cosign** (keyless, Rekor-logged) |
| Logic sandbox | **WASI Component Model** (Preview 2) |
| Wire protocol | **JSON-RPC 2.0** over Unix domain socket / named pipe |
| Discovery API | **Open VSX-compatible** read endpoints |
| Spec governance | **LSP/MCP-style** versioning + RFC process |

Five standards, one schema, one component library. That's the whole platform.

## Three Integration Tiers

OXP defines three tiers for IDE vendors. Each tier unlocks more capability, but **Tier 0 works today on every VS Code fork** with zero effort from the IDE vendor.

| Tier | What the IDE Does | What Users Get |
|---|---|---|
| **L0 — Sideload** | Nothing. OXP installs as a regular extension via the IDE's own CLI. | Works today. Webview UI at 60fps. |
| **L1 — Registry adapter** | Surface \`oxp.sh\` results in the IDE's extension search. | Native discovery; one click install. |
| **L2 — Native renderer** | Implement the \`@oxprotocol/ui\` component set in the IDE's native toolkit. | 120fps native UI. No webview. Same \`.oxp\` bundle. |

## What This Unlocks

- **For developers:** Write standard TypeScript, React, or Rust/Wasm. Publish once. Install anywhere. AI tools work because the code is conventional.
- **For IDE vendors** (Cursor, Theia, Gitpod, Coder, Zed, JetBrains): An extension story that isn't legally constrained by Microsoft's marketplace ToS. Adopt L1 in a week, L2 when ready.
- **For enterprises:** Private OXP registries (OCI-compatible), signed by Sigstore, auditable by default.

## Current Status

- **V1 spec:** Finalized at \`spec/v1/\`.
- **Runtime v0.1:** Shipped. Wasmtime 26 component-model host, JSON-RPC 2.0 over stdio, capability broker for log/storage/fs/net/secrets/commands/ui.
- **Host adapters:** **VS Code, JetBrains, and Neovim** all run the same \`.oxp\` bundle and produce an identical conformance fingerprint. Cursor, Windsurf, and VSCodium ride the VS Code adapter. Piye native L2 adapter is in progress.
- **Registry:** Running at \`oxp.sh\`.
- **CLI:** Fully functional — \`create\`, \`dev\`, \`pack\`, \`publish\`, \`install\`, \`login\`, \`keygen\`, \`token rotate\`.
- **Security:** Phase A complete — WASI sandbox, install-time prompts, TOFU key pinning, scoped tokens, CSP, bundle policy enforcement.

## Shipping Next (v0.2)

These capabilities are already specified in WIT and in active integration on all three hosts — they roll out as conformance tests go green, not on a fixed calendar:

- **Native UI surfaces** — \`ui/render\` painted into JetBrains tool windows and Neovim floating windows (today they're stashed in-memory).
- **Streams** — long-running \`stream/*\` RPCs for log tailing, build output, and incremental search.
- **\`editor/*\` APIs** — read selections, apply edits, decorate ranges, register code lenses.
- **\`surface/register\`** — declarative panel + view registration so one manifest entry produces native chrome on every host.

## Governance

OXP's spec is intended to be donated to a neutral foundation (CNCF Sandbox or Eclipse Foundation) once three external IDE adopters ship L1 or higher. The registry and CLI remain stewarded by the OXP project; the spec belongs to the ecosystem.`,
  },
  {
    slug: "architecture",
    title: "Architecture",
    category: "Overview",
    summary:
      "How OXP is structured: the monorepo, the package graph, the WASI runtime, and how everything fits together.",
    body: `OXP is organized as a **pnpm monorepo** with a clear separation between the spec, the runtime packages, the CLI, the registry web app, and the host adapters. This page walks through the architecture top-to-bottom.

## Monorepo Layout

\`\`\`
oxp/
├── spec/v1/              Normative specification (schema, protocol, bundle format)
├── packages/
│   ├── types/            TypeScript types for manifest + protocol (source of truth)
│   ├── schema/           JSON Schema + Ajv validator for oxp.json
│   ├── bundle/           Pack, unpack, sign, verify .oxp bundles
│   ├── sdk/              Author-facing SDK (defineExtension, HostApi, capability helpers)
│   ├── ui/               @oxprotocol/ui component vocabulary + DOM renderer
│   ├── cli/              The \`oxp\` command-line tool
│   ├── create-oxp/       \`npm create oxp\` wrapper (reserved, delegates to CLI)
│   ├── host-core/        Runtime-agnostic install + verify + activate pipeline
│   ├── host-runtime/     WASI Component Model runtime (jco backend, capability broker)
│   └── wit/              WIT contracts (oxp:host + oxp:extension worlds)
├── hosts/
│   ├── vscode/           VS Code / Cursor / Windsurf / VSCodium host adapter
│   ├── jetbrains/        IntelliJ Platform host adapter (Kotlin)
│   ├── neovim/           Neovim host adapter (Lua)
│   └── piye/             Piye IDE native L2 host adapter (in progress)
├── apps/
│   └── web/              Registry website + API (Next.js + Prisma + Postgres)
├── examples/
│   ├── hello-world/      HTML template extension
│   ├── hello-rust/       Rust WASI component extension
│   └── security-tests/   Malicious bundle fixtures for security testing
└── docker-compose.yml    Local Postgres + MinIO for development
\`\`\`

## Package Dependency Graph

The packages form a clean dependency tree with \`@oxprotocol/types\` at the root:

\`\`\`
types ─────────┬──── schema
               ├──── sdk
               ├──── ui
               ├──── wit ──────── host-runtime
               │                      │
               ├──── bundle ──────────┤
               │                      │
               └──── host-core ───────┘
                         │
                     cli ┘
\`\`\`

Every package is published to npm under the \`@oxprotocol\` scope. The \`workspace:*\` protocol is used for internal dependencies during development.

## The WASI Component Model

OXP extensions run as **WASI Preview 2 components**. This is not optional — it is the foundation of OXP's security model.

### Why WASI

| Property | Traditional (Worker threads) | WASI Component Model |
|---|---|---|
| Isolation | Realm-only; shared OS process | SFI; capabilities are linker-level imports |
| Universality | JS only; per-OS binaries | One \`.wasm\` runs on every OS / CPU / host |
| Languages | JS / TS | Rust, Go, C/C++, Python, JS (via jco) |
| Standardization | Ad-hoc | Bytecode Alliance standard |
| Capability model | Runtime checks | Type system (WIT imports) |
| Audit story | "Trust our gate code" | "Diff the import list" |

### Runtime Topology

The WIT contract is identical on both backends — that is the entire point.

\`\`\`
┌────────────────────── Host ──────────────────────┐
│  @oxprotocol/host-runtime                        │
│  ┌──────────────────┬────────────────────────┐   │
│  │ NODE / DESKTOP   │ BROWSER / WEBVIEW      │   │
│  │ wasmtime or      │ native WebAssembly     │   │
│  │ jco shim         │ + jco-transpiled shim  │   │
│  └────────┬─────────┴──────────┬─────────────┘   │
│           │  WIT host-funcs    │                  │
│           ▼  (broker)          ▼                  │
│  ┌────────────────────────────────────────────┐   │
│  │ Extension component (.wasm)                │   │
│  │  imports: oxp:host/ui, oxp:host/fs, …      │   │
│  │  exports: lifecycle, ui-handler, …         │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
\`\`\`

## Bundle Kinds

Every OXP bundle has a **kind** that drives security policy:

| Kind | Description | Code Allowed |
|---|---|---|
| \`ui-v1\` | Declarative JSON tree only. No executable code. | ❌ No JS/TS/Wasm |
| \`component-v1\` | Ships a WASI component. Must declare a WIT pin. | ✅ Wasm only |
| \`hybrid-v1\` | Both a UI tree and a Wasm component. | ✅ Wasm only |

Existing bundles published before the \`kind\` field default to \`ui-v1\` on read — backward compatible.

## WIT Contracts

The \`packages/wit/\` package is the most important package in the repo. It contains the WIT (WebAssembly Interface Types) contracts that define the interface between host and extension:

- **\`oxp:host@0.1.0\`** — capabilities the host provides: \`log\`, \`storage\`, \`ui\`, \`fs\`, \`net\`, \`secrets\`, \`commands\`
- **\`oxp:extension@0.1.0\`** — interfaces extensions export: \`lifecycle\`, \`ui-handler\`, \`command-handler\`

The install prompt reads the component's import list at install time. The binary cannot import what the manifest did not declare, because the registry validates \`manifest.permissions ⊇ component.imports\` on upload.

## The Capability Broker

The **CapabilityBroker** in \`packages/host-runtime/src/broker.ts\` mediates every host call from a Wasm extension. It:

1. Checks the manifest's declared permissions
2. Validates the call against the granted scope
3. Routes to the actual host implementation
4. Enforces per-call time limits (\`runWithTimeout\`)
5. Logs every call for audit

This is the trust boundary. The SDK, the webview, the extension code — none of them are trusted. Only the broker decides what gets through.

## The Registry

The registry (\`apps/web/\`) is a **Next.js** application backed by **Prisma** + **Postgres** (Neon). It provides:

- **REST API** (\`/api/v1/\`): resolve, manifest, signature, bundle download, versions, publisher keys, tokens
- **Web UI**: browse, search, detail pages, sign-in, dashboard
- **Publish pipeline**: manifest validation, bundle policy enforcement, signature verification, WIT pin check, TOFU key pinning
- **Auth**: NextAuth v5 with credentials + JWT strategy, scoped API tokens

The registry is designed to be replaced — any OCI-compatible registry works for bundle distribution. The \`oxp.sh\` registry adds publisher identity and the web UI on top.`,
  },
];
