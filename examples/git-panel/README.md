# git-panel

A read-only git status panel for OXP. Shows the current branch, the last
five commits (parsed from the reflog), and a coarse activity summary.

- **Read-only** — never invokes `git`. Reads `.git/HEAD`,
  `.git/refs/heads/<branch>`, `.git/logs/HEAD`, and `.git/FETCH_HEAD`
  directly via the host `fs.read` capability.
- **Auto-refresh** — re-reads every 4 seconds; click ↻ for an immediate
  refresh.
- **Theme-aware** — uses VS Code/JetBrains theme variables with a quiet
  dark fallback.

## Develop

```sh
pnpm install
oxp dev
```

The `oxp dev` command builds `ui/index.html`, starts the EDH window, and
hot-reloads on save.

## Pack & publish

```sh
oxp pack
oxp publish
```

## Permissions

- `fs.read` — workspace-relative read access. Used to inspect `.git/`.

## Implementation notes

The reflog parser (`src/git-reader.ts`) anchors on the unix timestamp +
tab-message separator rather than splitting on whitespace, so author
names containing spaces parse correctly.

When the branch ref isn't on disk (packed repos), it falls back to
`.git/packed-refs`.
