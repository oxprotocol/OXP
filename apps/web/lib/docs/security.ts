import type { DocSection } from "../docs";

export const securityDocs: DocSection[] = [
  {
    slug: "security-model",
    title: "Security Model",
    category: "Security",
    summary: "OXP's threat model, defense layers, and what makes it the most secure extension platform.",
    body: `Security is OXP's **#1 design priority** and its biggest competitive advantage over npm-style and VS-Code-Marketplace-style ecosystems. This page documents the complete threat model, current controls, and known gaps.

## Design Principle

The daemon — not the SDK, not the webview — is the **trust boundary**. Every method call is re-authorized. Every handle is unforgeable. Every sensitive prompt is OS-native (never webview-rendered). Even a benign extension's webview is assumed compromised in the threat model.

## Threat Model

### Assets Protected

- The end-user's machine (filesystem, secrets, network, processes)
- The end-user's identity (auth tokens, SSO sessions)
- The publisher's identity (signing keys, publish tokens)
- The registry's integrity (bundle bytes, version history)
- The supply chain (source → build → sign → publish → install → run)

### Adversaries

| Adversary | Capability | Motivation |
|---|---|---|
| Malicious author | Publishes a crafted \`.oxp\` | Steal data, crypto-mine, ransomware |
| Account hijacker | Steals a publisher's token | Push malicious update |
| Typosquatter | Registers \`@strlpe/checkout\` | Trick users into installing |
| Network attacker | MitM between host and registry | Swap bundle bytes |
| Compromised registry | DB + storage write access | Replace bundles, forge versions |

## Defense Layers

### Layer 1: WASI Sandbox

Extension code runs as a **WASI Preview 2 component** — no DOM, no Node.js, no syscalls. The only way to interact with the host is through WIT-typed imports mediated by the capability broker.

A Wasm component cannot:

- Read or write files without \`fs.read\`/\`fs.write\` permission
- Make network requests without \`net.fetch\` permission
- Access the clipboard, secrets, or terminal without explicit grants
- Fork processes — there is no \`oxp:host/shell\` interface in v1
- Import symbols the manifest didn't declare

### Layer 2: Install-Time Permission Prompts

Before any extension runs, the user sees every requested capability with:

- The capability name and description
- The scope (which files, which URLs)
- The author's rationale
- Allow All / Customize / Deny options

Grants are persisted per \`(publisher, slug)\`. On updates, only _new_ permissions trigger re-prompting.

### Layer 3: Cryptographic Signing

Every bundle is Ed25519-signed at pack time. The host re-verifies on install — zero trust toward the registry. Content-addressable bundles (SHA-256 of uncompressed tar) make tampering detectable.

### Layer 4: TOFU Key Pinning

On first install from a publisher, the host records their public key in \`~/.oxp/trust.json\`. Subsequent installs from the same publisher must use the same key. A different key triggers \`KEY_PINNING_VIOLATION\` — the install is blocked.

The registry also pins keys server-side on first publish.

### Layer 5: Scoped Tokens

Publish tokens are scoped (\`publish:@handle/*\` or per-package) and expire after 90 days by default. The rotation endpoint provides a 5-minute grace window for in-flight publishes.

### Layer 6: Bundle Policy Enforcement

\`assertBundlePolicy\` runs at both CLI pack and registry upload:

- **\`ui-v1\` bundles** — no executable code allowed (no .js, .ts, .wasm, .sh, .exe, etc.)
- **\`component-v1\` bundles** — only a signed \`.wasm\` + \`.wit\`
- **Verified-only capabilities** — \`terminal.*\` and \`process.kill\` denied to unverified publishers
- **Unknown permissions** — rejected by catalog validation

### Layer 7: CSP for Webviews

Every rendered webview gets strict Content Security Policy:

- \`default-src 'none'\`
- Per-render nonce for scripts
- \`connect-src 'none'\`
- \`frame-ancestors 'none'\`
- No inline scripts

### Layer 8: Resource Limits

Per-call wall-clock cap (default 100ms) prevents runaway components. Memory cap (default 64 MiB) bounds resource usage. Exceeding limits disposes the instance.

## What's Safe Today

- Building and publishing your own extensions
- Installing extensions from publishers you personally trust
- Using \`ui-v1\` declarative mode (no code execution path)
- Relying on the WASI sandbox to contain honest mistakes

## Known Gaps

- No publisher domain verification yet (Phase B)
- No bundle static analysis beyond policy checks (Phase B)
- No revocation mechanism for known-bad bundles (Phase C)
- No reserved namespace enforcement (Phase B)
- Wall-clock time limits only — real wasmtime fuel coming in Phase B`,
  },
  {
    slug: "signing-verification",
    title: "Signing & Verification",
    category: "Security",
    summary: "How bundles are signed with Ed25519 or Sigstore and verified at every step.",
    body: `Every OXP bundle is cryptographically signed. The signature chain ensures that bundles are tamper-proof from the author's machine to the user's IDE.

## Signing Algorithms

### Ed25519 (default)

Fast, offline-capable signing with an Ed25519 keypair. Keys are generated by \`oxp keygen\` and stored at \`~/.oxp/keys/\`.

The signature covers the **bundle digest** (SHA-256 of the uncompressed tar stream):

\`\`\`json
{
  "alg": "ed25519",
  "keyId": "ed25519:0xABCD...",
  "signature": "base64...",
  "payload": {
    "digest": "sha256:e3b0c44...",
    "signedAt": "2026-05-03T12:00:00Z"
  }
}
\`\`\`

### Sigstore (keyless)

For maximum trust, OXP supports Sigstore keyless signing:

- **Identity**: OIDC token from the publisher's account
- **Certificate**: Fulcio short-lived signing certificate
- **Transparency**: Rekor inclusion proof (publicly auditable)
- **Storage**: Full Sigstore bundle in \`.oxp/SIGNATURE\`

## Verification Chain

### At Pack Time

\`oxp pack\` signs the bundle and embeds the signature. The bundle digest is the SHA-256 of the uncompressed tar — stable across recompression.

### At Publish Time

The registry:

1. Verifies the signature against the publisher's registered key
2. Checks TOFU key pinning (is this the same key they've always used?)
3. Records the signature and key ID in the version record
4. Stores the bundle bytes content-addressed by digest

### At Install Time

The host runs the full verification pipeline:

1. **Downloads** manifest, bundle, and signature from the registry
2. **Re-computes** the bundle digest from the downloaded bytes
3. **Verifies** the Ed25519 signature (or Sigstore bundle) against the digest
4. **Checks TOFU** — is this publisher's key already pinned in \`trust.json\`?
5. **Verifies per-file integrity** — every file hash in \`.oxp/integrity.json\` matches
6. **Validates the WIT pin** — for component bundles, the declared WIT hash must match

Any failure in steps 2-6 is a **hard install error**. The bundle is not extracted.

## Key Management

### Generating Keys

\`\`\`bash
oxp keygen
# Creates ~/.oxp/keys/ed25519.key and ~/.oxp/keys/ed25519.pub
# Prints: ed25519:0xABCD1234...
\`\`\`

### Key Registration

Your public key is automatically registered with the registry on first publish. After that, it's pinned — you can't publish with a different key without going through the key rotation flow.

### Key Rotation

If you need to rotate your signing key (compromised key, new machine, team changes):

1. Authenticate with the registry (requires re-auth)
2. The old key is retired with an audit log entry
3. New key is pinned server-side
4. Host-side TOFU stores are updated on next install

> Currently this requires a manual flow. A self-service UI is planned for the dashboard.

## Trust Policy

The CLI refuses unsigned bundles by default. The flag \`--unsafe-allow-unsigned\` is only permitted against \`localhost\` registries and during \`oxp dev\`. A clear, persistent warning is shown.

## Audit Trail

Every publish, signature verification, and key operation is logged. Phase C will add a tamper-evident, hash-chained audit log with a daily public Merkle root.`,
  },
];
