# OXP

> **🔒 Security lock active.** All non-security feature work is paused until Phase A + B + C of [`ROADMAP-SECURITY.md`](./ROADMAP-SECURITY.md) are complete. See [`SECURITY.md`](./SECURITY.md) for current threat model and posture, and [`ROADMAP-FEATURES.md`](./ROADMAP-FEATURES.md) for the bookmark of paused feature work.

One extension binary, every editor. No accounts, no logins, no settings to edit.

---

## For users — install and run an extension

Two commands, total. The second one prompts you once to approve permissions; everything else is automatic.

```sh
# 1. One-line install (works on macOS / Linux / WSL).
curl -fsSL https://oxp.sh/install | sh

# 2. Install any extension. The CLI auto-installs the host plugin into
#    every IDE it detects (VS Code, Cursor, Windsurf, VSCodium, IntelliJ
#    family, Neovim), downloads the extension, asks once for permissions,
#    then opens the extension UI in every running IDE window.
oxp install @aldgar/git-panel
```

Alternative installers:

```sh
npm  install -g @oxprotocol/cli      # if you already have Node ≥ 20
brew install oxprotocol/tap/oxp      # once the Homebrew tap is live
```

Want to install the IDE plugin yourself instead of letting the CLI do it? Search **OXP** in your IDE's marketplace — VS Code Marketplace, Open VSX, or JetBrains Marketplace.

**That is the entire user workflow.** No browser tab, no account, no API key, no config file. The only prompt you'll ever see is the one-time permission consent for each extension — required by the security model, never skippable except via `--yes` for trusted-publisher allowlists.

---

## For extension authors

→ [`QUICKSTART.md`](./QUICKSTART.md) — build a `.wasm` extension once, run it in VS Code _and_ JetBrains in 10 minutes.

## For OXP maintainers — publishing to marketplaces

→ [`MARKETPLACE-PUBLISHING.md`](./MARKETPLACE-PUBLISHING.md) — tag-triggered CI publishes the CLI, the VS Code extension (to Marketplace + Open VSX), and the JetBrains plugin in one shot.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
