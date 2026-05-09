# OXP Security Posture

> **Status (3 May 2026):** Pre-v1. Phase A is essentially complete — WASI Preview 2 sandbox, install-time permission prompts, TOFU key pinning, scoped tokens, and CSP are all live. Wasmtime backend with real fuel/memory enforcement is deferred to Phase B; the current jco backend uses wall-clock + recorded-hint stand-ins. Do **not** install untrusted bundles on a machine with sensitive data until Phase B ships and we publish a third-party security review. See [`ROADMAP-SECURITY.md`](./ROADMAP-SECURITY.md) for the plan.

Security is OXP's #1 design priority and our biggest competitive advantage over npm-style and VS-Code-Marketplace-style ecosystems. This document is the living **threat model** and **honest posture statement**. It is updated at the end of every security phase.

---

## 1. Threat model

### Assets we protect
- **The end-user's machine** (filesystem, secrets, network, processes)
- **The end-user's identity** (auth tokens, SSO sessions inside the IDE)
- **The publisher's identity** (signing keys, publish tokens, namespace ownership)
- **The registry's integrity** (bundle bytes, version history, audit log)
- **The supply chain** (source → build → sign → publish → install → run)

### Adversaries
| Adversary | Capability | Motivation |
|---|---|---|
| Malicious author | Publishes a crafted `.oxp` | Steal data, mine crypto, ransomware, RCE |
| Account hijacker | Steals a legitimate publisher's token | Push malicious update to popular extension |
| Typosquatter | Registers `@strlpe/checkout` | Trick users into installing |
| Network attacker (MitM) | Sits between host and registry | Swap bundle bytes in transit |
| Compromised registry | Has DB + storage write access | Replace bundle, forge versions |
| Malicious end-user | Installs OXP host on their own machine | Try to escape sandbox to attack their own OS (lower priority) |

### Attack surfaces
1. **Bundle execution** — the `.oxp` runs inside a host
2. **Bundle distribution** — registry → host transport
3. **Bundle authoring** — CLI signing flow on author's machine
4. **Registry API** — publish/install/auth endpoints
5. **Host UI** — webview/panel rendering
6. **Inter-extension** — one extension attacking another (multi-tenant within one host)

### Specific attacks tracked
| # | Attack | Surface | Status |
|---|---|---|---|
| A1 | Arbitrary code execution on host machine | 1 | ✅ Mitigated by WASI Preview 2 sandbox (no DOM, no Node, no syscalls; capability broker is the only host channel — Phase A.1) |
| A2 | Filesystem read outside workspace | 1 | ✅ Mitigated — `fs.*` capability only granted via install prompt; broker rejects undeclared `oxp:host/fs` calls (Phase A.4 + A.1 broker) |
| A3 | Network exfiltration without consent | 1 | ✅ Mitigated — `net.fetch:*` is a prompted capability; broker omits the `net` interface when not granted (Phase A.4 + A.1 broker) |
| A4 | UI spoofing inside webview (fake login) | 5 | ✅ Mitigated — strict per-render CSP nonce, `default-src 'none'`, `frame-ancestors 'none'`, no inline scripts (Phase A.5) |
| A5 | Registry bundle swap (MitM or compromise) | 2,4 | ✅ Mitigated by Ed25519 sig + host-side re-verify |
| A6 | Silent malicious update from hijacked account | 4 | ✅ Mitigated — TOFU key pinning refuses upgrades signed by a different key (Phase A.7; covered by `tofu-pinning.test.ts`) |
| A7 | Typosquatting | 4 | ❌ Not mitigated (Phase B) |
| A8 | Namespace impersonation (`@microsoft`) | 4 | ❌ Not mitigated (Phase B) |
| A9 | Sandbox escape from webview to Node | 1,5 | ⚠️ Component-v1 has no webview surface; ui-v1 forbids scripts (A.10); hybrid-v1 with scripts still relies on the Chromium webview boundary (Phase D synthetic-origin work) |
| A10 | Malicious bundle bypassing signature check | 1,2 | ✅ Mitigated (host re-verifies locally) |
| A11 | Crypto-mining / resource abuse | 1 | ⚠️ Per-call wall-clock cap via `runWithTimeout` (Phase A.12, jco); real wasmtime fuel + epoch interruption deferred to Phase B |
| A12 | Persistence (cron, autostart) | 1 | ✅ Mitigated — no shell access without `terminal.shell` (verified-only), no persistent daemon surface |
| A13 | Stolen publish token replay | 4 | ✅ Mitigated (Phase A.8 — scoped tokens, 90-day default expiry, rotation endpoint with 5-min grace) |
| A14 | Audit trail tampering | 4 | ❌ Not mitigated (Phase C) |
| A15 | Inter-extension data leak | 6 | ✅ Mitigated for storage — per-extension key prefix `oxp:storage:<id>:` in the host runtime; ui-v1 has no DOM-share path (no scripts). Hybrid-v1 cross-DOM partitioning lands with synthetic origins in Phase D. |

---

## 2. Current controls (what works today)

✅ **WASI Preview 2 sandbox** — extension code runs as a WASM component under jco + `@bytecodealliance/preview2-shim` with NO preopens / env / network. The capability broker translates WIT imports to typed host functions; a binary cannot fabricate symbols it didn't declare (Phase A.1).
✅ **Install-time permission prompt** — `installWithConsent` reads the component's WIT import list, refuses to install when the manifest doesn't cover them, and shows a per-capability prompt with Allow All / Customize / Deny. Choices are persisted per `(publisher, slug)` and re-prompt if a new permission appears on upgrade (Phase A.4; 24 unit tests).
✅ **Per-call wall-clock cap** — `runWithTimeout` aborts host calls past `limits.timeMsPerCall` (default 100 ms) and disposes the instance so further calls return `ALREADY_DISPOSED` (Phase A.12, jco backend).
✅ **Per-extension storage partition** — host runtime prefixes every `oxp:host/storage` key with `oxp:storage:<extensionId>:` so two components cannot read each other's keys (Phase A.6).
✅ **Ed25519 bundle signing** — every `.oxp` is signed at `pack` time. Host re-verifies on install (zero-trust toward registry).
✅ **Content-addressable bundles** — SHA-256 hash of tarball is what gets signed.
✅ **Two render modes** — `oxp-ui-v1` (declarative JSON tree, *no* code execution path) and component-v1 / hybrid-v1 (WASM only). The pre-pivot `escape-hatch` HTML/JS mode is closed.
✅ **Webview default isolation** — VS Code webviews are sandboxed iframes with `localResourceRoots` scoped per-extension; no Node API.
✅ **Capability declarations in manifest** — `permissions: []` field exists in schema, with a canonical catalog in `packages/types/src/permissions.ts`.
✅ **Bearer token auth on publish** — registry checks token + scope before accepting upload.
✅ **`oxp-ui-v1` bundles cannot ship code** — `assertBundlePolicy` rejects any `.js`/`.mjs`/`.cjs`/`.ts`/`.wasm`/etc. in v1 mode at both CLI pack and registry upload (Phase A.10).
✅ **Unknown permissions rejected** — catalog-based validation at pack and publish (Phase A.3).
✅ **Verified-only capabilities gated** — `terminal.*` / `process.kill` denied to unverified publishers (Phase A.3, full publisher verification arrives in Phase B.1).
✅ **Strict CSP on every rendered webview** — `default-src 'none'`, per-render nonce, `connect-src 'none'`, `frame-ancestors 'none'`, no inline scripts (Phase A.5).
✅ **TOFU publisher key pinning** — host refuses to install a new bundle from a known publisher signed with a different key (Phase A.7); registry already pins server-side. Covered by `packages/host-core/tests/tofu-pinning.test.ts`.
✅ **Scoped publish tokens** — `publish:@handle/*` or per-package, 90-day default TTL, `oxp token rotate` for hand-over with a 5-min grace window (Phase A.8).
✅ **WIT contract pin** — every component-v1 / hybrid-v1 manifest must declare a `wit.sha256` matching this server's `@oxprotocol/wit` world; mismatched pins are rejected at publish (Phase A.11).
✅ **Reserved brand handles** — ~70 commonly-impersonated brands (Microsoft, Google, Stripe, OpenAI, Anthropic, Cloudflare, …) are blocked at signup with a message naming the canonical domain. List in `apps/web/lib/reserved-handles.ts` (Phase B.2).
✅ **Domain TXT publisher verification** — owners prove control by publishing `oxp-verify=<token>` at `_oxp-challenge.<domain>`. Brand-reserved handles can only verify against their canonical domain. API: `POST /api/v1/publishers/{handle}/verifications` (mint) and `…/{id}/check` (run DNS lookup); requires the `publisher:verify` token scope. Successful org-handle verifications mirror onto `Organization.verified` so the existing checkmark badge surfaces in browse + detail UI (Phase B.1; GitHub-OAuth proof deferred to B.1b).
✅ **Tar-bomb / Zip-Slip defences on unpack** — `unpackBundle` rejects symlinks, hardlinks, device files, path-traversal entries, per-file size > 16 MiB, total uncompressed > 64 MiB, and file count > 2000. The publish endpoint runs the same unpack so the registry never trusts client-side scanning (Phase B.3 — partial; string/IOC scanning still pending).
✅ **Per-token publish + per-IP signup rate limits** — sliding-window in-process limiter (`apps/web/lib/rate-limit.ts`); publish 10/h/token, signup 5/h/IP; 429 + `Retry-After` on breach. Consumed BEFORE multipart parsing on publish so a hammering client can't DoS the body parser (Phase B.6).
✅ **TOTP 2FA gate on publish** — users with 2FA enrolled (`/dashboard/security`) must furnish a recent (≤ 10 min) TOTP or recovery code via `POST /api/v1/me/2fa/proof`; the publish endpoint returns `428 Precondition Required` + `WWW-Authenticate: TwoFactor` until the bearer token's `lastTwoFactorAt` is fresh. Recovery codes are bcrypt-hashed (cost 10) and single-use (Phase B.7).
✅ **Build provenance hints** — manifests may declare `provenance.commit`, `provenance.buildCommand`, `provenance.builder`, and `provenance.sourceUrl`. The registry persists them on the version row and renders a Provenance card on the detail page (Phase B.4 — minimal; CI re-build + verified-build badge deferred to B.4b).
✅ **Attestation envelope intake** — the publish endpoint accepts an optional `attestation` multipart field (DSSE / in-toto JSON) and stores it verbatim as `Version.attestationJson`. The detail page shows "Signed attestation present" when a payload is recorded; sigstore / Fulcio verification ships in B.5b (Phase B.5).

## 3. Known holes (what doesn't work today)

⚠️ **Wasmtime backend deferred to Phase B.** Current jco backend uses Node's native `WebAssembly` + `@bytecodealliance/preview2-shim` (no preopens, no env, no network). Per-call wall-clock cap via `runWithTimeout` is in place, but real wasmtime fuel + epoch interruption + `memory_limiter` will replace the wall-clock + recorded-hint stand-ins.
⚠️ Domain TXT publisher verification ships in Phase B.1; **GitHub-OAuth handle proof deferred to B.1b** (needs next-auth GitHub provider wired).
⚠️ No string-level / IOC scanning of bundle contents — structural defences (size, paths, link types) are in place, but suspicious-URL / known-C2 string scans require an indicator-feed pipeline (Phase B.3, deferred).
❌ No revocation mechanism (cannot kill a known-bad bundle on installed hosts) (Phase C.1).
⚠️ Reproducible-build verification ships intake in Phase B.4 (manifest hints + display) but **no automated CI rebuild yet** — `verified-build` badge waits for B.4b.
⚠️ Attestation envelopes are recorded but **not cryptographically verified** — sigstore / Fulcio verification waits for B.5b.
✅ Publish tokens are scoped (`publish:@handle/*` or per-package) and expire by default in 90 days; `oxp token rotate` mints a successor with a 5-minute grace window for in-flight publishes (Phase A.8).
❌ No audit log of publish events (Phase C.2).
⚠️ No first-party UI for token management or publisher key rotation — currently driven by `scripts/issue-token.mjs` and direct DB edits. Tracked in [`ROADMAP-FEATURES.md`](./ROADMAP-FEATURES.md).

## 4. What you should and should not do today

**Safe:**
- Build OXP extensions yourself
- Install your own published extensions
- Install extensions from publishers you personally trust and verify
- Use `oxp-ui-v1` declarative mode (no code path) for any extension you author
- Author component-v1 / hybrid-v1 extensions and rely on the WASI sandbox to keep an honest mistake from reaching the host filesystem

**Not safe yet:**
- Installing arbitrary extensions from oxp.sh on a machine with secrets (no third-party review yet, no domain verification yet, no static-analysis pipeline)
- Running OXP host in CI / production environments
- Treating an unverified `@somehandle` as proof of identity — only handles with a published verification (cyan checkmark) have a proven domain owner; community handles remain self-claimed (Phase B.1)
- Trusting per-call CPU/memory caps to defeat a determined resource-abuse attack — wall-clock + recorded-hint stand-ins until wasmtime fuel/epoch lands in Phase B

## 5. Reporting vulnerabilities

Until we set up `security.txt` and a GPG key (Phase C, item 9), report privately to the project owner via the email in `package.json`. Please do not file public issues for security bugs.

---

*This document is updated at the end of every security phase. Last updated: 3 May 2026 (evening) — **Phase A officially closed**: CI matrix on macOS + Linux green via `.github/workflows/ci.yml`, all 10 threat-attack tests (TA.1–TA.10) passing across 203 tests on every PR, production VS Code bundle 1.1 MB under the 1.5 MB budget; Phase A exit note recorded in [`ROADMAP-SECURITY.md`](./ROADMAP-SECURITY.md). Earlier the same day: A.1, A.4, A.6, A.12, A.13 marked complete to match shipped code; SECURITY posture tables refreshed; TOFU pinning regression test (TA.4) landed.*
