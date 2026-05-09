# OXP Bundle Format — v1

**Status:** Normative. Spec version `1`.

This document defines the on-disk format of an OXP extension bundle, how
bundles are signed, and how they are stored and distributed via OCI-compatible
registries.

OXP bundles are **OCI artifacts** signed with **Sigstore**. Both standards are
adopted verbatim — OXP adds only the manifest schema (`oxp.json`) and the
artifact media types defined below.

## 1. On-disk layout

A bundle is a directory tree. Paths are POSIX style and case-sensitive.

```
my-extension/
├── oxp.json                         REQUIRED — manifest (see manifest.schema.json)
├── README.md                        Optional, surfaced on the extension page
├── CHANGELOG.md                     Optional
├── LICENSE                          REQUIRED if license is not "UNLICENSED"
├── icons/
│   └── icon.svg                     Referenced by manifest.icon
├── ui/                              Present iff manifest.main.ui is set
│   ├── index.html                   Entry document (CSP-locked, no inline scripts)
│   ├── assets/
│   │   ├── main.[hash].js           ES2022, no eval, no Function ctor
│   │   ├── main.[hash].css          Tailwind purged, atomic
│   │   └── *.{woff2,svg,png,webp}
│   └── chunks/                      Code-split lazy chunks
├── wasm/                            Present iff manifest.main.wasm is set
│   ├── core.wasm                    WASI Component Model, Preview 2
│   └── core.d.ts                    Generated TS types (informative)
├── contributions/                   Files referenced by manifest.contributes
│   ├── commands.json
│   ├── views.json
│   ├── menus.json
│   └── keybindings.json
└── locales/                         Optional i18n catalogues
    ├── en.json                      REQUIRED if any locale present (fallback)
    └── <bcp47>.json
```

### 1.1 Reserved paths

The following paths are reserved and MUST NOT appear in author bundles. They
are added by `oxp publish` after author content is finalised:

| Path | Purpose |
|---|---|
| `.oxp/integrity.json` | Per-file SHA-256 manifest |
| `.oxp/SIGNATURE` | Sigstore bundle (DSSE envelope + cert + Rekor proof) |

### 1.2 Path rules

- File names MUST match `^[A-Za-z0-9._-][A-Za-z0-9._/-]{0,254}$`.
- No symlinks, hardlinks, devices, FIFOs, or sockets.
- No path may resolve outside the bundle root (no `..` components after
  normalisation).
- Total uncompressed size MUST NOT exceed **64 MiB**. The registry rejects
  larger uploads.
- Individual files MUST NOT exceed **16 MiB**.
- File count MUST NOT exceed **2,000**.

### 1.3 UI bundle constraints

Enforced by `oxp publish`. Violations are publish errors, not warnings.

| Rule | Limit |
|---|---|
| Total `ui/**` size, gzipped | ≤ **300 KiB** (warn at 200) |
| `ui/index.html` script-src | `'self' 'wasm-unsafe-eval'` only; no `unsafe-inline`, no remote origins |
| Inline `<script>` blocks | Forbidden |
| `eval`, `new Function`, `setTimeout(string, …)` | Forbidden (static analysis) |
| External fonts/images/CSS | Forbidden — bundle them |
| Service workers | Forbidden |

### 1.4 Wasm constraints

| Rule | Value |
|---|---|
| Format | WASI Component Model, Preview 2 (`wasi:cli@0.2`, `wasi:io@0.2`, `wasi:filesystem@0.2`) |
| Imports | Limited to a fixed allowlist published in `spec/v1/wasi-imports.md` |
| Size | ≤ **8 MiB** per component |
| Memory | Initial ≤ 16 MiB; grow ≤ 256 MiB; daemon-enforced |

### 1.5 Build hooks (`scripts`)

Authors MAY declare optional build hooks in `oxp.json`:

```json
{
  "scripts": {
    "build":      "cargo build --release --target wasm32-wasip2 && cp target/wasm32-wasip2/release/foo.wasm build/",
    "prepublish": "cargo test --release"
  }
}
```

Behaviour:

- **`scripts.build`** — `oxp pack` runs this via `sh -c` from the project root **before** walking the bundle directory. It MUST place every artefact referenced by the manifest (e.g. `main.wasm`) on disk before exiting `0`. A non-zero exit aborts pack. Skip with `oxp pack --no-build`.
- **`scripts.prepublish`** — `oxp publish` runs this via `sh -c` from the project root **after** a successful pack and **before** uploading. A non-zero exit aborts publish. Skip with `oxp publish --no-prepublish`.

Build hooks are author-controlled commands executed in the publisher's local shell. They are **not** part of the deterministic bundle (the contents of the working tree at `oxp pack` time are). Reproducible-build attestation should use `provenance.buildCommand`, which is what the registry replays.

## 2. Distribution archive (`.oxp` file)

The archive form used for transport, signing, and storage.

- **Format:** POSIX `tar` (USTAR) compressed with **zstd** level 19.
- **Filename suffix:** `.oxp` (NOT `.tar.zst`; the `.oxp` suffix is the public
  contract).
- **Tar entry order:** `oxp.json` MUST be the first entry. All other entries
  in lexicographic order. This makes streaming validation and partial fetches
  cheap.
- **Tar entry mtime:** All entries MUST have mtime `1980-01-01T00:00:00Z`.
  Reproducible builds; identical inputs → identical bundle hash.
- **Tar entry mode:** `0644` for files, `0755` for directories. uid/gid `0`.
- **No global tar header extensions** beyond ustar.

### 2.1 Bundle digest

Defined as the **SHA-256 of the uncompressed tar stream** (not the compressed
`.oxp` file). Rationale: stable across recompression; compatible with how OCI
content-addresses uncompressed layers via `application/vnd.…+gzip` digests.

The digest is recorded in `oxp.json` `integrity.bundleSha256` and as the OCI
layer descriptor digest (§4).

### 2.2 Per-file integrity

`.oxp/integrity.json` is generated by `oxp publish`:

```json
{
  "specVersion": "1",
  "algorithm": "sha-256",
  "files": {
    "oxp.json":       "e3b0c44…",
    "ui/index.html":  "a4d2…",
    "wasm/core.wasm": "9b1c…"
  }
}
```

Hosts SHOULD verify per-file digests on extract. The daemon MUST refuse to
load any file whose digest does not match.

## 3. Signing (Sigstore)

OXP uses [Sigstore](https://www.sigstore.dev/) for keyless, transparency-logged
publisher identity binding. Plain Ed25519 is supported for offline / air-gapped
publishing only.

### 3.1 Sigstore (default)

- **Identity:** OIDC token from the publisher's account on `oxp.sh` (or a
  federated provider listed in `spec/v1/oidc-providers.md`).
- **Signature:** DSSE envelope over the bundle digest (§2.1).
- **Transparency log:** Inclusion proof from
  [Rekor](https://docs.sigstore.dev/logging/overview/) MUST be embedded.
- **Storage:** The full Sigstore bundle (cert chain + DSSE + Rekor proof) is
  written to `.oxp/SIGNATURE` as a single JSON document conforming to the
  [Sigstore Bundle v0.3](https://github.com/sigstore/protobuf-specs) schema.
- **Verification:** Clients MUST verify all of: certificate chain to Fulcio
  root, OIDC identity matches the publisher claimed in `oxp.json`, Rekor
  inclusion proof, and that the signed payload digest equals §2.1.

### 3.2 Ed25519 (offline)

- **Algorithm:** Ed25519 over the raw bundle digest (§2.1).
- **Public key registration:** Publisher pre-registers the public key via
  `POST /v1/publishers/{handle}/keys` on `oxp.sh`.
- **Storage:** `.oxp/SIGNATURE` contains:
  ```json
  {
    "alg": "ed25519",
    "keyId": "ed25519:0x…",
    "signature": "base64…",
    "payload": { "digest": "sha256:…", "signedAt": "rfc3339" }
  }
  ```
- **Verification:** Client fetches the publisher's registered keys from
  `oxp.sh`, verifies the signature, checks `keyId` is currently active (not
  revoked), and checks `signedAt` is within the key's validity window.

### 3.3 Trust policy

The CLI refuses unsigned bundles by default. The flag
`--unsafe-allow-unsigned` is permitted only against `localhost` registries and
during `oxp dev`. A clear, persistent warning is shown.

## 4. OCI representation

OXP bundles are stored in OCI-compliant registries
([OCI Distribution Spec v1.1+](https://github.com/opencontainers/distribution-spec)).
This makes any OCI registry — Docker Hub, GHCR, ECR, GAR, Quay, Harbor,
self-hosted Zot — a valid OXP mirror.

### 4.1 Repository naming

```
<registry>/<publisher>/<slug>:<version>
```

Examples:

```
oci.oxp.sh/acme/postgres:1.4.2
ghcr.io/acme/oxp-postgres:1.4.2
internal.corp/oxp/acme/postgres:1.4.2
```

`<version>` is the manifest's semver, verbatim. `latest` is reserved and
managed by the registry.

### 4.2 Media types

| Media type | Purpose |
|---|---|
| `application/vnd.oxp.config.v1+json`     | OCI config blob — copy of `oxp.json` |
| `application/vnd.oxp.bundle.v1.tar+zstd` | The `.oxp` archive layer |
| `application/vnd.oxp.signature.v1+json`  | Sigstore bundle (separate ref) |
| `application/vnd.oxp.icon.v1`            | Optional icon blob (PNG or SVG) |
| `application/vnd.oci.artifact.manifest.v1+json` | The OCI artifact manifest |

### 4.3 Artifact manifest

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.artifact.manifest.v1+json",
  "artifactType": "application/vnd.oxp.bundle.v1+json",
  "config": {
    "mediaType": "application/vnd.oxp.config.v1+json",
    "digest": "sha256:…",
    "size": 1893
  },
  "layers": [
    {
      "mediaType": "application/vnd.oxp.bundle.v1.tar+zstd",
      "digest": "sha256:…",
      "size": 482113
    }
  ],
  "annotations": {
    "org.opencontainers.image.title": "Postgres Studio",
    "org.opencontainers.image.version": "1.4.2",
    "org.opencontainers.image.licenses": "MIT",
    "org.opencontainers.image.source": "https://github.com/acme/oxp-postgres",
    "sh.oxp.spec.version": "1",
    "sh.oxp.publisher": "acme",
    "sh.oxp.id": "@acme/postgres"
  }
}
```

### 4.4 Signature reference

Per the [OCI Reference Types](https://github.com/opencontainers/distribution-spec/blob/main/spec.md#listing-referrers)
extension, the signature is stored as a **separate artifact referencing** the
bundle by digest. This matches Cosign's layout and lets a registry list
signatures independently:

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.artifact.manifest.v1+json",
  "artifactType": "application/vnd.dev.sigstore.bundle.v0.3+json",
  "subject": {
    "mediaType": "application/vnd.oci.artifact.manifest.v1+json",
    "digest": "sha256:…"
  },
  "layers": [
    {
      "mediaType": "application/vnd.oxp.signature.v1+json",
      "digest": "sha256:…",
      "size": 7341
    }
  ]
}
```

Discovery via the standard OCI referrers API:
`GET /v2/<repo>/referrers/<bundle-digest>?artifactType=application/vnd.dev.sigstore.bundle.v0.3+json`.

## 5. Publish pipeline (normative)

`oxp publish` MUST execute, in order:

1. **Validate** the working directory against `manifest.schema.json`.
2. **Lint** UI bundle constraints (§1.3) and Wasm constraints (§1.4).
3. **Stamp** `oxp.json.integrity` (clearing any author-supplied value first).
4. **Pack** the bundle to a deterministic tar+zstd stream (§2).
5. **Hash** the uncompressed tar stream → `bundleSha256`.
6. **Sign** the digest via Sigstore (default) or Ed25519 (offline) → write
   `.oxp/SIGNATURE`. Re-pack so the signature is included.
7. **Push** as an OCI artifact (§4) to the configured registry.
8. **Push** the signature artifact referencing the bundle.
9. **Verify round-trip** by pulling the published manifest and re-checking the
   bundle digest.

A failure at any step aborts the publish; partial artifacts are garbage-
collected by the registry's standard untagged-cleanup.

## 6. Install pipeline (normative)

`oxp install <id>[@<range>]` MUST execute, in order:

1. **Resolve** version via the registry's resolve endpoint.
2. **Pull** the OCI artifact and its signature reference.
3. **Verify** the signature per §3 against the publisher identity in `oxp.json`.
4. **Verify** the bundle digest matches the OCI layer descriptor.
5. **Extract** to `~/.oxp/store/<publisher>/<slug>/<version>/`.
6. **Verify** per-file digests against `.oxp/integrity.json`.
7. **Display** the permission consent dialog with rationales (§permissions).
8. On consent: **detect** installed hosts and, for each, **emit a host wrapper**
   via the appropriate adapter and **install via the host's own CLI** (e.g.
   `code --install-extension <vsix>`).
9. **Write** install state to `~/.oxp/state.json`.

Steps 3–4 failing is a hard install error. Step 7 declined is a clean abort
(no state mutation).

## 7. Mirroring and air-gapped use

Because OXP bundles are vanilla OCI artifacts:

- `oras copy oci.oxp.sh/acme/postgres:1.4.2 internal.corp/oxp/acme/postgres:1.4.2`
  is a complete mirror operation.
- `crane`, `skopeo`, `regctl`, and `oras` all work without modification.
- Enterprise registries (Harbor, JFrog Artifactory, Nexus) host OXP without
  any OXP-specific configuration.
- Sigstore signatures travel as referrer artifacts, so signed mirrors are a
  single command.

The CLI's `--registry` flag overrides the default `oci.oxp.sh`. No other
behaviour changes — there is no "official mirror" privilege at the protocol
level.

## 8. Conformance

A bundle is **OXP v1 conformant** iff:

1. It conforms to §1 layout and limits.
2. Its `oxp.json` validates against `manifest.schema.json` v1.
3. It is packed per §2.
4. It carries a `.oxp/SIGNATURE` per §3.
5. When stored in a registry, it uses the media types in §4.2 and the
   manifest shape in §4.3.

A registry is **OXP v1 conformant** iff:

1. It implements the OCI Distribution Spec v1.1 or later.
2. It supports the OCI Referrers API (for signature discovery).
3. It accepts the media types in §4.2 without filtering.

Either condition (1) on the bundle side and (1)–(3) on the registry side is
sufficient — no OXP-specific server logic is required.
