# OXP — Open eXtensions Protocol

Build one IDE extension. Run it across VS Code, Cursor, Windsurf, JetBrains, and more — without recompiling.

OXP is a cross-IDE extension protocol. Authors write a single signed `.oxp` bundle (UI layer + optional WASI component); the OXP runtime installs it into every IDE on the machine. No porting, no forking, no IDE-specific API differences.

- **Registry & docs** — [oxp.sh](https://oxp.sh)
- **Full documentation** — [oxp.sh/docs](https://oxp.sh/docs)
- **CLI** — `@oxprotocol/cli`

---

## For users — install an extension

Requires **Node ≥ 22**:

```sh
npm install -g @oxprotocol/cli
```

Then install any extension. The CLI detects your installed IDEs (VS Code, Cursor, Windsurf, VS Code Insiders, VSCodium), auto-installs the OXP host adapter if needed, downloads and verifies the bundle, and prompts once for permission consent.

```sh
oxp install @publisher/extension-name
```

The only prompt you will ever see is the one-time permission consent per extension — required by the security model. Skip it for trusted publishers with `--yes` or `OXP_TRUST_PUBLISHER=@publisher`.

### MCP servers

OXP also manages MCP servers across every AI-aware client in one command:

```sh
# Injects config into VS Code, VS Code Insiders, Cursor, Windsurf, Claude Desktop
oxp install @modelcontextprotocol/server-github

# Undo
oxp mcp rollback @modelcontextprotocol/server-github

# Check health of all configured servers
oxp doctor
```

---

## For extension authors

→ [QUICKSTART.md](./QUICKSTART.md) — build a `.oxp` bundle and run it in VS Code and JetBrains in 10 minutes.

→ [oxp.sh/docs](https://oxp.sh/docs) — complete documentation: manifest reference, SDK, UI components, permissions, bundle format, Rust extensions, dev workflow, and publishing.

---

## Monorepo structure

| Path | Contents |
|---|---|
| `spec/v1/` | Normative spec: manifest JSON Schema, bundle format, WIT world |
| `packages/cli/` | `@oxprotocol/cli` — the `oxp` command-line tool |
| `packages/sdk/` | `@oxprotocol/sdk` — author-facing extension SDK |
| `packages/ui/` | `@oxprotocol/ui` — cross-IDE UI component vocabulary |
| `packages/bundle/` | Bundle packing, signing, and verification |
| `packages/host-core/` | Install / verify / activate pipeline (shared by all host adapters) |
| `packages/host-runtime/` | WASI component runtime (jco-based) |
| `packages/schema/` | JSON Schema validation for manifests |
| `packages/wit/` | WIT world definition and canonical hash |
| `packages/types/` | Shared TypeScript types |
| `hosts/vscode/` | VS Code host adapter — works in Cursor, Windsurf, VSCodium ✅ |
| `hosts/jetbrains/` | JetBrains IntelliJ Platform plugin — in progress 🔄 |
| `hosts/piye/` | Piye native GPUI renderer — in progress 🔄 |
| `apps/web/` | Registry website + REST API (Next.js, Prisma, Postgres) |
| `examples/` | Example extensions and test fixtures |

---

## Development setup

Prerequisites: **Node ≥ 22**, **pnpm ≥ 10**, **Docker**, optionally **Rust** (for WASI component tests)

```sh
git clone https://github.com/oxprotocol/OXP
cd OXP
pnpm install
pnpm build
```

Start the local registry (Postgres + MinIO via Docker Compose):

```sh
docker compose up -d
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @oxprotocol/web db:push
pnpm dev    # registry at http://localhost:3000
```

Run all tests:

```sh
pnpm test
```

See the [Contributing guide](https://oxp.sh/docs/contributing) for the full workflow, code style, and PR guidelines.

---

## Publishing to marketplaces

→ [MARKETPLACE-PUBLISHING.md](./MARKETPLACE-PUBLISHING.md) — tag-triggered CI publishes the CLI to npm, the VS Code extension to Marketplace + Open VSX, and the JetBrains plugin to JetBrains Marketplace in one shot.

---

## Security

OXP is built security-first:

- Every bundle is **Ed25519-signed** and verified at install time
- Extensions run inside a **WASI sandbox** — no syscall access outside declared permissions
- Users **consent to permissions** at install; the capability broker enforces grants at runtime
- Publisher keys are **TOFU-pinned** — key rotation requires proof of the old key

→ [SECURITY.md](./SECURITY.md) — full threat model, defense layers, and known gaps.
