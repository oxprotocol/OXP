# @oxprotocol/wit

WIT (WebAssembly Interface Types) contracts for the OXP Component Model runtime — the source of truth for the WASI Preview 2 worlds the host implements and extension components target.

> See [`ARCHITECTURE-WASM-PIVOT.md`](../../ARCHITECTURE-WASM-PIVOT.md) for the design rationale and [`ROADMAP-SECURITY.md`](../../ROADMAP-SECURITY.md) §A.11 for the pinning contract.

## What's in here

| File | Purpose |
|---|---|
| `wit/oxp-host.wit` | `oxp:host@0.1.0` — capability interfaces the host provides (fs, net, secrets, ui, storage, log, commands). Each is gated by manifest permissions. |
| `wit/oxp-extension.wit` | `oxp:extension@0.1.0` — interfaces components export (lifecycle, ui-handler, command-handler) plus the canonical `extension` world. |
| `src/version.ts` | Pinned version constants and `SUPPORTED_WIT_PINS`. |
| `src/canonical.ts` | Canonical-form normalizer + sha256 used for A.11 pinning. |
| `src/files.ts` | Loader for the bundled `.wit` files plus `worldSha256()`. |

## Pinning (Phase A.11)

The manifest declares the world it targets:

```json
"wit": {
  "package": "oxp:extension",
  "version": "0.1.0",
  "sha256": "<hex>"
}
```

The registry recomputes `worldSha256()` from this package on publish and rejects mismatches. The host refuses to instantiate any component pinned to a `package@version` it does not ship.

## Stability

`0.1.0` is the launch contract. Any breaking change goes to `0.2.0` and ships alongside coordinated updates to the host runtime, the manifest schema, and the migration note in the architecture doc.
