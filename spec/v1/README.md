# OXP Spec — v1

This directory contains the normative specification for OXP v1.

## Files

| File | Status | Purpose |
|---|---|---|
| [`manifest.schema.json`](manifest.schema.json) | **Normative** | JSON Schema for `oxp.json`. Validated by `oxp publish`. |
| [`protocol.md`](protocol.md) | **Normative** | JSON-RPC 2.0 wire protocol between extension and host (`oxp.fs.*`, `oxp.window.*`, …). |
| [`bundle.md`](bundle.md) | **Normative** | `.oxp` bundle layout, signing (Sigstore), OCI artifact representation. |
| [`examples/postgres-studio.oxp.json`](examples/postgres-studio.oxp.json) | Informative | Reference manifest for a representative extension. |
| `permissions.md` | _planned_ | Capability catalogue, sensitivity tiers, consent flows. |
| `governance.md` | _planned_ | Versioning, RFC process, deprecation policy. |

## Validating a manifest

Any JSON Schema 2020-12 validator works. Examples:

```bash
# Node — using ajv-cli
npx ajv-cli validate \
  -s spec/v1/manifest.schema.json \
  -d spec/v1/examples/postgres-studio.oxp.json \
  --spec=draft2020

# Python
python -m jsonschema -i spec/v1/examples/postgres-studio.oxp.json \
  spec/v1/manifest.schema.json
```

## Stability

The schema is **frozen** at `specVersion: "1"`. Additive, backward-compatible
fields may land in v1 minor revisions; anything breaking ships as v2 with a new
`$id` URL and a parallel publish path.

## Reporting issues

Open an issue at the OXP spec repo (see `SPEC.md` at the repo root). Spec
changes follow the RFC process documented in `governance.md` (forthcoming).
