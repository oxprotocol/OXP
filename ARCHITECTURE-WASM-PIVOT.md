# OXP Architecture Pivot — WASI Component Model

> **Status:** Approved 3 May 2026. Supersedes the Worker-thread sandbox plan in [ROADMAP-SECURITY.md](./ROADMAP-SECURITY.md) §A.1 and the JS-only assumptions in [ROADMAP-FEATURES.md](./ROADMAP-FEATURES.md) Pillar 1.
>
> **Owner:** core team. All Phase A.1/A.2/A.4/A.9 work is now subordinate to this document. New phase items A.11/A.12/A.13 introduced.

WASM is not optional — it is the foundation. Worker-thread realm isolation is being replaced with WebAssembly Software Fault Isolation (SFI) via the **WASI Component Model, Preview 2 (pinned `0.2.x`)**. This document is the canonical architecture; downstream roadmap items reference it.

---

## 1. Why WASI

| Property | Worker threads | **WASI Component Model** |
|---|---|---|
| Isolation | Realm-only; shared OS process; capability via API surface | SFI; capabilities are linker-level imports the binary literally cannot fabricate |
| Universality | TS/JS only; per-OS Node binaries | One `.wasm` runs on every OS / CPU / host |
| Languages | JS / TS | Rust, Go (TinyGo), C/C++, Python, JS (via jco), … |
| Standardization | Ad-hoc per host | Bytecode Alliance standard (Microsoft, Intel, Mozilla, Fastly) |
| Capability model | Runtime checks (Phase A.2) | Type system (WIT imports) |
| Audit story | "Trust our gate code" | "Diff the import list" |

Adopting WASI Preview 2 puts OXP on the same standard track as Cursor, JetBrains plugins, and Microsoft's own WASI tooling. We do not invent a runtime — we adopt one and harden the host.

---

## 2. Bundle layout (v2)

```
<bundle>.oxp
├── manifest.json              kind: "ui-v1" | "component-v1" | "hybrid-v1"
├── ui/tree.json               (optional) declarative oxp-ui-v1 tree
├── wasm/core.wasm             (required for component-v1) WASI P2 component
├── wit/world.wit              the world this component targets (signed copy)
└── signature.json             ed25519 over (manifest + wasm + ui + wit)
```

- **`ui-v1`** — declarative tree only, no code. Today's `hello-tree`, today's [SECURITY.md](./SECURITY.md) A.10 policy. Unchanged.
- **`component-v1`** — ships a `.wasm`, must declare its WIT world. The current A.10 reject-`.wasm` rule becomes scoped: `if kind == "ui-v1"`.
- **`hybrid-v1`** — declarative shell + wasm logic.

Existing bundles default to `kind: "ui-v1"` on read — `@aldgar/first-extension@0.0.1` continues to work unmodified.

---

## 3. Runtime topology

The WIT contract is identical on both backends — that is the entire point.

```
┌────────────────────────────── Host ──────────────────────────────┐
│  @oxprotocol/host-runtime                                               │
│  ┌──────────────────────────┬───────────────────────────────┐    │
│  │ NODE / DESKTOP           │ BROWSER / WEBVIEW             │    │
│  │  wasmtime (N-API) or     │  native WebAssembly           │    │
│  │  @bytecodealliance/      │  + jco-transpiled JS shim     │    │
│  │  preview2-shim           │  (component-model-js)         │    │
│  └────────────┬─────────────┴────────────┬──────────────────┘    │
│               │  WIT host-functions       │                      │
│               ▼  (capability broker)      ▼                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Extension component (.wasm)                                 │ │
│  │   imports: oxp:host/ui, oxp:host/fs, oxp:host/net, …        │ │
│  │   exports: oxp:extension/lifecycle (activate, deactivate)   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

`packages/host-runtime/` (capability broker, lifecycle, message routing) is shared. Only the wasmtime instantiator differs per backend. The Worker-thread stubs planned for A.1 are **discarded**, not migrated — two sandbox models = neither gets attention.

---

## 4. WIT contract (`packages/wit/`)

`packages/wit/` becomes the most important package in the repo — the source of truth that all SDKs and host runtimes consume.

```wit
// oxp:extension package — what extensions implement
package oxp:extension@0.1.0;

interface lifecycle {
  activate: func(ctx: ext-context) -> result<_, string>;
  deactivate: func() -> result<_, string>;
}

interface ui {
  render: func(tree: list<u8>);                       // serialized oxp-ui-v1
  on-event: func(event: ui-event) -> result<_, string>;
}

world extension {
  import oxp:host/ui;
  import oxp:host/fs;
  import oxp:host/net;
  import oxp:host/storage;
  import oxp:host/lsp;
  import oxp:host/log;
  export lifecycle;
  export ui;
}
```

```wit
// oxp:host package — capabilities the host provides (gated)
package oxp:host@0.1.0;

interface fs {
  // only paths matching manifest.permissions.fs.read[] resolve;
  // others return err(`forbidden`)
  read-file:  func(path: string) -> result<list<u8>, fs-error>;
  write-file: func(path: string, bytes: list<u8>) -> result<_, fs-error>;
}

interface net {
  // only origins matching manifest.permissions.net.fetch[] resolve
  fetch: func(req: http-request) -> result<http-response, net-error>;
}

interface storage {
  get: func(key: string) -> option<list<u8>>;
  set: func(key: string, value: list<u8>);
  delete: func(key: string);
}
```

The install prompt (A.4) reads the component's import list at install time. **The binary cannot import what the manifest did not declare**, because the registry validates `manifest.permissions ⊇ component.imports` on upload.

---

## 5. Capability ↔ permission mapping

| Manifest permission | WIT import unlocked |
|---|---|
| `permissions.fs.read: ["/workspace/**"]`  | `oxp:host/fs.read-file` (paths filtered) |
| `permissions.fs.write: [...]`             | `oxp:host/fs.write-file` |
| `permissions.net.fetch: ["https://api.x.com/*"]` | `oxp:host/net.fetch` (URL filtered) |
| `permissions.lsp: true`                   | `oxp:host/lsp.*` |
| (always) | `oxp:host/storage`, `oxp:host/log`, `oxp:host/ui` |

Phase A.9 (audit shell paths) collapses entirely — there is no `oxp:host/shell` interface, so no extension can fork a process. If we ever add it, it becomes `oxp:host/exec` with a manifest-declared executable allowlist; not on the table for v1.

---

## 6. Phase A re-mapping

| Old | New | Status |
|---|---|---|
| A.1 Worker sandbox | **A.1 WASI runtime** — wasmtime + jco shim, capability broker | redo from scratch |
| A.2 HostApi capability gates | **subsumed into A.1** (WIT imports = gates) | delete |
| A.3 Signed bundles | unchanged | ✅ done |
| A.4 Install-time prompt | **reads WIT imports**, not manifest array | smaller, stronger |
| A.5 CSP | unchanged for UI surface; wasm has no DOM | ✅ done |
| A.6 Origin isolation | unchanged | not done |
| A.7 TOFU pinning | unchanged | ✅ done |
| A.8 Scoped tokens | unchanged | not done |
| A.9 Audit shell paths | **deleted** — no shell capability exists | n/a |
| A.10 Bundle policy | **scope by `kind`** — `ui-v1` no-code; `component-v1` allows `.wasm` only | small refactor |
| **A.11 (new)** | WIT contract pinning — manifest declares WIT package version, registry rejects mismatches | new |
| **A.12 (new)** | Wasm fuel / epoch limits — bound CPU per call, prevent infinite loops | new |
| **A.13 (new)** | Memory cap — wasmtime memory limit per instance (default 64 MB) | new |

---

## 7. Pillar re-mapping

| Old pillar | New pillar |
|---|---|
| 1. PIYE worker harness | **1. WASI runtime + capability broker** |
| 2. OXP runtime + signed bundles | unchanged (signs `.wasm` instead of `.js`) |
| 3. CLI polish | + `oxp create --template hello-rust`, `--template hello-go` + wasm-opt |
| 4. `@oxprotocol/ui` declarative | unchanged — still the canonical UI tier |
| 5. Migration tooling | + VSIX→component-v1 transpile path (mostly stub for v1) |
| 6. Registry website | + WIT viewer + import diff on update |
| **7. (new)** | Language SDKs — Rust crate, Go module, JS via jco, generated from WIT |
| **8. (new)** | **Performance guarantee** — lazy activation, `oxp stats`, bundle-size cap, 10× memory benchmark suite. Powered by the WASM substrate + A.12/A.13 metering. See [ROADMAP-FEATURES.md](./ROADMAP-FEATURES.md) Pillar 8. |

---

## 8. Toolchain

- `oxp create --template hello-rust` → Cargo project, `wasm32-wasip2` target, `wit-bindgen` deps, sample lifecycle impl
- `oxp create --template hello-go`   → TinyGo project (TinyGo P2 support landed 2025)
- `oxp create --template hello-tree` → unchanged, `kind: "ui-v1"`
- `oxp pack` for component bundles:
  1. Run language-specific build (`cargo build --target wasm32-wasip2 --release`)
  2. `wasm-tools component new` if needed
  3. `wasm-opt -O3` (size)
  4. Validate `world` matches manifest declarations
  5. Tar + zstd + sign (existing pipeline)
- `oxp dev` runs the wasm in the same `host-runtime` the production host uses → dev = prod.

---

## 9. Migration & compatibility

- **`@aldgar/first-extension@0.0.1` keeps working** — `kind: "ui-v1"`, declarative-only, no wasm runtime needed.
- **`oxp-ui-v1` is not deprecated** — right tool for declarative panels. Promotion to component-v1 is opt-in when logic is needed.
- **`@oxprotocol/sdk` (TS)** stays as a thin wrapper that compiles to wasm via jco, but Rust becomes the recommended path because the toolchain is mature.

---

## 10. Open architectural questions

| # | Question | Recommendation | Decision |
|---|---|---|---|
| 1 | Wasmtime binding on Node: `@bytecodealliance/preview2-shim` (pure JS, slower) vs N-API to native wasmtime (component-model support?) | shim for v1, N-API for v2; benchmark before committing | **deferred** |
| 2 | Browser component model: jco-transpile at install time vs pre-shipped in bundle | install-time transpile, cached by sha256 — bundle stays one binary | **deferred** |
| 3 | UI rendering ownership: component owns tree state and emits deltas, OR host renders and component handles events | component owns state, host receives serialized tree on each `render` — Elm/React mental model | **deferred** |
| 4 | Manifest WIT pinning: ship `.wit` in bundle, OR declare `package@version` and host fetches | ship `wit/world.wit` in the bundle (signed); registry hosts canonical copy for tooling | **deferred** |
| 5 | Fuel default per `activate` / event handler call | tentative 100 M fuel (~100 ms wall typical), manifest-overridable up to 1 B with explicit user grant | **deferred** |
| 6 | Worker sandbox stubs in `packages/host-runtime/`: keep as fallback or discard | discard — two sandbox models = none of them gets attention | **decided: discard** |

Items 1–5 will be resolved as their concrete subtasks land; this document is updated in place.

---

## 11. Sequencing

Order chosen to **not break the round-trip we just got green** (`@aldgar/first-extension@0.0.1`).

1. **WIT contract package** (`packages/wit/`) — `oxp:host` + `oxp:extension` worlds, version `0.1.0`. Spec change, no code consumes it yet.
2. **Bundle format v2** — manifest `kind` field, schema update, A.10 scoped to `ui-v1`. Existing bundles get `kind: "ui-v1"` defaulted on read.
3. **`packages/host-runtime/` rewrite** — wasmtime + jco capability broker, no host integration yet. Standalone test harness modeled on the A.7 TOFU harness.
4. **`oxp create --template hello-rust`** — CLI scaffolds a working Rust component targeting the WIT world.
5. **`oxp pack` component path** — build Rust, wrap, sign.
6. **VS Code host adapter** — wire `host-runtime` into existing `Store.install` path.
7. **A.11 / A.12 / A.13** — WIT pinning, fuel, memory caps.
8. **Piye host adapter** — same `host-runtime`, different IO surface.
9. Rest of Phase A (A.4 install prompt now reads WIT, A.6, A.8) — fall out almost for free.

---

## 12. Non-goals (explicit)

- **No `oxp:host/exec` capability** in v1. No process forking from extensions.
- **No bring-your-own-runtime.** wasmtime is the only supported engine for v1; we revisit if a second engine ships full Component Model parity.
- **No WASI Preview 1 support.** Preview 2 only. Authors targeting P1 get a clear `oxp pack` error.
- **No raw `.wasm` modules.** Components only — modules without a WIT world are rejected at pack and at upload.
- **No deprecating `oxp-ui-v1`.** It stays as the no-code declarative tier forever.
