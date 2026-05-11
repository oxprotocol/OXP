# OXP Extension API — v1 (LOCKED)

> Status: **LOCKED — signed off 10 May 2026.**
> Every adapter (VS Code, JetBrains, Neovim, Zed) implements this surface.
> No host ships a contribution point that isn't listed here. No bundle uses
> a capability that isn't listed here. Changes go to v1.x (additive) or v2.

## Design rules

1. **Intersection, not union.** A contribution point is in v1 *only* if it
   has a natural, non-pathological implementation in all four target IDEs
   (VS Code, JetBrains Platform, Neovim, Zed). Anything that only works on
   one IDE is out, or moves to a per-IDE capability flag.
2. **No DOM.** Authors target the OXP API, not a webview. UI surfaces are
   declared structurally (tree views, status bar items, form panels) so
   each host can render them natively.
3. **Permission-gated by default.** Every capability requires a manifest
   declaration in `oxp.json`. Hosts deny by default and prompt the user
   on first use.
4. **Frozen.** v1 never breaks. New surface goes to v1.x as additive
   contribution points, or to a v2 spec.

## Locked decisions (v1)

| # | Decision                                                                                     |
|---|----------------------------------------------------------------------------------------------|
| 1 | `Position` / `Range` use VS Code shape (see below).                                          |
| 2 | URI scheme is `oxp://workspace/<path>`. Hosts translate to/from native paths.                |
| 3 | `when` clauses are a strict subset of VS Code's grammar (see below).                         |
| 4 | `deactivate()` is host-killed after **5000ms**.                                              |
| 5 | Bundle entry is an **ESM module** exporting `activate` (required) and `deactivate` (optional). |

### Canonical types

```ts
type Position = { line: number; character: number };  // 0-based, UTF-16 code units
type Range    = { start: Position; end: Position };
type Uri      = string;                                 // `oxp://workspace/<rel-path>`
type Disposable = { dispose(): void };
```

### `when` clause grammar (v1 subset)

Boolean expression over a fixed set of context keys, with operators
`!`, `&&`, `||`, `==`, `!=`, parentheses. No regex, no `in`, no `=~`.

Context keys hosts must expose:

- `editorFocus` (boolean)
- `editorLangId` (string)
- `resourceExtname` (string, e.g. `.ts`)
- `viewItem` (string — the `TreeNode.contextValue`)
- `view` (string — the active view id)
- `oxp.<extensionId>.<custom>` — extension-set keys via `ctx.context.set(key, value)`.

## Module shape

Authors export a single `activate(ctx)` (and optional `deactivate()`)
as an **ESM module**:

```ts
import type { OxpContext } from "@oxprotocol/sdk";

export function activate(ctx: OxpContext): void | Promise<void> {
  // register contribution points here
}

export function deactivate(): void | Promise<void> {
  // optional; host kills after 5000ms if it hasn't resolved
}
```

`OxpContext` is the only IDE-touching surface. It is constructed by the
host adapter; authors never import from `vscode`, IntelliJ Platform, or
`vim.api`. The CLI's transpiler rejects any bundle that imports a
host-specific module.

## v1 contribution points

### `ctx.commands` — Commands

```ts
ctx.commands.register(id: string, handler: (args?: unknown) => unknown | Promise<unknown>): Disposable
ctx.commands.execute(id: string, args?: unknown): Promise<unknown>
```

- Maps to: `vscode.commands.registerCommand` / `AnAction` /
  `nvim_create_user_command` / Zed action.
- Manifest: `contributes.commands: [{ id, title, category? }]`.

### `ctx.menus` — Menu / palette items

```ts
ctx.menus.add({
  commandId: string;
  location: "command-palette" | "editor-context" | "explorer-context" | "status-bar-right";
  when?: string;       // simple CEL-style boolean expr; subset of VS Code's `when`
  group?: string;      // navigation | 1_modify | …
}): Disposable
```

- Intersection: command palette + editor/explorer right-click + status bar
  are universally available. Title-bar menus and gutter actions are not
  (Neovim has no title bar) → excluded from v1.

### `ctx.keybindings` — Keybindings

```ts
ctx.keybindings.bind({
  commandId: string;
  key: string;          // "ctrl+shift+o" (normalized; host maps ctrl↔cmd on macOS)
  when?: string;
}): Disposable
```

- Author writes one keybinding; host normalizes per-OS modifier.

### `ctx.statusBar` — Status bar items

```ts
const item = ctx.statusBar.create({
  alignment: "left" | "right";
  priority?: number;
});
item.text = "...";              // plain text + supported icon syntax `$(name)`
item.tooltip = "...";
item.commandId = "ext.myCmd";   // click target
item.show(); item.hide();
item.dispose();
```

- All four IDEs have a status bar (vim's statusline, JetBrains status bar,
  VS Code status bar, Zed status bar).

### `ctx.tree` — Tree views (the universal side-panel surface)

```ts
ctx.tree.register({
  viewId: string;
  provider: {
    getChildren(parent?: TreeNode): TreeNode[] | Promise<TreeNode[]>;
    onDidChange?: EventEmitter<TreeNode | undefined>;
  };
}): Disposable

type TreeNode = {
  id: string;
  label: string;
  description?: string;
  icon?: string;             // codicon-like name; host maps to native icon
  collapsibleState?: "none" | "collapsed" | "expanded";
  commandId?: string;        // executed on select
  contextValue?: string;     // for menu `when` clauses
};
```

- Maps to: VS Code TreeView, JetBrains ToolWindow tree, Neovim quickfix or
  custom buffer, Zed panel. This is the **primary structured UI surface**
  for community extensions — replaces "build a webview from scratch."

### `ctx.window` — Notifications & prompts

```ts
ctx.window.showMessage(text: string, level?: "info" | "warn" | "error"): void
ctx.window.showQuickPick<T>(items: QuickPickItem<T>[], opts?: { placeholder?: string }): Promise<T | undefined>
ctx.window.showInputBox(opts: { prompt?: string; value?: string; password?: boolean }): Promise<string | undefined>
ctx.window.showProgress<T>(opts: { title: string }, task: (progress: Progress) => Promise<T>): Promise<T>
```

- Universal across all four IDEs.

### `ctx.workspace` — Workspace file access (permission: `workspace.read` / `workspace.write`)

```ts
ctx.workspace.folders(): WorkspaceFolder[]
ctx.workspace.fs.readFile(uri: string): Promise<Uint8Array>
ctx.workspace.fs.writeFile(uri: string, content: Uint8Array): Promise<void>
ctx.workspace.fs.stat(uri: string): Promise<FileStat>
ctx.workspace.fs.readDirectory(uri: string): Promise<[name: string, type: FileType][]>
ctx.workspace.fs.createDirectory(uri: string): Promise<void>
ctx.workspace.fs.delete(uri: string, opts?: { recursive?: boolean }): Promise<void>
ctx.workspace.onDidChangeFiles(handler: (ev: FileChangeEvent) => void): Disposable
```

- All paths are workspace-relative URIs (`oxp://workspace/...`). The host
  enforces that the extension cannot escape the workspace root.
- Manifest declares: `permissions: { workspace: { read: ["**/*.ts"], write: ["./out/**"] } }`.

### `ctx.editor` — Active editor (permission: `editor.read` / `editor.write`)

```ts
ctx.editor.active(): ActiveEditor | undefined
ctx.editor.onDidChange(handler: (editor: ActiveEditor | undefined) => void): Disposable

type ActiveEditor = {
  document: { uri: string; languageId: string; getText(range?: Range): string };
  selection: Range;
  edit(builder: (eb: EditBuilder) => void): Promise<boolean>;
};
```

- Universal. The shape is deliberately a subset of VS Code's API to keep
  Neovim/JetBrains adapters tractable.

### `ctx.terminal` — Terminals (permission: `terminal.spawn`)

```ts
ctx.terminal.create(opts: { name: string; cwd?: string; env?: Record<string,string> }): Terminal
terminal.sendText(text: string): void
terminal.show(): void
terminal.dispose(): void
```

- VS Code: `window.createTerminal`. JetBrains: terminal tool window. Neovim:
  `:terminal`. Zed: terminal. All four supported.

### `ctx.languages` — Language providers (permission: `languages.providers`)

```ts
ctx.languages.registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): Disposable
ctx.languages.registerCompletionProvider(selector, provider, triggers?: string[]): Disposable
ctx.languages.registerDefinitionProvider(selector, provider): Disposable
ctx.languages.registerDiagnostics(collection: string): DiagnosticCollection
```

- These four cover the intersection of LSP-style providers all four IDEs
  expose without a full LSP server. Heavier providers (formatters, code
  actions, refactorings) come in v1.x once adapters stabilize.

### `ctx.network` — Outbound HTTP (permission: `network.fetch`)

```ts
ctx.network.fetch(input: string | Request, init?: RequestInit): Promise<Response>
```

- Standard `fetch` semantics. Manifest restricts to allow-listed origins:
  `permissions: { network: { fetch: ["https://api.linear.app"] } }`.
- Host enforces origin allow-list at runtime; bundle has no other network.

### `ctx.secrets` — Secret storage

```ts
ctx.secrets.get(key: string): Promise<string | undefined>
ctx.secrets.set(key: string, value: string): Promise<void>
ctx.secrets.delete(key: string): Promise<void>
```

- Maps to: VS Code `SecretStorage`, JetBrains `PasswordSafe`, Neovim
  process keychain (libsecret/keychain), Zed secret store.

### `ctx.state` — Per-extension persistent state

```ts
ctx.state.workspace: KeyValueStore  // scoped to current workspace
ctx.state.global: KeyValueStore     // scoped to user
```

- Plain JSON KV. Hosts back with their own per-extension storage dir.

### `ctx.webview` — Webview panel (one contribution point among many)

```ts
const panel = ctx.webview.createPanel({
  id: string;
  title: string;
  surface?: "tab" | "side" | "modal";  // host picks the closest native equivalent
  retainOnHide?: boolean;
});
panel.setHtml(html: string): void
panel.postMessage(msg: unknown): void
panel.onMessage(handler: (msg: unknown) => void): Disposable
panel.onDidClose(handler: () => void): Disposable
```

- Available on VS Code/Cursor/Zed (Electron-based webview). On JetBrains
  maps to JCEF tool window. On Neovim falls back to a structured `tree` +
  status bar combination, OR a browser-hosted panel via the OXP web UI
  (last-resort fallback). **Authors should prefer `tree` / `statusBar` /
  `editor` over `webview` for portability.**

### `ctx.events` — Lifecycle

```ts
ctx.events.onActivate(handler: () => void): Disposable
ctx.events.onDeactivate(handler: () => void): Disposable
ctx.events.onWorkspaceChange(handler: () => void): Disposable
```

## Manifest schema additions (`oxp.json` v1)

```jsonc
{
  "id": "@user/my-ext",
  "version": "0.1.0",
  "main": { "entry": "dist/index.js" },
  "contributes": {
    "commands": [{ "id": "myext.greet", "title": "Greet User" }],
    "menus": [{ "commandId": "myext.greet", "location": "command-palette" }],
    "keybindings": [{ "commandId": "myext.greet", "key": "ctrl+shift+g" }],
    "views": [{ "id": "myext.explorer", "name": "My Tree", "icon": "list-tree" }],
    "statusBar": [{ "id": "myext.status", "alignment": "right", "priority": 100 }]
  },
  "permissions": {
    "workspace": { "read": ["**/*.ts"], "write": [] },
    "editor":    { "read": true, "write": false },
    "terminal":  { "spawn": false },
    "network":   { "fetch": ["https://api.example.com"] }
  }
}
```

## What is explicitly OUT of v1

- Debug adapters (host APIs diverge too much).
- Custom editors / notebook renderers (VS Code-only concept).
- Tasks / build providers (JetBrains has its own Run/Debug, VS Code has
  tasks.json, Neovim has none — no intersection).
- SCM providers (each IDE has very different Git UX).
- Welcome pages, walkthroughs, settings UI customization.

These are candidates for v1.x or v2, *not* v1.

## Adapter responsibilities

Each `hosts/<ide>/runtime/` must:

1. Construct an `OxpContext` and pass it to the bundle's `activate()`.
2. Implement every method in this doc against the host's native API.
3. Enforce permissions from `oxp.json` — deny + prompt on first use.
4. Translate the bundle's contribution declarations into the host's
   native registration (e.g. write VS Code `package.json` contributes,
   write JetBrains `plugin.xml`, write Neovim `:autocmd` boilerplate).
5. Pass the **conformance suite** in `tests/v1-conformance/` — one OXP
   extension exercising every API, running identically on every adapter.

## Sign-off

- [x] Project lead reviewed and locked all contribution points (10 May 2026).
- [x] Decisions 1–5 resolved inline (see *Locked decisions* above).
- [x] Conformance skeleton lives at [`tests/v1-conformance/`](../../tests/v1-conformance/).

This file is frozen. Changes require a new minor (additive) or major (v2)
revision and full adapter re-test.
