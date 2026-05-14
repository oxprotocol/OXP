import type { DocSection } from "../docs";

export const referenceDocs: DocSection[] = [
  {
    slug: "cli-reference",
    title: "CLI Reference",
    category: "Reference",
    summary:
      "Complete reference for every oxp subcommand with flags, examples, and environment variables.",
    body: `The \`oxp\` CLI is the primary tool for creating, developing, packing, publishing, and managing OXP extensions and MCP servers. It ships as a single npm package with no external dependencies.

## Installation

\`\`\`bash
npm i -g @oxprotocol/cli
pnpm add -g @oxprotocol/cli
\`\`\`

## Global Options

| Flag | Description |
|---|---|
| \`--help\`, \`-h\` | Show help for any command |
| \`--version\`, \`-v\` | Print version |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| \`OXP_REGISTRY\` | \`https://oxp.sh\` | Registry base URL |
| \`OXP_HOME\` | \`~/.oxp\` | Config, credentials, and logs directory |
| \`OXP_DEV_PORT\` | \`7373\` | Default port for \`oxp dev\` |
| \`OXP_TRUST_PUBLISHER\` | — | Comma-separated \`@publisher\` handles that skip the install consent prompt (e.g. \`@acme,@oxprotocol\`) |
| \`OXP_IDE_LAUNCHER\` | auto-detected | Force a specific IDE launcher binary (e.g. \`cursor\`) |

---

## Commands

### \`oxp create\`

Scaffold a new extension from a template.

\`\`\`bash
oxp create <name>
oxp create -t hello-tree <name>
oxp create --template hello-rust <name>
oxp create --list-templates
\`\`\`

| Flag | Description |
|---|---|
| \`-t\`, \`--template <name>\` | Template to use (default: \`hello-html\`) |
| \`--list-templates\` | List available templates and exit |

**Templates:** \`hello-html\` (React+TS), \`hello-code\` (code extension), \`hello-tree\` (declarative JSON UI), \`hello-rust\` (WASI component in Rust)

---

### \`oxp dev\`

Watch a project, re-pack on changes, and serve over WebSocket + HTTP for hot-reload. Spawns a fresh Extension Development Host window automatically.

\`\`\`bash
oxp dev
oxp dev --port 8080
oxp dev ./my-extension
oxp dev --host jetbrains   # force a specific IDE family
oxp dev --no-spawn         # start server without opening an EDH window
\`\`\`

| Flag | Description |
|---|---|
| \`-p\`, \`--port <n>\` | Server port (default: \`7373\`) |
| \`--host <family>\` | Force EDH to open in \`vscode\` or \`jetbrains\` |
| \`--no-spawn\` | Start the dev server without spawning an EDH |

Dev-server endpoints:

| Endpoint | Description |
|---|---|
| \`ws://localhost:<port>/dev\` | WebSocket reload channel |
| \`GET /info\` | Manifest, digest, bundle size |
| \`GET /manifest\` | Raw \`oxp.json\` |
| \`GET /bundle\` | Raw \`.oxp\` bytes |

:::warning
Dev mode skips Ed25519 signing for speed. The EDH shows a **"DEV: signature bypass"** badge. The production \`oxp publish\` flow is unchanged.
:::

---

### \`oxp pack\`

Build a deterministic, signed \`.oxp\` bundle from a project directory.

\`\`\`bash
oxp pack
oxp pack ./my-extension
\`\`\`

Output: \`dist/<slug>-<version>.oxp\`

Pipeline: validate \`oxp.json\` → enforce bundle policy → tar+zstd → hash → Ed25519 sign → write.

---

### \`oxp login\`

Authenticate with the registry.

\`\`\`bash
oxp login              # email + password in terminal
oxp login --browser    # OAuth device flow via browser
\`\`\`

Tokens are stored at \`~/.oxp/credentials\` (mode 0600).

---

### \`oxp logout\`

Revoke credentials locally (and on the server by default).

\`\`\`bash
oxp logout
oxp logout --local-only   # delete local token without revoking on the server
\`\`\`

---

### \`oxp whoami\`

Show the identity behind the stored credentials.

\`\`\`bash
oxp whoami
oxp whoami --json
\`\`\`

Prints handle, email, token scopes, and expiry. Uses the \`/api/v1/auth/whoami\` endpoint.

---

### \`oxp publish\`

Upload a signed bundle to the registry.

\`\`\`bash
oxp publish
oxp publish dist/my-ext-1.0.0.oxp
oxp publish --dry-run     # validate without uploading
\`\`\`

Requires \`oxp login\` and \`oxp keygen\`.

---

### \`oxp install\`

Install an extension or MCP server from the registry. Automatically detects installed IDEs and MCP-aware clients.

\`\`\`bash
oxp install @publisher/slug
oxp install @publisher/slug -y            # skip permission prompts
oxp install @publisher/slug --json        # machine-readable output
oxp install --from oxp://publisher/slug   # install from deep link
oxp install @publisher/slug --host vscode # limit to a specific IDE
\`\`\`

| Flag | Description |
|---|---|
| \`-y\`, \`--yes\` | Auto-accept every permission prompt |
| \`--json\` | Emit a single JSON line (includes \`verified\` and \`verifyReason\` for MCP installs) |
| \`--from <url>\` | Install from an \`oxp://\` deep link |
| \`--host <id>\` | Limit IDE detection to a specific host (repeatable) |
| \`--no-detect\` | Skip IDE detection; install to shared store only |
| \`--no-adapter\` | Skip auto-installing missing host adapters |

**For native OXP extensions**, the pipeline is: resolve → download → verify signature → verify digest → extract → verify per-file integrity → permission prompt → detect IDEs → install host wrappers.

**For MCP servers** (registry entries with \`install.command\`), the pipeline is: fetch spec → detect MCP-aware clients (VS Code, VS Code Insiders, Cursor, Windsurf, Claude Desktop) → merge config atomically into each → probe server reachability → log to \`~/.oxp/logs/mcp-install.jsonl\`.

MCP install output:

\`\`\`
✓ MCP install: @modelcontextprotocol/server-github
  launcher: npx -y @modelcontextprotocol/server-github
  clients:
    - Claude Desktop        — installed ✓
    - Cursor                — installed ✓
    - VS Code (Copilot)     — installed ✓
  verified reachable ✓
  restart the affected client(s) to load the new server.
  log: ~/.oxp/logs/mcp-install.jsonl
\`\`\`

---

### \`oxp install-url\`

Install a raw \`.wasm\` component from an \`https://\`, \`http://\`, or \`file://\` URL directly into the shared host-store.

\`\`\`bash
oxp install-url https://example.com/my-ext.wasm
oxp install-url --list     # list previously URL-installed extensions
\`\`\`

---

### \`oxp mcp rollback\`

Remove an MCP server from every detected client config, undoing \`oxp install\`.

\`\`\`bash
oxp mcp rollback @publisher/server
oxp mcp rollback @publisher/server --json
\`\`\`

OXP touches only the server's own key — no other config is modified. The rollback is logged to \`~/.oxp/logs/mcp-install.jsonl\`.

\`\`\`
oxp mcp rollback: @modelcontextprotocol/server-github
  ✓ removed from Claude Desktop    ~/Library/Application Support/Claude/claude_desktop_config.json
  ✓ removed from Cursor            ~/.cursor/mcp.json
  · VS Code (Copilot) — not configured
  restart the affected client(s) to apply the change.
  log: ~/.oxp/logs/mcp-install.jsonl
\`\`\`

---

### \`oxp doctor\`

Inspect this machine and report what OXP can see. Never modifies anything.

\`\`\`bash
oxp doctor
oxp doctor --json
oxp doctor --project ./my-extension
oxp doctor --no-project
\`\`\`

| Flag | Description |
|---|---|
| \`--json\` | Machine-readable JSON report |
| \`--project <dir>\` | Also inspect an OXP project for build-determinism issues |
| \`--no-project\` | Skip project inspection even when \`cwd\` has an \`oxp.json\` |

The report covers:

- **CLI + node** — version, platform, Node.js version
- **Registry** — URL, login state, handle, token scopes, expiry
- **Filesystem** — \`~/.oxp/\` layout: credentials, keys, host-store, cache, runtime binary
- **IDEs** — every detected host (VS Code, Cursor, Windsurf, JetBrains) with adapter status and paths
- **MCP servers** — every MCP-aware client's configured servers, each probed for reachability in parallel
- **Project** — build-determinism checks: lockfile, \`engines.node\` pin, gitignore, Rust toolchain pin

---

### \`oxp setup\`

Detect all installed IDEs and auto-install the OXP host adapter into each one.

\`\`\`bash
oxp setup
oxp setup --yes    # skip confirmation prompts
\`\`\`

---

### \`oxp keygen\`

Print the local Ed25519 publisher key ID, creating a new keypair if needed.

\`\`\`bash
oxp keygen
# → ed25519:0xABCD1234...
\`\`\`

Keys are stored at \`~/.oxp/keys/\` (mode 0600).

---

### \`oxp token rotate\`

Mint a successor API token; the old token gets a 5-minute grace window.

\`\`\`bash
oxp token rotate
oxp token rotate --days 90
oxp token rotate --name "CI token"
oxp token rotate --scope "publish:@acme/*"
\`\`\`

| Flag | Description |
|---|---|
| \`--days <n>\` | Token lifetime in days (default: 90) |
| \`--name <label>\` | Human-readable token label |
| \`--scope <scope>\` | Scope (e.g. \`publish:@acme/*\` or \`publish:@acme/specific-ext\`) |

---

### \`oxp icon\`

Generate or convert extension icons. Useful for creating the activity-bar SVG that VS Code family IDEs render as a monochrome mask.

\`\`\`bash
oxp icon help              # list available templates and options
oxp icon generate <name>   # generate a template icon
oxp icon convert <file>    # convert an existing image to OXP-compatible SVG
\`\`\`

---

### \`oxp protocol-register\`

Register the \`oxp://\` URL scheme on this machine so deep links open the CLI.

\`\`\`bash
oxp protocol-register
\`\`\`

---

## Programmatic Use

All subcommands are exported as async functions that return an exit code:

\`\`\`typescript
import { create, pack, publish, install } from "@oxprotocol/cli";

const code = await install(["@modelcontextprotocol/server-github", "--json"]);
\`\`\``,
  },
  {
    slug: "registry-api",
    title: "Registry API",
    category: "Reference",
    summary:
      "REST API reference for the OXP registry: resolve, download, publish, and manage extensions.",
    body: `The OXP registry exposes a REST API at \`/api/v1/\` for extension resolution, download, publishing, and token management. All responses are JSON unless otherwise noted.

## Base URL

\`\`\`
https://oxp.sh/api/v1
\`\`\`

For local development: \`http://localhost:3000/api/v1\`

## Authentication

Authenticated endpoints require a Bearer token:

\`\`\`
Authorization: Bearer oxp_<token>
\`\`\`

Tokens are obtained via \`oxp login\` and stored at \`~/.oxp/credentials\`.

## Endpoints

### Resolve Extension

\`\`\`
GET /api/v1/extensions/{publisher}/{slug}/resolve
\`\`\`

Returns the latest version metadata for an extension.

### Get Manifest

\`\`\`
GET /api/v1/extensions/{publisher}/{slug}/manifest
\`\`\`

Returns the \`oxp.json\` manifest for the latest version.

### Get Signature

\`\`\`
GET /api/v1/extensions/{publisher}/{slug}/signature
\`\`\`

Returns the Ed25519 or Sigstore signature for the latest version.

### Download Bundle

\`\`\`
GET /api/v1/extensions/{publisher}/{slug}/bundle
\`\`\`

Returns the raw \`.oxp\` bytes. Content-Type: \`application/vnd.oxp.bundle.v1.tar+zstd\`.

### List Versions

\`\`\`
GET /api/v1/extensions/{publisher}/{slug}/versions
\`\`\`

Returns a newest-first list of all versions with \`extensionId\` and \`latest\` marker.

### Publish Version

\`\`\`
POST /api/v1/extensions/{publisher}/{slug}/versions
Content-Type: multipart/form-data
Authorization: Bearer oxp_<token>
\`\`\`

Multipart fields:

| Field | Type | Description |
|---|---|---|
| \`bundle\` | file | The \`.oxp\` archive |
| \`signature\` | JSON | The signature object |

The endpoint validates:

1. Token scope matches \`publish:@{publisher}/*\` or \`publish:@{publisher}/{slug}\`
2. Manifest conforms to the JSON Schema
3. Bundle policy is enforced (no code in ui-v1, WIT pin for component-v1)
4. TOFU key pinning — key must match previous publishes
5. WIT pin (for component bundles) matches the server's canonical world

### Publisher Keys

\`\`\`
GET /api/v1/publishers/{handle}/keys
\`\`\`

Returns the Ed25519 public keys registered to a publisher. Cache: \`max-age=5, stale-while-revalidate=10\`.

### Token Rotation

\`\`\`
POST /api/v1/tokens/rotate
Authorization: Bearer oxp_<token>
\`\`\`

Mints a successor token with same or narrowed scopes. The caller token gets a 5-minute grace window before retirement. Returns the new raw secret exactly once.

## Error Responses

All errors follow a consistent shape:

\`\`\`json
{
  "error": {
    "code": "BUNDLE_POLICY_VIOLATION",
    "message": "ui-v1 bundles must not contain executable code",
    "details": { "file": "ui/malicious.js" }
  }
}
\`\`\`

### Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| \`UNAUTHORIZED\` | 401 | Missing or invalid token |
| \`FORBIDDEN\` | 403 | Token scope insufficient |
| \`NOT_FOUND\` | 404 | Extension or version not found |
| \`CONFLICT\` | 409 | Version already exists |
| \`SCHEMA_VALIDATION_FAILED\` | 422 | Manifest doesn't conform to schema |
| \`BUNDLE_POLICY_VIOLATION\` | 422 | Bundle contains forbidden content |
| \`KEY_PINNING_VIOLATION\` | 422 | Signing key doesn't match previous publishes |
| \`WIT_PIN_MISMATCH\` | 422 | WIT pin hash doesn't match server |
| \`RATE_LIMITED\` | 429 | Too many requests |`,
  },
  {
    slug: "contributing",
    title: "Contributing",
    category: "Reference",
    summary:
      "Set up the monorepo from source, run tests, and contribute to OXP.",
    body: `OXP is open source and contributions are welcome. This guide covers setting up the monorepo, understanding the codebase, and submitting changes.

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥ 22 | Runtime |
| pnpm | ≥ 10 | Package manager (monorepo workspaces) |
| Docker | Any | Local Postgres + MinIO |
| Rust | stable | For \`hello-rust\` example and component testing |
| Git | Any | Version control |

## Clone and Setup

\`\`\`bash
git clone https://github.com/oxp-dev/oxp.git
cd oxp
pnpm install
\`\`\`

## Build Everything

\`\`\`bash
pnpm build
\`\`\`

This builds all packages in dependency order:

1. \`@oxprotocol/types\` → 2. \`@oxprotocol/schema\` → 3. \`@oxprotocol/wit\` → 4. \`@oxprotocol/ui\` → 5. \`@oxprotocol/sdk\` → 6. \`@oxprotocol/bundle\` → 7. \`@oxprotocol/host-runtime\` → 8. \`@oxprotocol/host-core\` → 9. \`@oxprotocol/cli\` → 10. \`@oxprotocol/web\`

## Local Development

### Start Infrastructure

\`\`\`bash
docker compose up -d
\`\`\`

This starts:

- **Postgres** on port 5432 (user: \`oxp\`, password: \`oxp\`, db: \`oxp\`)
- **MinIO** on port 9000 (console on 9001, user: \`minioadmin\`, password: \`minioadmin\`)

Data persists in \`.docker/\` (gitignored). Wipe with \`docker compose down -v\`.

### Database Setup

\`\`\`bash
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @oxprotocol/web db:push
\`\`\`

### Start the Registry

\`\`\`bash
pnpm dev
\`\`\`

Opens the registry at \`http://localhost:3000\`.

## Running Tests

\`\`\`bash
pnpm test                  # all packages
pnpm -r --filter <pkg> test  # specific package
\`\`\`

Key test suites:

| Package | Tests | What They Cover |
|---|---|---|
| \`@oxprotocol/bundle\` | security.test.ts, wit-pin.test.ts | Bundle policy, WIT pinning |
| \`@oxprotocol/host-core\` | tofu-pinning.test.ts, permission-prompt.test.ts, activator.test.ts | TOFU, permissions, e2e activation |
| \`@oxprotocol/host-runtime\` | broker.test.ts | Capability broker, permission denial |
| \`@oxprotocol/types\` | token-scopes.test.ts | Scoped token validation |
| \`@oxprotocol/wit\` | canonical.test.ts | WIT canonical form + sha256 |

## Project Structure

| Directory | Purpose |
|---|---|
| \`spec/v1/\` | Normative specification (schema, protocol, bundle format) |
| \`packages/\` | npm packages published under \`@oxprotocol\` |
| \`hosts/\` | IDE host adapters (VS Code, Piye) |
| \`apps/web/\` | Registry website + API (Next.js) |
| \`examples/\` | Example extensions and test fixtures |

## Key Scripts

| Script | Description |
|---|---|
| \`pnpm build\` | Build all packages |
| \`pnpm dev\` | Start the registry dev server |
| \`pnpm test\` | Run all tests |
| \`pnpm lint\` | Lint all packages |
| \`pnpm clean\` | Remove all build artifacts |
| \`pnpm release:dry\` | Dry-run publish to npm |

## TypeScript Configuration

The monorepo uses a shared \`tsconfig.base.json\`:

- Target: ES2022
- Module: ESNext with Bundler resolution
- Strict mode enabled
- Declaration maps for debugging

Each package extends the base config and adds its own \`outDir\`, \`rootDir\`, and \`references\`.

## Code Style

- TypeScript for all packages
- ESM (\`"type": "module"\`) everywhere
- No external CLI libraries in the CLI package (keep install lean)
- Vitest for testing
- Explicit \`noUncheckedIndexedAccess\` for safety

## Pull Request Guidelines

1. **One concern per PR** — keep changes focused
2. **Tests required** — add or update tests for behavioral changes
3. **Security review line** — if your change touches security controls, confirm it doesn't regress Phase A/B/C
4. **Build must pass** — \`pnpm build && pnpm test\` must succeed
5. **Update roadmaps** — if your PR completes a roadmap item, tick it off`,
  },
];
