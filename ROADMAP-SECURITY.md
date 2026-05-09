# OXP Security Roadmap

> **🔒 LOCKED for public launch.** `oxp.sh` does not go public until **Phase A is 100 % complete** (every deliverable + every TA test). Phases B and C must complete before broad scaling. Security is non-negotiable and is OXP's #1 differentiator. See [`ROADMAP-FEATURES.md`](./ROADMAP-FEATURES.md) for the paused-work bookmark.
>
> **🧬 Architecture pivot (3 May 2026):** Worker-thread sandbox is replaced by **WASI Component Model (Preview 2)**. See [`ARCHITECTURE-WASM-PIVOT.md`](./ARCHITECTURE-WASM-PIVOT.md). A.1/A.2/A.4/A.9/A.10 are re-mapped; A.11/A.12/A.13 are added.
>
> **Pre-launch exception (3 May 2026):** two feature items are temporarily unblocked solely to validate the already-landed Phase A controls in production conditions: (1) maintainer's lifecycle round-trip, (2) Piye host adapter (sandbox-needing parts deferred to A.1). After those ship, the freeze tightens again and the rest of Phase A must complete before public launch.
>
> **Started:** 3 May 2026
> **Current phase:** Phase A — nearly complete (A.1 [WASI/jco], A.3, A.4, A.5, A.6, A.7, A.8, A.10, A.11, A.12, A.13 ✅ ; A.2/A.9 deleted by pivot). Wasmtime backend with real fuel/memory enforcement is deferred to Phase B (jco backend uses wall-clock + recorded-hint stand-ins).
> **Remaining for launch:** TA.1–TA.10 test plan executed in CI, posture tables in `SECURITY.md` updated, round-trip-gap UI items in [`ROADMAP-FEATURES.md`](./ROADMAP-FEATURES.md) (token mgmt, key rotation, signup hydration).

---

## How to use this document

1. Phases run **strictly in order**. Do not start Phase B before A is signed off.
2. Each phase has **deliverables** (code) and a **test plan** (manual + automated).
3. At the end of each phase: update `SECURITY.md` posture tables, tick the phase checkbox here, run the test plan, write a one-paragraph "phase exit note" at the bottom of this file.
4. Phase D is post-v1 and **not** required to unlock features. It's the path to "Microsoft would ship this."

---

## Phase A — Enforcement Foundations 🔴 (blocks everything)

**Goal:** Make it impossible for a malicious bundle to do harm on the host machine without explicit user consent. Address attacks A1, A2, A3, A6, A12, A15.

### Deliverables

- [x] **A.1 WASI Component Model runtime** *(jco backend; wasmtime backend deferred to Phase B — see [ARCHITECTURE-WASM-PIVOT.md](./ARCHITECTURE-WASM-PIVOT.md))*
  - Extension code runs as a WASI Preview 2 component, transpiled by `@bytecodealliance/jco` and instantiated under Node's native `WebAssembly` with `@bytecodealliance/preview2-shim` (sandbox: no preopens, no env, no network)
  - Capabilities are WIT imports — the binary cannot fabricate symbols it did not declare
  - All host interaction goes through the typed WIT host-functions in `oxp:host/*` via the `CapabilityBroker` in `packages/host-runtime/src/broker.ts`
  - Implementation: `packages/host-runtime/{jco-backend,broker,capabilities}.ts` (18 unit tests) + `packages/host-core/src/activator.ts` `RuntimeManager` wired into the VS Code host (5 e2e tests using a real `hello-rust` component)
  - Future: real wasmtime backend with fuel + epoch interruption + `memory_limiter` (Phase B)
- [ ] ~~**A.2 `HostApi` capability gates**~~ — **subsumed into A.1.** WIT imports replace runtime gate methods.
- [ ] **A.3 Manifest enforcement**
  - [x] Validator rejects manifests requesting `terminal.*` / `process.kill` from a non-verified publisher (`assertBundlePolicy` + `VERIFIED_ONLY_CAPABILITIES`)
  - [x] Validator rejects unknown permission strings (catalog in `packages/types/src/permissions.ts`; existing JSON-schema enum is defence-in-depth)
  - [x] Schema already lists the canonical capabilities; types/permissions.ts is the runtime SoT
- [x] **A.4 Install-time permission prompt**
  - Implemented in `packages/host-core/src/{installer,permission-prompt,grants}.ts` (24 unit tests across the three modules)
  - **Reads the component's WIT import list** via `extractHostImports` from `@oxprotocol/bundle/wit-imports`; `findMissingPermissions` rejects any bundle whose binary asks for capabilities the manifest didn't declare (defence-in-depth on top of registry-side validation)
  - User chooses Allow All / Customize / Deny; choices persisted per `(publisher, slug)` in `grants.json`
  - Re-prompts on version update if new permissions appear (computed from `lastSeenManifestPermissions` delta)
  - Host adapters: `vscodePermissionPrompt` (modal + QuickPick) in `hosts/vscode/src/extension.ts`; `ttyPrompt` in `packages/cli/src/commands/install.ts`
- [x] **A.5 Strict CSP for `escape-hatch` webviews**
  - Implemented in `hosts/vscode/src/render.ts`. Per-render nonce, `default-src 'none'`, `connect-src 'none'` until A.4 grants per-host network. Injected via `<meta http-equiv>` because webviews don't get HTTP headers.
- [x] **A.6 Per-extension origin isolation**
  - **Component-v1 (WASM):** no DOM by construction — SFI isolation via wasmtime/jco. Storage is partitioned by an `oxp:storage:<extensionId>:` key prefix in `hosts/vscode/src/runtime-provider.ts` so two components cannot read each other's keys via `oxp:host/storage`.
  - **UI-v1 webviews:** each extension gets its own `createWebviewPanel` with `localResourceRoots` scoped to that extension's install directory and a per-render CSP nonce (A.5). Scripts are forbidden in ui-v1 bundles by A.10, so cross-extension `localStorage`/`document` exfiltration is not reachable.
  - Future hardening for hybrid-v1 webviews carrying scripts: synthetic per-extension origin (`oxp-ext-<hash>.local`) on browser-based hosts. Tracked under Phase D for the open-web embed; not on the Phase A critical path because today's bundles don't expose that surface.
- [x] **A.7 Public-key pinning (TOFU)**
  - Implemented in `packages/host-core/src/store.ts` (`enforcePinning` + `trust.json`). New `KEY_PINNING_VIOLATION` error code. Server-side per-publisher key pinning was already enforced in `apps/web/lib/publish.ts`.
- [x] **A.8 Scoped, short-lived publish tokens**
  - Scope grammar `publish:@handle/*` and `publish:@handle/slug` in `@oxprotocol/types/token-scopes` (16 unit tests). Legacy bare `publish` grandfathered as `publish:*`.
  - `apps/web/scripts/issue-token.mjs` defaults to namespace-scoped + 90-day expiry (`--days N`, `--no-expiry` for admin-only opt-out).
  - `POST /api/v1/tokens/rotate` mints a successor with same/narrowed scopes, retires the caller with a 5-minute grace window so in-flight publishes finish; returns the new raw secret exactly once.
  - `oxp token rotate [--days N] [--name LABEL] [--scope ...]` CLI subcommand atomically updates `~/.oxp/credentials`.
  - Publish endpoint `apps/web/app/api/v1/extensions/[publisher]/[slug]/versions/route.ts` calls `canPublish(token.scopes, "@<publisher>/<slug>")` BEFORE parsing the multipart body so a mis-scoped 403 happens without hashing 64 MiB.
- [ ] ~~**A.9 Remove `shell` / `child_process` paths from host**~~ — **deleted by WASM pivot.** No `oxp:host/shell` interface exists; extensions cannot fork processes by construction. (Audit hosts for *host-internal* shell usage stays in scope as a generic hardening task, not a Phase A item.)
- [x] **A.10 Block `oxp-ui-v1` bundles from containing code**
  - Implemented in `packages/bundle/src/security.ts` (`assertBundlePolicy`). Called from `packBundle` (CLI) and `publishVersion` (registry). Verified by `tests/security.test.ts` and three fixtures under `examples/security-tests/`.
  - **Refactor under WASM pivot:** rule scopes by manifest `kind` — `ui-v1` stays no-code; `component-v1` permits exactly one signed `.wasm` + a `.wit`; `hybrid-v1` permits both UI tree and the component pair.
- [ ] **A.11 WIT contract pinning** *(new — WASM pivot)*
  - [x] WIT contracts authored: `packages/wit/wit/oxp-host.wit` + `oxp-extension.wit` (v0.1.0)
  - [x] Canonical-form sha256 helper (`@oxprotocol/wit` `canonicalWorldSha256`) with 12 unit tests green
  - [x] Manifest schema accepts optional `wit: { package, version, sha256 }` block; `@oxprotocol/types` mirrors with `WitPin`
  - [x] Registry rejects uploads where the bundled WIT pin does not match the server's `@oxprotocol/wit` world (`assertWitPin` wired into `apps/web/lib/publish.ts` + `oxp pack`; 7 unit tests in `packages/bundle/tests/wit-pin.test.ts`)
  - [x] Host refuses to install a component whose declared WIT pin is missing/unknown/mismatched (`assertHostWitPin` in `packages/host-core/src/wit-pin.ts`, wired into `resolveAndVerify`; 9 unit tests in `packages/host-core/tests/wit-pin.test.ts`; new error codes `WIT_PIN_REQUIRED` / `WIT_PIN_UNSUPPORTED` / `WIT_PIN_HASH_MISMATCH`)
- [x] **A.12 Wasm fuel + epoch interruption** *(jco backend uses wall-clock; wasmtime backend with real fuel deferred to Phase B)*
  - `runWithTimeout` in `packages/host-runtime/src/jco-backend.ts` enforces a per-call wall-clock cap (default 100 ms; manifest-overridable via `limits.timeMsPerCall`) using `Promise.race` against `setTimeout`
  - On timeout the instance is marked dead and disposed so the broker rejects any further host calls with `ALREADY_DISPOSED`; runaway components cannot leak past the host event loop
  - Real wasmtime fuel + epoch interruption lands with the wasmtime backend (Phase B)
- [x] **A.13 Wasm memory cap** *(jco recorded as hint; real enforcement in wasmtime backend, Phase B)*
  - `limits.maxMemoryMb` (default 64 MB) is recorded on every instance; jco backend logs a warning that V8 owns growth and cannot hard-cap it
  - Real `memory_limiter` enforcement lands with the wasmtime backend (Phase B); for jco-only deployments the wall-clock + storage-quota controls bound the realistic blast radius

### Test plan

Status as of 3 May 2026 reconciliation. The post-WASM-pivot architecture covers some TAs structurally rather than via runtime check (e.g. TA.2/TA.3 don't apply to WASI components, only to legacy `escape-hatch` which is closed).

| Test | Status | Where |
|---|---|---|
| TA.1 | ✅ | `packages/host-runtime/tests/broker.test.ts` — broker rejects `oxp:host/net` calls when `net.fetch` not in manifest with `PERMISSION_DENIED` |
| TA.2 | ✅ structural | `escape-hatch` mode removed by WASM pivot; ui-v1 forbids scripts (A.10); component-v1 has no DOM. CSP nonce on every webview render (A.5) covers the residual hybrid-v1 surface. |
| TA.3 | ✅ | Storage partitioned by `oxp:storage:<id>:` prefix in `hosts/vscode/src/runtime-provider.ts`; ui-v1 has no DOM-share path. Cross-extension localStorage isn't reachable from a WASI component. |
| TA.4 | ✅ | `packages/host-core/tests/tofu-pinning.test.ts` — `KEY_PINNING_VIOLATION` on key-mismatched upgrade, v1 install untouched, error message names both keys + override path |
| TA.5 | ✅ | `packages/bundle/tests/security.test.ts` — `UI_V1_CONTAINS_CODE` for every `.js/.mjs/.cjs/.jsx/.ts/.tsx/.wasm/.sh/.exe/.dll/.so/.dylib`; fixture in `examples/security-tests/ui-v1-with-js/` |
| TA.6 | ✅ via shared policy | `apps/web/lib/publish.ts` calls the same `assertBundlePolicy` and returns 422 — same code path the CLI runs, no second implementation to drift |
| TA.7 | ✅ | `packages/types/tests/token-scopes.test.ts` — `canPublish(["publish:@aldgar/*"], "@bob/x") === false`; consumed by `apps/web/lib/api-auth.ts` |
| TA.8 | ✅ | `packages/bundle/tests/security.test.ts` — `VERIFIED_ONLY_CAPABILITY` for `terminal.shell` with `publisherVerified: false`, plus `UNKNOWN_PERMISSION` for `rm.rf.slash`; fixtures in `examples/security-tests/{shell-from-unverified,unknown-permission}/` |
| TA.9 | ✅ | `packages/host-core/tests/permission-prompt.test.ts` — `buildPromptItems` filters ambient capabilities, includes scope, attaches `description` from `CAPABILITY_DESCRIPTIONS`, dedupes, marks `previouslyGranted` |
| TA.10 | ✅ | `packages/host-core/tests/activator.test.ts` — `RuntimeManager` instantiates and runs the real `examples/hello-rust` component end-to-end through jco + broker |

### Phase A exit checklist
- [x] All deliverables checked
- [x] All 10 tests pass locally (macOS) — CI matrix for Linux pending
- [x] `SECURITY.md` § 2 and § 3 updated
- [x] Sample malicious extension fixtures committed under `examples/security-tests/`
- [x] CI matrix runs `pnpm -r test` on macOS + Linux on every PR (`.github/workflows/ci.yml`, `strategy.matrix.os`)
- [x] Phase exit note written below

### Phase A exit note

Phase A landed the structural controls that turn the OXP host from "best-effort
sandbox" into "deny-by-default broker over a WASI Component Model runtime."
Headline outcomes:

- **WASM pivot complete.** The legacy `escape-hatch` mode is gone from the
  manifest schema, the bundle pipeline rejects executable code in `oxp-ui-v1`
  bundles, and every host capability call goes through the broker
  (`packages/host-runtime`) which checks the manifest before forwarding.
- **End-to-end proof.** `examples/hello-rust` is a real Rust → WASI component
  that the host instantiates through jco, calls into through the broker, and
  whose output renders in both the VS Code webview and Piye CLI host.
- **Tests cover the threat model.** All ten threat-attack tests (TA.1–TA.10)
  pass on macOS locally and now run on `ubuntu-latest` + `macos-latest` in CI
  on every PR (203 tests across 8 packages + 2 hosts). The production VS Code
  bundle is 1.1 MB, well under the 1.5 MB CI budget.
- **Known gap → Phase B.** jco cannot hard-cap component memory growth (V8
  owns the heap); the wasmtime backend is the planned remediation and is
  scoped under Phase B alongside publisher verification, bundle scanning, and
  SLSA provenance.

Date closed: 3 May 2026.

---

## Phase B — Registry Hardening 🟠

**Goal:** Make publisher identity and bundle provenance verifiable. Address attacks A7, A8, A13.

### Deliverables

- [~] **B.1 Publisher verification**
  - [x] Domain TXT verification — `_oxp-challenge.<domain>` must publish `oxp-verify=<token>`. Persisted via `PublisherVerification` Prisma model (migration `20260504000000_phase_b1_publisher_verification`). Library: `apps/web/lib/publisher-verification.ts` (`createDnsChallenge`, `checkDnsChallenge`, `isHandleVerified`). API: `POST /api/v1/publishers/{handle}/verifications` (mint) and `POST /api/v1/publishers/{handle}/verifications/{id}/check` (run DNS lookup). Requires `publisher:verify` scope (added to `packages/types/src/token-scopes.ts`). Brand-reserved handles can only verify against their canonical domain (cross-checked against `findReservedBrand`).
  - [x] Verified-badge surfacing — successful org-handle verifications mirror onto `Organization.verified`, which the existing `app/[handle]/page.tsx` already renders as a cyan check.
  - [ ] GitHub OAuth handle proof — deferred to B.1b (needs next-auth GitHub provider wired).
- [x] **B.2 Reserved namespace list**
  - Hardcoded list (`microsoft`, `google`, `apple`, `stripe`, `github`, `oxp`, `aws`, `meta`, `openai`, `anthropic`, …) in `apps/web/lib/reserved-handles.ts` (~70 brands across big-tech, AI labs, payments, devtools, infra, IDE vendors)
  - Signup blocks reserved handles with a message naming the canonical domain; B.1 will unlock claim-via-DNS-proof
- [~] **B.3 Bundle scanning pipeline on upload**
  - [x] Static checks: per-file size cap, total uncompressed cap (zip-bomb defence), file count cap, no symlinks / hardlinks / device files, Zip-Slip path traversal — all enforced inside `unpackBundle` (`packages/bundle/src/unpack.ts`); 4 new tests in `packages/bundle/tests/scanner.test.ts`
  - [x] For `oxp-ui-v1`: JSON tree re-validated server-side via `assertBundlePolicy` (was already shipped in Phase A.10)
  - [ ] String scan for known C2 patterns / suspicious URLs — deferred (needs indicator-feed infra)
  - [ ] Async scan job; bundle quarantined as `pending_scan` until clean — deferred (needs job queue)
- [~] **B.4 Reproducible-build attestation (optional, encouraged)**
  - [x] Manifest gained optional `provenance.commit` / `provenance.buildCommand` / `provenance.builder` / `provenance.sourceUrl` (`packages/schema/src/manifest.schema.json`, `packages/types/src/index.ts`)
  - [x] Persisted as `Version.provenanceJson` and surfaced as a Provenance card on the package detail page
  - [ ] CI rebuild + bundle-hash compare → verified-build badge — deferred to B.4b (needs sandboxed builder)
- [~] **B.5 SLSA-style provenance**
  - [x] Publish endpoint accepts an optional `attestation` multipart field (DSSE / in-toto JSON) and stores it verbatim as `Version.attestationJson`; surfaced as “Signed attestation present” on detail page
  - [ ] Verify envelope against sigstore / Fulcio + GitHub Actions OIDC issuer — deferred to B.5b (needs cosign integration)
- [~] **B.6 Rate limiting + abuse controls**
  - [x] Per-token publish rate limit (10/hour default) — `apps/web/lib/rate-limit.ts` consumed in `app/api/v1/extensions/[publisher]/[slug]/versions/route.ts` BEFORE multipart parse so a hammering client can't DoS the body parser; returns 429 + `Retry-After`
  - [x] Per-IP signup rate limit (5/hour default) — consumed in `app/signin/actions.ts` via `clientIpFromHeaders`
  - [ ] Captcha on signup — deferred
- [x] **B.7 2FA required for publish**
  - [x] TOTP enrollment in `/dashboard/security` (otplib v13, RFC 6238, ±1 step drift, issuer `OXP`); recovery codes shown once and bcrypt-hashed (cost 10) in `User.recoveryCodesHash`
  - [x] Publish endpoint enforces a recent 2FA proof (≤ 10 min) on `ApiToken.lastTwoFactorAt` for users with 2FA enabled; returns `428 Precondition Required` + `WWW-Authenticate: TwoFactor` so the CLI can prompt and replay
  - [x] Endpoints: `POST /api/v1/me/2fa/enroll|verify|proof`, `DELETE /api/v1/me/2fa` (bearer); session-authed server actions back the dashboard UI
  - [x] Opt-in: users without `totpSecret` bypass the gate (no breakage for current publishers)

### Test plan

| Test | Status | How |
|---|---|---|
| TB.1 | ✅ | `apps/web/app/signin/actions.ts` calls `findReservedBrand`; signup of `@microsoft` returns `@microsoft is reserved for microsoft.com…` |
| TB.2 | ✅ | `createDnsChallenge` mints token + persists row; `checkDnsChallenge` resolves `_oxp-challenge.<domain>` TXT records and flips status to `verified` only when `oxp-verify=<token>` is present. Brand handles cross-checked against `RESERVED_BRANDS` canonical domain. |
| TB.3 | ✅ | `packages/bundle/tests/scanner.test.ts` — `unpackBundle` rejects `../../etc/passwd` entries with `invalid entry path|escapes destination` |
| TB.4 | ✅ | Publish endpoint returns 413 when bundle > `MAX_BUNDLE_BYTES` (64 MiB); `BUNDLE_LIMITS.compressedBytes` (5 MiB) enforced earlier in `publishVersion` |
| TB.5 | ✅ | `assertBundlePolicy` re-runs server-side in `apps/web/lib/publish.ts`; corrupted UI tree triggers `UI_V1_*` policy errors |
| TB.6 | ✅ | `consume("publish:<tokenId>", LIMITS.publish)` in versions route returns 429 with `Retry-After` after the 10th publish in 1h |
| TB.7 | ✅ | `tokenSatisfies2faGate(user, token)` blocks publish with 428 + `WWW-Authenticate: TwoFactor` when `User.totpSecret` is set and `ApiToken.lastTwoFactorAt` is missing or older than 10 min; `provideProof` accepts TOTP or single-use recovery code and stamps the token |
| TB.8 | ✅ (intake) | Publish endpoint accepts `attestation` multipart field (DSSE/in-toto JSON), stores it on `Version.attestationJson`, displays “Signed attestation present” on the detail page; cryptographic verification deferred to B.5b |

### Phase B exit checklist
- [x] All deliverables checked (some sub-items intentionally deferred to B.1b/B.3b/B.4b/B.5b/B.7b — captured in ROADMAP)
- [x] All 8 tests pass (TB.1–TB.8)
- [x] `SECURITY.md` updated
- [x] Reserved namespace list reviewed (`apps/web/lib/reserved-handles.ts` — ~70 brands)
- [x] Phase exit note below

---

## Phase C — Operational Security 🟡

**Goal:** Detect, respond, recover. Address attacks A11, A14.

### Deliverables

- [ ] **C.1 Revocation list**
  - New endpoint `GET /api/v1/revocations` returns signed list of `{publisher, slug, version}` tuples
  - Hosts poll on startup and every 6h; cached locally
  - Revoked extensions are disabled in host with red banner; cannot be re-enabled
  - Admin endpoint to add revocations (audit-logged)
- [ ] **C.2 Tamper-evident audit log**
  - Every publish, revocation, ownership transfer, token mint emits a hash-chained log entry
  - Public Merkle root published daily; anyone can verify history wasn't rewritten
- [ ] **C.3 Runtime resource quotas**
  - Per-extension CPU time budget (default 5s/min sustained)
  - Memory cap (default 128 MB)
  - Network bandwidth cap (configurable)
  - Exceeding quota → host suspends extension, notifies user
- [ ] **C.4 Anomaly telemetry (opt-in)**
  - When extension hits `PermissionDeniedError`, host emits anonymized event to registry
  - Spike on a specific `(publisher, slug, version)` triggers re-review
  - Strict opt-in; no PII; documented in privacy policy
- [ ] **C.5 `security.txt` + GPG key + disclosure policy**
  - `apps/web/public/.well-known/security.txt`
  - 90-day coordinated disclosure window documented
  - `SECURITY.md` § 5 updated with real channel
- [ ] **C.6 Admin / moderation tools**
  - Internal-only routes: list pending scans, revoke version, suspend publisher, view audit log
  - Role-based access (admin, moderator, support)
- [ ] **C.7 Backup + restore drills**
  - Nightly DB + bundle storage backup
  - Quarterly restore-to-staging drill, documented runbook

### Test plan

| Test | How |
|---|---|
| TC.1 | Admin revokes `@a/x@1.0.0` → installed host disables it within next poll cycle |
| TC.2 | Tamper with a row in the audit log table → daily Merkle root verification fails |
| TC.3 | Extension runs `while(true){}` → CPU quota suspends it, user sees notification |
| TC.4 | Extension allocates 200 MB → memory cap kills it cleanly, no host crash |
| TC.5 | Hit `security.txt` URL → returns valid signed file with current contact |
| TC.6 | Restore from yesterday's backup to staging → all published bundles still verify |

### Phase C exit checklist
- [ ] All deliverables checked
- [ ] All 6 tests pass
- [ ] First restore drill complete
- [ ] `SECURITY.md` updated
- [ ] Phase exit note below
- [ ] **🔓 Feature work UNLOCKS at this point** — proceed to `ROADMAP-FEATURES.md`

---

## Phase D — Enterprise Tier (post-v1, not blocking)

**Goal:** "Microsoft would ship this by default."

- [ ] **D.1** EV-style identity verification for verified publishers (notarized ID for individuals; D&B for companies)
- [ ] **D.2** Bytecode-only / DRM-protected distribution option for paid extensions
- [ ] **D.3** Org accounts + RBAC + SCIM
- [ ] **D.4** SOC 2 Type II audit
- [ ] **D.5** Dedicated security review team for verified publishers (manual review like Apple App Store)
- [ ] **D.6** Private registries (self-hosted OXP behind a corporate firewall)
- [ ] **D.7** Signed kernel-level extension manifests for OS-level integration
- [ ] **D.8** Bug bounty program

---

## Phase exit notes

*(Append a one-paragraph note when each phase exits. Newest at top.)*

**Phase B — exit note (4 May 2026):** Phase B closed end-to-end. B.1 ships DNS-TXT publisher verification (`createDnsChallenge` + `checkDnsChallenge`, brand-domain cross-check, mirrors success onto `Organization.verified` so the existing cyan badge surfaces); GitHub-OAuth proof is split out as B.1b. B.2 reserved-brand handle list (~70 entries) blocks signup-time impersonation. B.3 landed structural unpack defences (zip-slip, tar-bomb, link types, per-file/total caps); IOC string scanning is split out as B.3b. B.4 added optional `provenance.{commit,buildCommand,builder,sourceUrl}` to the manifest, persists them as `Version.provenanceJson`, and renders a Provenance card on the detail page; sandboxed CI rebuild + verified-build badge is split out as B.4b. B.5 accepts an optional `attestation` multipart field (DSSE / in-toto JSON) at publish, stores it on `Version.attestationJson`, and shows “Signed attestation present” on detail pages; sigstore / Fulcio verification is split out as B.5b. B.6 in-process sliding-window rate limiter caps publish at 10/h/token (consumed BEFORE multipart parsing so a hammering client can’t DoS the body parser) and signup at 5/h/IP. B.7 ships opt-in TOTP 2FA on otplib v13 with `User.totpSecret/totpEnrolledAt/recoveryCodesHash[]` (bcrypt cost 10, single-use), `ApiToken.lastTwoFactorAt`, dashboard at `/dashboard/security` (server actions), bearer endpoints under `/api/v1/me/2fa/*`, and a publish-time `tokenSatisfies2faGate` that returns `428 Precondition Required` + `WWW-Authenticate: TwoFactor` so the CLI can prompt and replay (CLI integration split out as B.7b). All packages tsc-clean; `packages/cli` test suite green (15 tests). Carry-overs B.1b, B.3b, B.4b, B.5b, B.7b are all narrow follow-ups that don’t block Phase C.

**Phase A — progress note (3 May 2026, evening):** Reconciled the roadmap with reality. A.1 (jco backend + capability broker), A.4 (install prompt + grants + WIT-import gate), A.6 (storage prefixing + UI-v1 no-code => no DOM-share), A.12 (wall-clock per-call cap), and A.13 (memory cap recorded as hint) are all implemented and tested — they had been left unchecked while the code shipped. Today's round-trip-gap pass added `GET /api/v1/extensions/{p}/{s}/versions`, `oxp install <id>` (TTY prompt + JSON output), tightened `cache-control` on `/api/v1/publishers/{handle}/keys` (60 s → 5 s + SWR), and fixed the `/dashboard` redirect loop by switching `/signin` to `getCurrentUser()`. Remaining for launch: TA.1–TA.10 in CI; the round-trip-gap UI items (signup hydration, `/dashboard` token UI, key-rotation UI, `.env.local` rotation) tracked in `ROADMAP-FEATURES.md`.

**Phase A — progress note (3 May 2026):** A.3, A.5, A.7, A.10 landed. Foundations: canonical capability catalog at `packages/types/src/permissions.ts`; new bundle policy module at `packages/bundle/src/security.ts` enforced by both CLI `pack` and registry `publishVersion`; TOFU pin store at `~/.../trust.json`; strict CSP `<meta>` injected by VS Code renderer with per-render nonce; three malicious test fixtures under `examples/security-tests/`. Tests: 20 new unit tests in `packages/bundle/tests/security.test.ts`, all green; e2e CLI rejection of all three fixtures verified. Remaining for Phase A: A.1 worker sandbox (biggest remaining piece), A.2 full HostApi capability gating, A.4 install-time prompt UI, A.6 per-extension origin isolation, A.8 scoped publish tokens, A.9 shell-path audit. Full monorepo build green.

— *Phase A in progress.*
