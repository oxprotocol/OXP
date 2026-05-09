# OXP Protocol — v1

**Status:** Normative. Spec version `1`.

This document defines the wire protocol between an OXP extension and its host
IDE. It is the contract every `@oxprotocol/sdk` implementation MUST honor and every
host adapter MUST implement.

## 1. Transport

- **Wire format:** [JSON-RPC 2.0](https://www.jsonrpc.org/specification).
- **Framing:** LSP-style `Content-Length` headers over a byte stream.
  ```
  Content-Length: 138\r\n
  \r\n
  {"jsonrpc":"2.0","id":1,"method":"oxp.fs.readFile","params":{...}}
  ```
- **Transport:**
  - **Unix domain socket** at `$XDG_RUNTIME_DIR/oxp/oxpd.sock` (Linux/macOS), permissions `0600`.
  - **Named pipe** at `\\.\pipe\oxp.<user-sid>` (Windows).
  - **TCP loopback is forbidden** — UDS/pipes only. Rationale: any local process can connect to TCP; UDS gets POSIX file-permission ACLs for free.
- **Encoding:** UTF-8. Binary payloads use base64 in JSON; payloads >32 KiB SHOULD
  be transferred via shared-memory handles (see §6).
- **Concurrency:** Multiple in-flight requests per connection are permitted.
  Responses MAY arrive out of order; clients correlate by `id`.

## 2. Connection lifecycle

```
Extension host (per-extension shim)               oxpd (daemon)
        │                                              │
        │  ── 1. open UDS connection ───────────────▶  │
        │                                              │
        │  ── 2. oxp.handshake { activationToken } ─▶  │
        │  ◀─ 3. result { sessionToken, capabilities } │
        │                                              │
        │  ── 4. oxp.* method calls (sessionToken) ─▶  │
        │  ◀─── 5. results / errors / notifications ── │
        │                                              │
        │  ── 6. oxp.shutdown ───────────────────────▶ │
        │  ── 7. close ─────────────────────────────▶  │
```

- The **activation token** is a single-use opaque string injected into the
  extension shim by the IDE wrapper at activation time. The daemon trades it for
  a long-lived **session token** bound to the extension id and granted
  capability set.
- The session token MUST be passed in the `_session` field of every subsequent
  request's params.
- Sessions terminate on `oxp.shutdown`, transport disconnect, or a 30 s idle
  timeout after extension deactivation.

## 3. Request envelope

Every method call carries the session token alongside method-specific params:

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "oxp.fs.readFile",
  "params": {
    "_session": "sess_01HXYZ…",
    "handle": "fh_01HQ…"
  }
}
```

Notifications (no `id`) are reserved for daemon → extension events
(`oxp/event:*`). Extensions MUST NOT send notifications.

## 4. Errors

Standard JSON-RPC error object plus an OXP-specific `code` enum in `data.code`:

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "error": {
    "code": -32000,
    "message": "Permission denied: fs.write outside ${extdata}",
    "data": { "code": "E_PERMISSION_DENIED", "capability": "fs.write" }
  }
}
```

| `data.code`              | Meaning |
|---|---|
| `E_PERMISSION_DENIED`    | Capability not granted, or scope mismatch. |
| `E_CAPABILITY_REVOKED`   | User revoked at runtime; extension SHOULD degrade gracefully. |
| `E_INVALID_HANDLE`       | Opaque handle is unknown, expired, or forged. |
| `E_HANDLE_OUT_OF_SCOPE`  | Handle is valid but outside this extension's permitted scope. |
| `E_NOT_FOUND`            | Resource (file, command, view, secret) does not exist. |
| `E_ALREADY_EXISTS`       | Conflicting create. |
| `E_RATE_LIMITED`         | Too many calls; retry after `data.retryAfterMs`. |
| `E_HOST_UNSUPPORTED`     | Host adapter does not implement this method (see §5 capability bits). |
| `E_USER_CANCELLED`       | Sensitive prompt was declined. |
| `E_INTERNAL`             | Daemon bug. Reported with a `data.requestId` for triage. |

## 5. Host capability discovery

Not every host implements every method (e.g. terminal APIs are missing in some
web IDEs). On handshake the daemon returns the host's capability bitset:

```json
{
  "sessionToken": "sess_…",
  "host": { "id": "vscode", "version": "1.95.0", "tier": "L0" },
  "capabilities": {
    "fs": true,
    "terminal": true,
    "secrets": true,
    "net": true,
    "ui.surfaces": ["sidebar", "panel", "modal", "statusbar"],
    "ui.nativeRenderer": false,
    "events": true
  }
}
```

Extensions MUST gate calls on these flags. Calling an unsupported method yields
`E_HOST_UNSUPPORTED`.

## 6. Method catalogue

All methods are namespaced `oxp.<group>.<name>`. Method names are stable within
spec v1; additions are minor revisions, removals are v2.

### 6.1 `oxp.window.*`

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.window.notify` | `{ message, level?: "info"\|"warn"\|"error" }` | `null` | `notifications.show` (ambient) |
| `oxp.window.showMessage` | `{ message, actions?: string[] }` | `{ chosen: string \| null }` | ambient |
| `oxp.window.showQuickPick` | `{ items: QuickPickItem[], placeholder?, canPickMany?: boolean }` | `{ picked: QuickPickItem \| QuickPickItem[] \| null }` | ambient |
| `oxp.window.showInput` | `{ prompt, placeholder?, value?, password?: boolean }` | `{ value: string \| null }` | ambient |
| `oxp.window.openSurface` | `{ id, surface: "sidebar"\|"panel"\|"modal"\|"statusbar" }` | `null` | ambient |

### 6.2 `oxp.fs.*`

All paths are accessed through opaque **`FileHandle`s**. Extensions cannot
synthesise paths they were not granted; the daemon mints handles only for paths
matching the extension's `fs.read`/`fs.write` scopes.

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.fs.resolve` | `{ path: string }` | `{ handle: FileHandle, kind: "file"\|"dir" }` | `fs.read` |
| `oxp.fs.list` | `{ handle: FileHandle, glob?: string }` | `{ entries: { name, kind, size, mtime }[] }` | `fs.read` |
| `oxp.fs.readFile` | `{ handle, encoding?: "utf8"\|"base64" }` | `{ content, encoding, sha256 }` | `fs.read` |
| `oxp.fs.writeFile` | `{ handle, content, encoding?: "utf8"\|"base64", create?: boolean }` | `{ bytesWritten }` | `fs.write` |
| `oxp.fs.delete` | `{ handle, recursive?: boolean }` | `null` | `fs.delete` (sensitive) |
| `oxp.fs.watch` | `{ handle, recursive?: boolean }` | `{ subscriptionId }` | `fs.watch` |
| `oxp.fs.unwatch` | `{ subscriptionId }` | `null` | `fs.watch` |

Watch events arrive as `oxp/event:fs.change` notifications.

### 6.3 `oxp.workspace.*`

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.workspace.getRoots` | — | `{ roots: { name, handle }[] }` | `workspace.read` |
| `oxp.workspace.getOpenFiles` | — | `{ files: { handle, languageId, dirty }[] }` | `workspace.read` |
| `oxp.workspace.activeEditor` | — | `{ handle, languageId, selection } \| null` | `workspace.read` |
| `oxp.workspace.openEditor` | `{ handle, preview?: boolean }` | `null` | `workspace.write` |
| `oxp.workspace.applyEdit` | `{ edits: TextEdit[] }` | `{ applied: boolean }` | `workspace.write` |

### 6.4 `oxp.commands.*`

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.commands.register` | `{ id, title }` | `null` | ambient |
| `oxp.commands.unregister` | `{ id }` | `null` | ambient |
| `oxp.commands.execute` | `{ id, args?: any[] }` | `{ result: any }` | ambient (own commands) / `commands.executeHost` (host commands) |

Invocation of a registered command surfaces as `oxp/event:command.invoked`.

### 6.5 `oxp.terminal.*`

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.terminal.spawn` | `{ command: string, args: string[], cwd?: handle, env?: Record<string,string> }` | `{ pid, terminalId }` | `terminal.spawn` (sensitive when shell metacharacters present) |
| `oxp.terminal.write` | `{ terminalId, data: string }` | `null` | `terminal.spawn` |
| `oxp.terminal.kill` | `{ terminalId, signal?: "TERM"\|"KILL" }` | `null` | `process.kill` (sensitive) |

`spawn.args` MUST be an array. Single-string commands are rejected at
schema-level. Shell features (pipes, redirects) require the separate
`terminal.shell` capability; the daemon then invokes via `sh -c`.

Terminal output arrives as `oxp/event:terminal.data` notifications.

### 6.6 `oxp.net.*`

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.net.fetch` | `{ url, method?, headers?, body?, timeoutMs? }` | `{ status, headers, body, bodyEncoding }` | `net.fetch` (scope = URL pattern allowlist) |

Network calls are executed by the daemon, not the webview. Wildcard hosts
(`https://*`) are sensitivity-elevated to `sensitive` regardless of author
declaration.

### 6.7 `oxp.secrets.*`

Backed by the host OS keychain (Keychain on macOS, Credential Manager on
Windows, libsecret/KWallet on Linux). Secrets are scoped to the extension and
partitioned by user.

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.secrets.get` | `{ key }` | `{ value: string \| null }` | `secrets.read` (sensitive) |
| `oxp.secrets.set` | `{ key, value }` | `null` | `secrets.write` (sensitive) |
| `oxp.secrets.delete` | `{ key }` | `null` | `secrets.write` (sensitive) |

### 6.8 `oxp.clipboard.*`

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.clipboard.read` | — | `{ text }` | `clipboard.read` |
| `oxp.clipboard.write` | `{ text }` | `null` | `clipboard.write` |

### 6.9 `oxp.events.*` (cross-extension bus)

Pub/sub for inter-extension messaging within a workspace. Topic strings are
free-form but namespaced to the publishing extension by the daemon
(`@acme/postgres:schema-changed`).

| Method | Params | Returns | Capability |
|---|---|---|---|
| `oxp.events.publish` | `{ topic, payload }` | `null` | `events.publish` |
| `oxp.events.subscribe` | `{ topicPattern }` | `{ subscriptionId }` | `events.subscribe` |
| `oxp.events.unsubscribe` | `{ subscriptionId }` | `null` | `events.subscribe` |

Delivered as `oxp/event:bus.message` notifications.

### 6.10 Lifecycle

| Method | Params | Returns |
|---|---|---|
| `oxp.handshake` | `{ activationToken, sdkVersion, specVersion }` | `{ sessionToken, host, capabilities }` |
| `oxp.ping` | — | `{ ok: true, serverTimeMs }` |
| `oxp.shutdown` | — | `null` |

## 7. Server-pushed notifications

| Method | Payload |
|---|---|
| `oxp/event:fs.change` | `{ subscriptionId, kind: "create"\|"change"\|"delete", path }` |
| `oxp/event:terminal.data` | `{ terminalId, data, stream: "stdout"\|"stderr" }` |
| `oxp/event:terminal.exit` | `{ terminalId, exitCode, signal? }` |
| `oxp/event:command.invoked` | `{ commandId, args }` |
| `oxp/event:bus.message` | `{ subscriptionId, topic, payload }` |
| `oxp/event:workspace.activeEditor` | `{ handle \| null }` |
| `oxp/event:host.themeChanged` | `{ tokens: Record<string,string> }` |
| `oxp/event:capability.revoked` | `{ capability, scope }` |

## 8. Versioning

- Spec version is exchanged in `oxp.handshake`. The daemon SHOULD accept any
  v1 SDK; SDK MUST refuse to operate against a daemon advertising spec v0 or
  v2.
- New methods within v1 are additive only. Adding a parameter is allowed if it
  is optional. Removing or renaming a method or making a previously optional
  parameter required is a v2 break.
- Capability bits in §5 may be added in minor revisions; SDKs MUST treat
  unknown capabilities as `false`.

## 9. Security invariants

The daemon — not the SDK, not the webview — is the trust boundary.

1. **Every method call is re-authorized.** A granted capability is necessary
   but not sufficient; the daemon also checks that the resource (handle, URL,
   command id) lies within the granted scope.
2. **Handles are unforgeable.** They are random, single-extension, and expire
   on session end. The daemon rejects handles minted for other extensions with
   `E_INVALID_HANDLE`.
3. **Sensitive methods prompt out-of-process.** OS-native dialogs only —
   never a webview-rendered prompt (a malicious extension's webview can spoof
   these).
4. **The webview is hostile in the threat model.** Even a benign extension's
   webview must be assumed compromised; the SDK runs there but the daemon
   trusts none of it.
5. **Every call is audit-logged** to `~/.oxp/audit.log` with timestamp,
   extension id, capability, scope match, and result. Append-only, rotated.

## 10. Conformance

A host is **OXP v1 conformant** iff it implements:

- §1 transport (UDS/pipe + framing).
- §2 lifecycle.
- §3–§4 envelope and errors.
- §6.1, §6.2, §6.3, §6.4, §6.10 in full.
- At least one of §6.5/§6.6/§6.7/§6.8 with the corresponding capability bit
  set in §5.

Hosts SHOULD implement the remaining method groups; missing groups MUST be
declared via §5 capability bits and MUST return `E_HOST_UNSUPPORTED` if called.
