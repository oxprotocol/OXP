/**
 * Members admin panel. Available to all plans (no SOON pill).
 *   - Owners/admins see invite form, role buttons, remove buttons,
 *     and pending invite list with revoke action.
 *   - Contributors/readers see a read-only roster.
 */
import Link from "next/link";
import { loadOrgMemberContext, OrgAuthError } from "@/lib/org-auth";
import { listOrgMembers, listOrgInvites } from "@/lib/orgs";
import { redirect } from "next/navigation";
import { MembersPanel } from "./MembersPanel";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ handle: string }>;
}

export default async function OrgMembersPage({ params }: Props) {
  const { handle } = await params;
  let ctx;
  try {
    ctx = await loadOrgMemberContext(handle);
  } catch (e) {
    const err = e as OrgAuthError;
    if (err.status === 401)
      redirect(`/signin?next=/org/${handle}/admin/members`);
    redirect(`/`);
  }
  const canManage =
    ctx.membership.role === "owner" || ctx.membership.role === "admin";
  const isOwner = ctx.membership.role === "owner";
  const [members, invites] = await Promise.all([
    listOrgMembers(ctx.org.id),
    canManage ? listOrgInvites(ctx.org.id) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16 font-mono text-sky-200">
      <Link
        href={`/org/${handle}/admin`}
        className="text-[10px] tracking-[0.2em] uppercase text-sky-300/50 hover:text-sky-200"
      >
        ← Admin
      </Link>
      <h1 className="text-2xl tracking-[0.18em] uppercase mt-3 mb-2">
        @{ctx.org.handle} / members
      </h1>
      <p className="text-sm text-sky-300/60 mb-8">
        {members.length} member{members.length === 1 ? "" : "s"}
        {canManage && invites.length > 0
          ? ` · ${invites.length} pending invite${invites.length === 1 ? "" : "s"}`
          : null}
      </p>

      <MembersPanel
        orgHandle={ctx.org.handle}
        meUserId={ctx.user.id}
        canManage={canManage}
        isOwner={isOwner}
        initialMembers={members}
        initialInvites={invites.map((i) => ({
          ...i,
          expiresAt: i.expiresAt.toISOString(),
          createdAt: i.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
