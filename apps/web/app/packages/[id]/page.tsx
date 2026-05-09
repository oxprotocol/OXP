import { notFound, redirect } from "next/navigation";
import { resolveAlias, getExtension, extensions } from "@/lib/registry";
import { getExtensionDb } from "@/lib/registry-db";
import { extensionAliases } from "@/lib/extensions";

export function generateStaticParams() {
  const aliasParams = extensionAliases.map((a) => ({ id: a.alias }));
  const slugParams = extensions.map((e) => ({ id: e.slug }));
  const seen = new Set<string>();
  return [...aliasParams, ...slugParams].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export const metadata = { title: "Extension" };

export default async function LegacyPackageRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const alias = resolveAlias(id);
  if (alias) redirect(`/${alias.ownerHandle}/${alias.slug}`);

  const ext = extensions.find((e) => e.slug === id);
  if (ext) redirect(`/${ext.ownerHandle}/${ext.slug}`);

  if (id.startsWith("@")) {
    const [owner, slug] = id.slice(1).split("/");
    if (owner && slug) {
      // Seed registry first (in-memory mock), then DB (real published).
      if (getExtension(owner, slug)) {
        redirect(`/${owner}/${slug}`);
      }
      const dbExt = await getExtensionDb(owner, slug).catch(() => null);
      if (dbExt) redirect(`/${owner}/${slug}`);
    }
  }

  notFound();
}
