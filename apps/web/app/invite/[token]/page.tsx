/**
 * Invite landing page. Resolves the token, requires sign-in (with email
 * matching the invite), and POSTs to /api/invites/[token]/accept on click.
 */
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { AcceptForm } from "./AcceptForm";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invite = await prisma.orgInvite.findUnique({ where: { tokenHash } });

  if (!invite) {
    return (
      <Wrapper title="Invite not found">
        <p className="text-sm text-sky-300/60">
          This invitation link is invalid or has been revoked. Ask the inviter
          to send a new one.
        </p>
      </Wrapper>
    );
  }
  if (invite.acceptedAt) {
    return (
      <Wrapper title="Already used">
        <p className="text-sm text-sky-300/60">
          This invitation has already been redeemed.
        </p>
      </Wrapper>
    );
  }
  if (invite.revokedAt) {
    return (
      <Wrapper title="Invite revoked">
        <p className="text-sm text-sky-300/60">
          The org admin revoked this invitation.
        </p>
      </Wrapper>
    );
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return (
      <Wrapper title="Invite expired">
        <p className="text-sm text-sky-300/60">
          This invitation expired on {invite.expiresAt.toLocaleString()}. Ask
          for a fresh one.
        </p>
      </Wrapper>
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: invite.orgId },
    select: { handle: true, displayName: true },
  });
  if (!org) {
    return (
      <Wrapper title="Org not found">
        <p className="text-sm text-sky-300/60">
          The organization that issued this invitation no longer exists.
        </p>
      </Wrapper>
    );
  }

  const me = await getCurrentUser();
  if (!me) {
    redirect(`/signin?next=/invite/${encodeURIComponent(token)}`);
  }

  const emailMatches = me.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <Wrapper title={`Join @${org.handle}`}>
      <p className="text-sm text-sky-300/70 mb-2">
        You&apos;ve been invited to join{" "}
        <span className="text-sky-100">{org.displayName}</span> (
        <span className="text-sky-100">@{org.handle}</span>) as{" "}
        <span className="text-sky-100">{invite.role}</span>.
      </p>
      <p className="text-xs text-sky-300/50 mb-6">
        Invitation sent to <span className="text-sky-100">{invite.email}</span>.
        Expires {invite.expiresAt.toLocaleString()}.
      </p>
      {emailMatches ? (
        <AcceptForm token={token} orgHandle={org.handle} />
      ) : (
        <div className="text-sm text-amber-200 border border-amber-400/30 bg-amber-500/5 px-4 py-3">
          This invite is for <span className="font-mono">{invite.email}</span>,
          but you&apos;re signed in as{" "}
          <span className="font-mono">{me.email}</span>. Sign out and sign back
          in with the right account to accept.
        </div>
      )}
    </Wrapper>
  );
}

function Wrapper({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-20 font-mono text-sky-200">
      <h1 className="text-2xl tracking-[0.18em] uppercase mb-6">{title}</h1>
      <div className="hud-card px-6 py-6">{children}</div>
    </main>
  );
}
