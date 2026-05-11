# OXP v1 Conformance Suite

A single OXP extension that exercises every contribution point in
[`spec/v1/oxp-api.md`](../../spec/v1/oxp-api.md). Every host adapter
(`hosts/vscode`, `hosts/jetbrains`, `hosts/neovim`, `hosts/piye`) MUST
load this extension and pass every assertion before shipping.

## Layout

```
tests/v1-conformance/
  extension/        # the OXP extension under test (source)
    oxp.json
    src/index.ts
  scenarios/        # per-capability assertions (host-driven)
    commands.json
    menus.json
    keybindings.json
    statusBar.json
    tree.json
    window.json
    workspace.json
    editor.json
    terminal.json
    languages.json
    network.json
    secrets.json
    state.json
    webview.json
    lifecycle.json
  runner/           # `pnpm test` entry — drives each host via its harness
```

## Running locally

```bash
# All hosts
pnpm -C tests/v1-conformance test

# Single host
pnpm -C tests/v1-conformance test --host vscode
pnpm -C tests/v1-conformance test --host jetbrains
pnpm -C tests/v1-conformance test --host neovim
pnpm -C tests/v1-conformance test --host piye
```

Each host harness:

1. Builds the extension via `oxp pack`.
2. Boots the host in a temp workspace.
3. Replays each scenario file as a sequence of `(action, expectation)`
   pairs through the host's automation surface.
4. Emits a JUnit report at `reports/<host>.xml`.

## Adding a new contribution point

1. Update the spec in `spec/v1/oxp-api.md` (v1.x additive only).
2. Exercise it from `extension/src/index.ts`.
3. Add a scenarios file describing the expected user-visible behaviour.
4. Implement in every `hosts/*/runtime/` and re-run the suite.

The CI gate blocks publishing any host adapter whose conformance score is
not 100% green against the latest locked spec.
