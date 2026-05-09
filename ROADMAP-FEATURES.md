# OXP Features Roadmap

> **🧬 Architecture pivot (3 May 2026):** Pillar 1 is rewritten and a new Pillar 7 (Language SDKs) is added per [`ARCHITECTURE-WASM-PIVOT.md`](./ARCHITECTURE-WASM-PIVOT.md) — extensions now ship as WASI Preview 2 components, not JS modules. `oxp-ui-v1` is unchanged.
>
> **⏸ PAUSED — with two narrow pre-launch exceptions (3 May 2026 update).**
>
> The following two items are temporarily unblocked because they are needed to validate Phase A in production conditions:
>
> 1. **Real end-to-end publish round-trip with the maintainer's account** (the bookmark below). This doubles as the integration test for Phase A.3, A.5, A.7 already-landed controls and surfaces gaps for A.4 / A.8.
> 2. **Piye host adapter** (Pillar 1, sandbox parts excluded — those still wait for A.1).
>
> After those two ship, work returns to **completing Phase A in full** (A.1, A.2, A.4, A.6, A.8, A.9 + every TA test). **`oxp.sh` does not go public until Phase A is 100 % complete.** No exceptions, no shortcuts.
>
> All other feature pillars remain paused until Phase A + B + C are done.
>
> **Paused on:** 3 May 2026
> **Pre-launch sequence:** lifecycle round-trip → Piye adapter → finish Phase A → public launch.

---

## 📍 Bookmark — where we resume after security is done

**Last completed work:**
- ✅ Pillar 4 — `@oxprotocol/ui` package + SDK typed tree + schema for `oxp-ui-v1` + VS Code host renderer + `hello-tree` CLI template (e2e verified)
- ✅ Option B (partial) — `/packages` browse and `/[handle]/[slug]` detail pages wired to Prisma DB with seed-data fallback
- ✅ Full monorepo build green

**Round-trip executed 2026-05-03 with `@aldgar`:** ✅ create → pack → publish → resolve/manifest/signature/bundle APIs → server-side key pinning (A.7) → client-side TOFU pinning (A.7) all green against live Neon. Published `@aldgar/first-extension@0.0.1` (extId `cmop0rags…`, ver `cmop0ran9…`).

**Round-trip-gap pass 2026-05-03 (post-round-trip):**
- ✅ `GET /api/v1/extensions/{p}/{s}/versions` handler (returns newest-first list with `extensionId` + `latest`).
- ✅ `oxp install <id> [-y] [--json]` CLI command — drives the full `installWithConsent` pipeline (signature + WIT pin + A.7 TOFU + Phase A.4 prompt) into `$OXP_HOME/host-store/`.
- ✅ `cache-control` on `/api/v1/publishers/{handle}/keys` lowered from 60 s → `max-age=5, stale-while-revalidate=10`.
- ✅ `/dashboard` redirect loop fixed — `/signin` now uses `getCurrentUser()` (DB-backed) instead of `auth()`, so a stale session pointing at a deleted user no longer ping-pongs.
- ✅ `/{handle}/{slug}` 404 verified as a stale gap — route is registered (`apps/web/app/[handle]/[slug]/page.tsx`) and falls back to `getExtensionDb`.

**Gaps surfaced during round-trip — must be fixed before public launch:**

- [ ] **Signup form invisible client-side** (hydration) — server HTML is correct (200 OK with full markup) but the React form never paints. Bypassed via `scripts/issue-token.mjs`. Blocks any new user. *Needs browser-side repro to diagnose.*
- [ ] **No dashboard token-management UI** — tokens can only be minted via `scripts/issue-token.mjs`. `oxp login` tells users "Get a token at /dashboard (Settings → API tokens)" but that UI doesn't exist. Required before launch (and must include scope picker + expiry once A.8 lands).
- [ ] **No publisher self-service "rotate signing key" flow** — Phase A.7 fired correctly (server pinned old key, blocked publish). Resolution required `prisma.publisherKey.deleteMany(...)` from a one-shot script. Production needs a UI flow that requires re-auth + 2FA and creates an audit-log entry, not raw DB edits.
- [ ] **`apps/web/.env.local` has plaintext Neon + legacy Mongo creds** — rotate as part of A.8 hardening pass; move to a secret manager and never let the file be committed.

> *Note: this round-trip also re-validated Phase A.3 (signed bundles), A.5 (CSP — bundle/manifest/signature served correctly), A.7 (TOFU pinning, both sides). Phase A.1 worker sandbox + A.4 install prompt + A.8 scoped tokens still required before public launch.*

---

## Pillars overview

| # | Pillar | Status |
|---|---|---|
| 0 | **Security foundation** | 🔴 In progress (blocks all below) |
| 1 | PIYE-IDE worker harness | ⏸ Paused |
| 2 | OXP runtime + signed bundles | ✅ Done (will be re-validated under Phase A sandbox) |
| 3 | CLI polish | ⏸ Paused (partial — see below) |
| 4 | `@oxprotocol/ui` declarative components | ✅ Done |
| 5 | Migration tooling + VSX import + R2 storage | ⏸ Paused |
| 6 | Registry website features | ⏸ Paused (partial — see below) |
| 7 | Language SDKs (Rust / Go / JS via jco) | 🆕 Added by WASM pivot |
| 8 | **Performance guarantee** ("the lightest extension ecosystem ever built") | 🆕 Added 3 May 2026 — starts after WASM runtime lands |

---

## Pillar 1 — WASI runtime + capability broker ⏸

> **Pivoted (3 May 2026):** This pillar was "PIYE worker harness". It is now the **WASI Component Model runtime** (`packages/host-runtime/` + `packages/wit/`), shared by VS Code, Piye, and any future host. See [`ARCHITECTURE-WASM-PIVOT.md`](./ARCHITECTURE-WASM-PIVOT.md). What remains PIYE-specific (window chrome, panel system, command palette wiring) lives further down.

- [ ] PIYE host shell (window chrome, panel system)
- [ ] Extension activation lifecycle (activate/deactivate hooks)
- [ ] Command palette wiring
- [ ] Settings UI rendering via `oxp-ui-v1`
- [ ] Multi-extension panel routing

---

## Pillar 3 — CLI polish ⏸ (partial done)

Already done:
- ✅ `oxp create`, `oxp pack`, `oxp dev`, `oxp login`, `oxp publish`, `oxp install`
- ✅ `hello-html` and `hello-tree` templates

Remaining:
- [ ] `oxp whoami`
- [ ] `oxp doctor` (env diagnostics)
- [ ] `--json` output flag on all commands (machine-readable)
- [ ] Shell completions (bash, zsh, fish)
- [ ] `oxp logout`
- [ ] `oxp publish --dry-run`
- [ ] Better error messages with actionable hints

---

## Pillar 5 — Migration & VSX import ⏸

> **⚠️ DO NOT START until security Phase A + B + C are complete.** Bulk-importing thousands of unscanned VSX extensions into an unhardened registry would make OXP a malware distribution platform on day one.

- [ ] `oxp migrate` — convert a VS Code extension `package.json` to `oxp.json` where possible
- [ ] VSX bulk-import pipeline (with mandatory Phase B scanning gate)
- [ ] R2 / S3 storage backend for bundle bytes (current: DB blob)
- [ ] CDN in front of bundle downloads
- [ ] Storage migration script from DB blob → object storage

---

## Pillar 6 — Registry website features ⏸ (partial done)

Already done:
- ✅ Browse page (`/packages`) wired to DB
- ✅ Detail page (`/{handle}/{slug}`) wired to DB
- ✅ Sign-in / dashboard skeleton

Remaining:
- [ ] Token management UI in `/dashboard` (create, scope, rotate, revoke)
- [ ] Publisher profile pages (`/{handle}`)
- [ ] Search (full-text)
- [ ] Categories + tag pages
- [ ] Install count tracking + display
- [ ] Stars / favorites
- [ ] README rendering on detail page (markdown → safe HTML)
- [ ] Version history + changelog display
- [ ] `/packages/@x/y` legacy URL redirect to `/x/y`
- [ ] Verified publisher badge UI (depends on Security Phase B.1)
- [ ] Provenance badge UI (depends on Security Phase B.5)
- [ ] Revocation banner on revoked versions (depends on Security Phase C.1)

---

## Pillar 8 — Performance guarantee 🆕

> **Brand promise:** *"the lightest extension ecosystem ever built."* Performance is not a polish item — it is a core product differentiator alongside security. Starts after Pillar 1 (WASI runtime) lands; the WASM substrate is what makes these numbers achievable.

### 8.1 Lazy activation
- [ ] Extensions consume **zero CPU and zero resident memory when idle** — wasmtime instance not created until first activation event
- [ ] Activation events declared in manifest: `onCommand:<id>`, `onLanguage:<lang>`, `onView:<id>`, `onStartupFinished` (cheapest tier; runs after host idle), `onUri:<scheme>`
- [ ] Host activation scheduler in `packages/host-runtime/` lazily instantiates the component on first matching event; idle components evicted after configurable TTL (default 5 min) and re-instantiated on next event
- [ ] No `*` / "on startup" activation accepted by `oxp publish` — hard reject with actionable error
- [ ] Snapshot/restore via wasmtime pre-initialized instance to make warm activation < 5 ms

### 8.2 `oxp stats` — real-time per-extension RAM + CPU
- [ ] CLI command `oxp stats` (and `oxp stats --watch`) showing live table: extension id, state (idle / active / suspended), wasm linear-memory bytes, fuel consumed/sec, host-call count/sec, last activation event
- [ ] Backed by host-runtime metrics endpoint (UDS or pipe in dev; in-process API for embedded hosts)
- [ ] `--json` output for machine consumption
- [ ] In-host UI (status bar widget + dedicated panel) reuses the same metrics source
- [ ] Per-extension cost sampling honors A.12 fuel + A.13 memory caps so stats and limits share one source of truth

### 8.3 Bundle-size enforcement at publish time
- [ ] Hard cap enforced in `packBundle` and re-checked in `publishVersion`: **default 5 MB compressed / 20 MB uncompressed** per bundle
- [ ] `wasm-opt -Oz` required in `oxp pack` component path; fail publish if the produced `.wasm` is more than 2× the size of the same artifact rebuilt with `-Oz`
- [ ] Manifest may request a higher cap (up to a hard ceiling, target 25 MB compressed) only with explicit `size-exception` field + reason string — surfaced in install prompt
- [ ] Registry rejects oversize uploads with a clear error that names the file responsible
- [ ] Bundle composition report on publish: top 10 largest files, gzip ratio, wasm section breakdown (code / data / custom)

### 8.4 Benchmark suite — prove the 10× claim
- [ ] New package `packages/bench/` with reproducible harness comparing OXP vs equivalent VS Code extensions across paired workloads (linter activation, file-tree provider, snippet provider, status-bar tick, language server bridge)
- [ ] Metrics captured: cold activation time, warm activation time, RSS at idle, RSS under load, CPU·s per 1k events, bundle size on disk
- [ ] Target: **OXP uses ≤ 10 % of the equivalent VS Code extension's resident memory at idle** (i.e. 10× less). Other metrics tracked but not gated.
- [ ] CI job `bench-regression` blocks merges that regress any tracked metric by more than 10 % vs main
- [ ] Public results page on `oxp.sh/perf` regenerated from CI artifacts — raw data published, not just charts
- [ ] Methodology doc in `packages/bench/METHODOLOGY.md` so the claim is auditable and reproducible by third parties

### Sequencing & dependencies
- Blocked on Pillar 1 (WASI runtime) — no wasm = no story to tell
- Pairs naturally with Security A.12 (fuel) + A.13 (memory cap) — same metering plumbing powers `oxp stats`
- 8.3 (size cap) can land independently of 8.1/8.2 and should ship before public launch even if the rest slips

---

## Cross-cutting tasks (deferred)

- [ ] Telemetry pipeline (opt-in, anonymized)
- [ ] Public docs site
- [ ] Public examples gallery
- [ ] i18n for website
- [ ] Accessibility audit (WCAG 2.2 AA) on website + host UIs
- [ ] Performance budget enforcement in CI

---

## Resume protocol

When `ROADMAP-SECURITY.md` Phase C exit checklist is fully ticked:

1. Update the banner at the top of this file from ⏸ PAUSED to ▶ ACTIVE
2. Update `SECURITY.md` § 4 ("what you should and should not do today") to reflect new safe state
3. Resume from the **Bookmark** section above
4. Each feature added from this point must include a "Security review" line in its PR description confirming it doesn't regress any Phase A/B/C control
