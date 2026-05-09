# Marketplace publishing checklist

This document is the single playbook for shipping the OXP host adapters to
their respective marketplaces so that `oxp install <id>` becomes a one-step
experience for end users.

> **Why this matters.** The CLI already detects every supported IDE and
> calls `<ide> --install-extension <adapter-id>` for the VS Code family
> (see `packages/cli/src/lib/host-adapter.ts`). The only thing standing
> between us and zero-touch installs is the publish step for each
> marketplace. Once the adapters are live, flip the
> `ADAPTER_PUBLISHED`/`JETBRAINS_ADAPTER_PUBLISHED` constants in
> `host-adapter.ts` to `true` and the CLI will start auto-installing
> them.

---

## 1. VS Code Marketplace + Open VSX (covers VS Code, Cursor, Windsurf, VSCodium, Insiders)

**Adapter source:** `hosts/vscode/`
**Marketplace id (canonical):** `oxprotocol.oxp-vscode`

### Prerequisites (one-time)

- [ ] **Microsoft account** registered on <https://marketplace.visualstudio.com/manage>
- [ ] **Azure DevOps organisation** created (any name; only used to mint the PAT)
- [ ] **Personal Access Token** scoped `Marketplace > Manage` — store as `VSCE_PAT`
- [ ] **Publisher** `oxprotocol` claimed on Microsoft Marketplace
      ```
      npx @vscode/vsce create-publisher oxprotocol
      ```
- [ ] **Open VSX** account (eclipse.org SSO) at <https://open-vsx.org/user-settings/tokens>
- [ ] **OVSX token** with `publish` scope — store as `OVSX_PAT`
- [ ] **Publisher** `oxprotocol` claimed on Open VSX (the agent script reuses the same name)

### Publish script

```bash
cd hosts/vscode
pnpm build                      # produces dist/
npx @vscode/vsce package        # produces oxp-vscode-<ver>.vsix
npx @vscode/vsce publish -p "$VSCE_PAT"
npx ovsx publish -p "$OVSX_PAT" oxp-vscode-*.vsix
```

### After first successful publish

- [ ] Flip `ADAPTER_PUBLISHED = true` in `packages/cli/src/lib/host-adapter.ts`
- [ ] `pnpm --filter @oxprotocol/cli build`
- [ ] Bump CLI patch version, republish to npm
- [ ] Smoke-test with `oxp doctor` on a clean machine (no adapter
      installed) — `oxp install <id>` should auto-install the VSIX.

---

## 2. JetBrains Marketplace (covers IntelliJ, WebStorm, PyCharm, GoLand, RustRover, CLion, Rider, DataGrip, RubyMine, PhpStorm)

**Adapter source:** `hosts/jetbrains/`
**Marketplace id (canonical):** `sh.oxp.jetbrains`

### Prerequisites (one-time)

- [ ] **JetBrains Hub** account at <https://hub.jetbrains.com>
- [ ] **Vendor** `oxp.sh` registered at <https://plugins.jetbrains.com/author/me>
- [ ] **Plugin** `sh.oxp.jetbrains` reserved on the vendor page
- [ ] **Hub permanent token** scoped `Marketplace` — store as `JETBRAINS_PAT`
- [ ] `gradle.properties` has matching `pluginGroup=sh.oxp.jetbrains`
      and `pluginVersion` synchronised with CLI version

### Publish script

```bash
cd hosts/jetbrains
./gradlew buildPlugin            # produces build/distributions/oxp-*.zip
./gradlew publishPlugin -PintellijPublishToken="$JETBRAINS_PAT"
```

### After first successful publish

- [ ] Flip `JETBRAINS_ADAPTER_PUBLISHED = true` in `host-adapter.ts`
- [ ] Document the manual install path in case auto-install ever fails:
      Settings → Plugins → Marketplace → search "OXP"
- [ ] Update `apps/web/app/marketplace/page.tsx` callout

> **Note.** JetBrains has no stable `--install-plugin` CLI flag, so the
> CLI cannot silently install the plugin the way it does for VSIX. The
> doctor command reports the install snippet, and once the plugin is on
> the marketplace JetBrains' own auto-update channel handles upgrades.

---

## 3. Neovim (community-distributed via plugin manager)

**Adapter source:** `hosts/neovim/`
**Repository slug (canonical):** `oxprotocol/oxp.nvim`

Neovim has no central marketplace — distribution is via public git repo
plus a plugin manager (`lazy.nvim`, `packer.nvim`, `vim-plug`).

### Prerequisites (one-time)

- [ ] **GitHub repository** `oxprotocol/oxp.nvim` created (public)
- [ ] **README** with copy-paste install snippets for the three managers
- [ ] **CI** runs `:checkhealth` on Linux + macOS Neovim 0.10+
- [ ] **Tag** `v0.1.0` pushed once the adapter API is stable

### Release script

```bash
cd hosts/neovim
git tag v0.1.0
git push origin main --tags
```

### Install snippet for end users

```lua
-- lazy.nvim
{ "oxprotocol/oxp.nvim", opts = {} }

-- packer.nvim
use { "oxprotocol/oxp.nvim", config = function() require("oxp").setup() end }

-- vim-plug
Plug 'oxprotocol/oxp.nvim'
```

After release, the doctor command's `unavailable` reason already points
at this exact snippet.

---

## 4. CLI distribution (npm)

The CLI wraps everything above; once the adapters are published,
end-users install with one command:

```bash
npm i -g @oxprotocol/cli
oxp install @publisher/slug
```

### Prerequisites (one-time)

- [ ] **npm account** with 2FA enabled
- [ ] **Org** `@oxprotocol` created on npmjs.com
- [ ] `npm whoami` returns the publishing account
- [ ] Each package's `publishConfig.access` is `"public"` (verified)

### Publish order (must respect dep graph)

```bash
# 1. Leaf packages (no internal deps)
pnpm --filter @oxprotocol/types     publish --access public
pnpm --filter @oxprotocol/wit       publish --access public

# 2. Schema (depends on types)
pnpm --filter @oxprotocol/schema    publish --access public

# 3. Bundle helpers (depend on types + schema)
pnpm --filter @oxprotocol/bundle    publish --access public

# 4. Host primitives (depend on types + bundle)
pnpm --filter @oxprotocol/host-core publish --access public

# 5. CLI (depends on everything)
pnpm --filter @oxprotocol/cli       publish --access public
```

### Smoke test on a clean machine

```bash
npm i -g @oxprotocol/cli
oxp doctor                          # reports detected IDEs + adapter status
oxp create my-ext                   # scaffolds a starter
cd my-ext && oxp pack && oxp publish --dry-run
```

---

## 5. Runtime binary (`@oxprotocol/runtime`)

The CLI needs the `oxp-runtime` Wasmtime binary to verify and execute
extensions. Today it's read from `OXP_RUNTIME` or built locally with
cargo. To ship to end users we wrap it in a platform-fanned npm package.

### One-time setup

- [ ] Cross-compile `runtime/` for `darwin-arm64`, `darwin-x64`,
      `linux-x64`, `linux-arm64`, `win32-x64`
- [ ] Publish each binary as its own optional dependency:
      - `@oxprotocol/runtime-darwin-arm64`
      - `@oxprotocol/runtime-darwin-x64`
      - `@oxprotocol/runtime-linux-x64`
      - `@oxprotocol/runtime-linux-arm64`
      - `@oxprotocol/runtime-win32-x64`
- [ ] Publish meta-package `@oxprotocol/runtime` with all five as
      `optionalDependencies` (npm picks the right one per platform)
- [ ] CLI postinstall resolves `require("@oxprotocol/runtime")` and
      stores the absolute path

### Release flow (per version)

```bash
cd runtime
./scripts/release-all-platforms.sh   # builds + publishes 5 binaries
npm publish @oxprotocol/runtime
```

---

## Status snapshot

Run `oxp doctor` at any time to see which marketplaces are live from the
CLI's perspective. The doctor reports per-host adapter status; once
every entry shows `adapter ✓` after `oxp install`, we're done.

| Marketplace            | Status      | Tracking flag |
| ---------------------- | ----------- | ------------- |
| VS Code Marketplace    | not yet     | `ADAPTER_PUBLISHED` |
| Open VSX               | not yet     | `ADAPTER_PUBLISHED` |
| JetBrains Marketplace  | not yet     | `JETBRAINS_ADAPTER_PUBLISHED` |
| Neovim (GitHub)        | not yet     | (always available once tagged) |
| npm @oxprotocol/cli    | not yet     | (manual smoke test) |
| npm @oxprotocol/runtime| not yet     | (manual smoke test) |
