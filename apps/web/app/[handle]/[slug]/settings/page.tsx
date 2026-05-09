import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getExtension } from "@/lib/registry";
import { getExtensionDb } from "@/lib/registry-db";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  return { title: `@${handle}/${slug} · Settings` };
}

export default async function RepoSettingsPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  // Seed first, then DB so newly-published extensions show their settings page.
  const ext =
    getExtension(handle, slug) ??
    (await getExtensionDb(handle, slug).catch(() => null));
  if (!ext) notFound();

  const me = await getCurrentUser();
  if (!me) redirect(`/signin?next=/${handle}/${slug}/settings`);
  if (me.handle !== ext.ownerHandle) {
    return (
      <section className="app-container app-shell py-16">
        <div className="hud-card hud-corners p-10 text-center space-y-2">
          <h2 className="text-base font-bold text-[#f8fafc]">
            You don&apos;t own this extension.
          </h2>
          <p className="text-xs font-mono text-[#f8fafc]/40">
            Settings are visible only to the owner.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="app-container app-shell py-12">
      <SettingsForm
        ownerHandle={ext.ownerHandle}
        slug={ext.slug}
        visibility={ext.visibility}
        fullId={`${ext.ownerHandle}/${ext.slug}`}
      />
    </section>
  );
}
