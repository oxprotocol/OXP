import { organizations, users } from "./owners";
import type { Extension, ExtensionAlias, Version, AccountKind } from "./types";

function ownerLookup(handle: string): {
  ownerId: string;
  ownerKind: AccountKind;
} {
  const org = organizations.find((o) => o.handle === handle);
  if (org) return { ownerId: org.id, ownerKind: "org" };
  const user = users.find((u) => u.handle === handle);
  if (user) return { ownerId: user.id, ownerKind: "user" };
  throw new Error(`Unknown owner handle in extensions seed: ${handle}`);
}

interface ExtensionSeed {
  ownerHandle: string;
  slug: string;
  legacyId: string; // old flat id
  title: string;
  description: string;
  visibility?: "public" | "private";
  tags: string[];
  latestVersion: string;
  downloads: string;
  stars: number;
  repositoryUrl?: string;
  versions: Array<Omit<Version, "id" | "extensionId" | "signedByUserId">>;
}

// All hardcoded "planned" demo extensions removed (Jupyter, Claude AI,
// Tailwind, GitLens, Aurora, Python LSP, React DevTools, MCP Connector,
// Piye Deploy). The directory is now powered by the database (real
// publishes via /new + the publish flow) and the Open VSX importer
// (`scripts/import-openvsx.mjs`). To re-seed mock data for local UI
// development, restore entries from git history.
const seed: ExtensionSeed[] = [];

// ─── Materialize ──────────────────────────────────────────────────────────────
export const extensions: Extension[] = seed.map((s) => {
  const { ownerId, ownerKind } = ownerLookup(s.ownerHandle);
  return {
    id: `ext_${s.ownerHandle}_${s.slug}`,
    ownerHandle: s.ownerHandle,
    ownerKind,
    ownerId,
    slug: s.slug,
    title: s.title,
    description: s.description,
    visibility: s.visibility ?? "public",
    status: "active",
    tags: s.tags,
    repositoryUrl: s.repositoryUrl,
    latestVersion: s.latestVersion,
    downloads: s.downloads,
    stars: s.stars,
    readme: undefined,
  };
});

export const versions: Version[] = seed.flatMap((s) => {
  const ext = extensions.find(
    (e) => e.ownerHandle === s.ownerHandle && e.slug === s.slug,
  )!;
  // pick a deterministic signer: org owner if present, else first user
  const signer = ext.ownerKind === "org" ? "usr_sayedmibra" : ext.ownerId;
  return s.versions.map<Version>((v, i) => ({
    id: `ver_${ext.id}_${i}`,
    extensionId: ext.id,
    signedByUserId: signer,
    ...v,
  }));
});

export const extensionAliases: ExtensionAlias[] = seed
  .filter((s) => s.legacyId !== `${s.ownerHandle}/${s.slug}`)
  .map((s) => ({
    alias: s.legacyId,
    ownerHandle: s.ownerHandle,
    slug: s.slug,
  }));
