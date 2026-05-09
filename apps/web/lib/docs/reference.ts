import type { DocSection } from "../docs";

export const referenceDocs: DocSection[] = [
  {
    slug: "cli-reference",
    title: "CLI Reference",
    category: "Reference",
    summary:
      "Complete reference for every oxp subcommand with flags, examples, and environment variables.",
    body: `The \`oxp\` CLI is the primary tool for creating, developing, packing, and publishing OXP extensions. It ships as a single npm package with no external dependencies.

## Installation

\`\`\`bash
npm i -g @oxprotocol/cli
pnpm add -g @oxprotocol/cli
\`\`\`

## Global Options

| Flag | Description |
|---|---|
| \`--help\`, \`-h\` | Show help |
| \`--version\`, \`-v\` | Print version |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| \`OXP_REGISTRY\` | \`https://oxp.sh\` | Registry base URL |
| \`OXP_HOME\` | \`~/.oxp\` | Config + credentials directory |
| \`OXP_DEV_PORT\` | \`7373\` | Default port for \`oxp dev\` |

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

**Templates:** \`hello-html\`, \`hello-code\`, \`hello-tree\`, \`hello-rust\`

The \`publisher\` field is derived from your OS username. The \`slug\` is the project name lowercased.

### \`oxp dev\`

Watch a project, re-pack on changes, and serve over WebSocket + HTTP for hot-reload.

\`\`\`bash
oxp dev
oxp dev --port 8080
oxp dev ./my-extension
\`\`\`

| Flag | Description |
|---|---|
| \`-p\`, \`--port <n>\` | Server port (default: 7373) |

Endpoints served:

- \`ws://localhost:<port>/dev\` — WebSocket reload channel
- \`GET /info\` — manifest, digest, size
- \`GET /manifest\` — raw oxp.json
- \`GET /bundle\` — raw .oxp bytes

> Dev mode skips Ed25519 signing. Connected hosts show a "DEV" badge.

### \`oxp pack\`

Build a deterministic, signed \`.oxp\` bundle.

\`\`\`bash
oxp pack
oxp pack ./my-extension
\`\`\`

Output: \`dist/<slug>-<version>.oxp\`

The pack pipeline: validate manifest → enforce bundle policy → tar+zstd → hash → sign → write.

### \`oxp login\`

Authenticate with the registry.

\`\`\`bash
oxp login              # email + password in terminal
oxp login --browser    # OAuth device flow via browser
\`\`\`

Tokens stored at \`~/.oxp/credentials\` (mode 0600).

### \`oxp publish\`

Upload a signed bundle to the registry.

\`\`\`bash
oxp publish
oxp publish dist/my-ext-1.0.0.oxp
\`\`\`

Requires authentication (\`oxp login\`) and a signing key (\`oxp keygen\`).

### \`oxp install\`

Install an extension from the registry.

\`\`\`bash
oxp install @publisher/slug
oxp install @publisher/slug -y           # skip confirmation
oxp install @publisher/slug --json       # machine-readable output
oxp install --from oxp://publisher/slug  # from deep link
\`\`\`

| Flag | Description |
|---|---|
| \`-y\` | Auto-accept permission prompts |
| \`--json\` | Output in JSON format |
| \`--from <url>\` | Install from an \`oxp://\` deep link |

The install pipeline: resolve version → download → verify signature → verify digest → extract → verify per-file integrity → permission prompt → detect IDEs → install host wrappers.

### \`oxp keygen\`

Print the local Ed25519 publisher key ID, creating a new keypair if needed.

\`\`\`bash
oxp keygen
# → ed25519:0xABCD1234...
\`\`\`

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
| \`--days <n>\` | Token lifetime (default: 90) |
| \`--name <label>\` | Human-readable token label |
| \`--scope <scope>\` | Token scope (e.g. \`publish:@acme/*\`) |

### \`oxp protocol-register\`

Register the \`oxp://\` URL scheme on this machine so deep links open the CLI.

\`\`\`bash
oxp protocol-register
\`\`\`

## Programmatic Use

All subcommands are exported as functions:

\`\`\`typescript
import { create, pack, publish } from "@oxprotocol/cli";

const code = await create(["my-ext", "-t", "hello-rust"]);
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
