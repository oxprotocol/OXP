/**
 * Mock "repository" file system for an extension.
 *
 * Every Extension in `lib/extensions.ts` implicitly owns a repo at
 * `/<handle>/<slug>`. The browser surface needs a file tree to render, but the
 * real artifacts live in the content-addressed `~/.oxp/store/` once the CLI
 * ships. Until then this module fabricates a small, consistent layout so the
 * UI has something to walk.
 *
 * Layout per repo (intentionally narrower than GitHub):
 *
 *   oxp.json
 *   README.md
 *   LICENSE
 *   .oxpignore
 *   body/        UI bundle (what renders inside the IDE)
 *     index.tsx
 *     Panel.tsx
 *   brain/       background logic (talks MCP)
 *     index.ts
 *   adapters/    optional per-IDE shims
 *     vscode.ts
 *
 * No node_modules, no CI configs, no PR templates — by design.
 */

import { extensions } from "./extensions";
import type { Extension } from "./types";

export type RepoEntryKind = "file" | "dir";

export interface RepoEntry {
  name: string;
  path: string; // posix path relative to repo root, no leading slash
  kind: RepoEntryKind;
  size?: number; // bytes, files only
}

export interface RepoFile extends RepoEntry {
  kind: "file";
  language: string; // for syntax hinting in the viewer
  content: string;
}

export interface RepoTree {
  ownerHandle: string;
  slug: string;
  /** Flat listing of every entry across the repo. */
  entries: RepoEntry[];
  defaultBranch: string;
  lastCommit: {
    sha: string;
    message: string;
    author: string;
    at: string;
  };
}

// ─── Templating ─────────────────────────────────────────────────────────────

function manifest(ext: Extension): string {
  return JSON.stringify(
    {
      id: `@${ext.ownerHandle}/${ext.slug}`,
      name: ext.title,
      version: ext.latestVersion,
      visibility: ext.visibility,
      description: ext.description,
      entry: {
        body: "body/index.tsx",
        brain: "brain/index.ts",
      },
      permissions: ["read:workspace", "read:active-file"],
      targets: {
        oxp: { native: true },
        vscode: { shim: true },
      },
      tags: ext.tags,
    },
    null,
    2,
  );
}

function readme(ext: Extension): string {
  return `# ${ext.title}

> ${ext.description}

## Install

\`\`\`
oxp install @${ext.ownerHandle}/${ext.slug}
\`\`\`

## Develop

\`\`\`
oxp clone @${ext.ownerHandle}/${ext.slug}
cd ${ext.slug}
pnpm dev
\`\`\`

## License

MIT
`;
}

function license(): string {
  return `MIT License

Copyright (c) ${new Date().getUTCFullYear()} the OXP authors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
`;
}

const oxpignore = `# Local build artifacts
dist/
*.tsbuildinfo
.oxp-cache/

# Editor noise
.DS_Store
.vscode/
`;

function bodyIndex(ext: Extension): string {
  return `import { registerPanel } from "@oxprotocol/runtime";
import { Panel } from "./Panel";

registerPanel({
  id: "@${ext.ownerHandle}/${ext.slug}",
  title: "${ext.title}",
  render: () => <Panel />,
});
`;
}

function bodyPanel(ext: Extension): string {
  return `import { useWorkspace } from "@oxprotocol/hooks";

export function Panel() {
  const ws = useWorkspace();

  return (
    <div className="p-4">
      <h1 className="text-lg font-bold">${ext.title}</h1>
      <p className="text-sm opacity-60">{ws.activeFile?.path ?? "no file"}</p>
    </div>
  );
}
`;
}

function brainIndex(ext: Extension): string {
  return `import { defineBrain } from "@oxprotocol/brain";

export default defineBrain({
  id: "@${ext.ownerHandle}/${ext.slug}",
  tools: {
    /** Example MCP-style tool exposed to the host IDE. */
    ping: async () => ({ ok: true, at: Date.now() }),
  },
});
`;
}

const adapterVscode = `import type { OxpAdapter } from "@oxprotocol/adapters";

/** VS Code legacy shim. Optional — only present for extensions that need it. */
export const vscode: OxpAdapter = {
  activate: (host) => host.registerCommand("noop", () => undefined),
};
`;

// ─── Tree assembly ───────────────────────────────────────────────────────────

function fileSize(content: string): number {
  return new TextEncoder().encode(content).length;
}

function buildFiles(ext: Extension): RepoFile[] {
  const files: RepoFile[] = [
    {
      name: "oxp.json",
      path: "oxp.json",
      kind: "file",
      language: "json",
      content: manifest(ext),
      size: 0,
    },
    {
      name: "README.md",
      path: "README.md",
      kind: "file",
      language: "markdown",
      content: readme(ext),
      size: 0,
    },
    {
      name: "LICENSE",
      path: "LICENSE",
      kind: "file",
      language: "text",
      content: license(),
      size: 0,
    },
    {
      name: ".oxpignore",
      path: ".oxpignore",
      kind: "file",
      language: "text",
      content: oxpignore,
      size: 0,
    },
    {
      name: "index.tsx",
      path: "body/index.tsx",
      kind: "file",
      language: "tsx",
      content: bodyIndex(ext),
      size: 0,
    },
    {
      name: "Panel.tsx",
      path: "body/Panel.tsx",
      kind: "file",
      language: "tsx",
      content: bodyPanel(ext),
      size: 0,
    },
    {
      name: "index.ts",
      path: "brain/index.ts",
      kind: "file",
      language: "ts",
      content: brainIndex(ext),
      size: 0,
    },
    {
      name: "vscode.ts",
      path: "adapters/vscode.ts",
      kind: "file",
      language: "ts",
      content: adapterVscode,
      size: 0,
    },
  ];
  return files.map((f) => ({ ...f, size: fileSize(f.content) }));
}

const treeCache = new Map<string, { tree: RepoTree; files: RepoFile[] }>();

function ensureTree(ext: Extension): { tree: RepoTree; files: RepoFile[] } {
  const key = `${ext.ownerHandle}/${ext.slug}`;
  const cached = treeCache.get(key);
  if (cached) return cached;

  const files = buildFiles(ext);
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    parts.pop();
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      dirs.add(acc);
    }
  }
  const dirEntries: RepoEntry[] = Array.from(dirs).map((d) => ({
    name: d.split("/").pop()!,
    path: d,
    kind: "dir",
  }));

  const tree: RepoTree = {
    ownerHandle: ext.ownerHandle,
    slug: ext.slug,
    defaultBranch: "main",
    entries: [...dirEntries, ...files.map(({ content: _c, ...meta }) => meta)],
    lastCommit: {
      sha: `${ext.id.slice(-7)}deadbe`.slice(0, 7),
      message: `chore: release v${ext.latestVersion}`,
      author: ext.ownerHandle,
      at: "2026-04-29T10:14:00Z",
    },
  };

  const slot = { tree, files };
  treeCache.set(key, slot);
  return slot;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getRepoTree(
  ownerHandle: string,
  slug: string,
): RepoTree | undefined {
  const ext = extensions.find(
    (e) => e.ownerHandle === ownerHandle && e.slug === slug,
  );
  if (!ext) return undefined;
  return ensureTree(ext).tree;
}

/** List entries directly under `dirPath` (use "" for the repo root). */
export function listRepoDirectory(
  ownerHandle: string,
  slug: string,
  dirPath: string,
): RepoEntry[] {
  const tree = getRepoTree(ownerHandle, slug);
  if (!tree) return [];
  const prefix = dirPath ? `${dirPath}/` : "";
  return tree.entries
    .filter((e) => {
      if (!e.path.startsWith(prefix)) return false;
      const rest = e.path.slice(prefix.length);
      return rest.length > 0 && !rest.includes("/");
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function getRepoFile(
  ownerHandle: string,
  slug: string,
  filePath: string,
): RepoFile | undefined {
  const ext = extensions.find(
    (e) => e.ownerHandle === ownerHandle && e.slug === slug,
  );
  if (!ext) return undefined;
  return ensureTree(ext).files.find((f) => f.path === filePath);
}

export function isRepoDirectory(
  ownerHandle: string,
  slug: string,
  dirPath: string,
): boolean {
  if (dirPath === "") return true;
  const tree = getRepoTree(ownerHandle, slug);
  if (!tree) return false;
  return tree.entries.some((e) => e.kind === "dir" && e.path === dirPath);
}
