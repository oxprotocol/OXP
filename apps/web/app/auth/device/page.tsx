/**
 * /auth/device — interactive approval page for the OXP CLI's device-flow login.
 *
 * The CLI prints a short user_code (e.g. ABCD-1234) and asks the developer to
 * visit this page in a real browser. Here we look up the pending session,
 * show what the CLI is asking for, and let the user Approve or Deny.
 *
 * Flow:
 *   1. (signed-out) → bounce through /signin?next=/auth/device?code=...
 *   2. (signed-in)  → show "Approve OXP CLI access for @<handle>"
 *   3. Approve action → flips DeviceAuth.{userId, approvedAt} so the CLI's
 *      next /token poll mints an ApiToken bound to this user.
 *
 * The actual ApiToken is minted server-side at poll time (see
 * /api/v1/auth/device/token/route.ts), NOT here, so the raw secret never
 * touches the browser.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { Terminal, Check, X } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeUserCode } from "@/lib/device-auth";
import { CodeForm } from "./CodeForm";
import { approveAction, denyAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Device Authorization" };

export default async function DeviceAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const rawCode = params.code ?? "";
  const userCode = rawCode ? normalizeUserCode(rawCode) : "";

  const me = await getCurrentUser();
  if (!me) {
    const next = userCode
      ? `/auth/device?code=${encodeURIComponent(userCode)}`
      : "/auth/device";
    redirect(`/signin?next=${encodeURIComponent(next)}`);
  }

  // No code yet → show the manual-entry form.
  if (!userCode) {
    return <CodeFormShell />;
  }

  const session = await prisma.deviceAuth.findUnique({
    where: { userCode },
  });

  // Render every error case with the same shell so the user can fix the
  // typo without losing context.
  if (!session) return <ErrorShell title="Code not found" code={userCode} />;
  if (session.consumedAt)
    return <ErrorShell title="Code already used" code={userCode} />;
  if (session.expiresAt.getTime() < Date.now())
    return (
      <ErrorShell title="Code expired — re-run `oxp login`" code={userCode} />
    );
  if (session.deniedAt)
    return <ErrorShell title="Already denied" code={userCode} />;
  if (session.approvedAt)
    return (
      <DonePanel
        title="Already approved"
        body="Your CLI should pick this up on its next poll. You can close this tab."
      />
    );

  // Default scopes if the CLI didn't request any: full publish for this user.
  const scopes =
    session.requestedScopes.length > 0
      ? session.requestedScopes
      : [`publish:@${me.handle}/*`];

  return (
    <div
      className="flex flex-col flex-1 w-full items-center justify-center py-20 px-4"
      style={{ zIndex: 2 }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="p-3 rounded border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 inline-flex mb-4">
            <Terminal className="w-6 h-6 text-[#7DD3FC]" />
          </div>
          <h1 className="text-3xl font-black text-[#f8fafc] mb-2">
            Approve CLI access
          </h1>
          <p className="text-base font-mono text-[#f8fafc]/60">
            The OXP CLI on another device is requesting access to your account.
          </p>
        </div>

        <div className="hud-card hud-corners p-8 space-y-6">
          <div>
            <div className="text-xs font-mono uppercase text-[#f8fafc]/50 mb-1">
              Code
            </div>
            <div className="text-2xl font-mono tracking-widest text-[#7DD3FC]">
              {userCode}
            </div>
          </div>

          <div>
            <div className="text-xs font-mono uppercase text-[#f8fafc]/50 mb-1">
              Account
            </div>
            <div className="text-base font-mono text-[#f8fafc]">
              @{me.handle}
            </div>
          </div>

          <div>
            <div className="text-xs font-mono uppercase text-[#f8fafc]/50 mb-2">
              Scopes the CLI will receive
            </div>
            <ul className="space-y-1">
              {scopes.map((s) => (
                <li
                  key={s}
                  className="text-sm font-mono text-[#f8fafc] bg-[#f8fafc]/5 px-3 py-1.5 rounded border border-[#f8fafc]/10"
                >
                  {s}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-3 pt-2">
            <form action={denyAction} className="flex-1">
              <input type="hidden" name="userCode" value={userCode} />
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded border border-[#f8fafc]/15 bg-transparent text-sm font-mono text-[#f8fafc]/80 hover:bg-[#f8fafc]/5"
              >
                <X className="w-4 h-4" />
                Deny
              </button>
            </form>
            <form action={approveAction} className="flex-1">
              <input type="hidden" name="userCode" value={userCode} />
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-sm font-mono text-[#7DD3FC] hover:bg-[#7DD3FC]/15"
              >
                <Check className="w-4 h-4" />
                Approve
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs font-mono text-[#f8fafc]/50 mt-6">
          Don&apos;t recognise this request?{" "}
          <Link
            href="/dashboard"
            className="text-[#7DD3FC] hover:text-[#BAE6FD]"
          >
            Click Deny.
          </Link>
        </p>
      </div>
    </div>
  );
}

function CodeFormShell() {
  return (
    <div
      className="flex flex-col flex-1 w-full items-center justify-center py-20 px-4"
      style={{ zIndex: 2 }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="p-3 rounded border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 inline-flex mb-4">
            <Terminal className="w-6 h-6 text-[#7DD3FC]" />
          </div>
          <h1 className="text-3xl font-black text-[#f8fafc] mb-2">
            Connect a device
          </h1>
          <p className="text-base font-mono text-[#f8fafc]/60">
            Enter the code shown by your <code>oxp login</code> session.
          </p>
        </div>
        <div className="hud-card hud-corners p-8">
          <CodeForm />
        </div>
      </div>
    </div>
  );
}

function ErrorShell({ title, code }: { title: string; code: string }) {
  return (
    <div
      className="flex flex-col flex-1 w-full items-center justify-center py-20 px-4"
      style={{ zIndex: 2 }}
    >
      <div className="w-full max-w-md">
        <div className="hud-card hud-corners p-8 text-center space-y-3">
          <div className="text-2xl font-mono tracking-widest text-[#f8fafc]/60">
            {code}
          </div>
          <h1 className="text-xl font-black text-[#f8fafc]">{title}</h1>
          <p className="text-sm font-mono text-[#f8fafc]/60">
            Re-run <code>oxp login</code> in your terminal to start a new
            session.
          </p>
          <Link
            href="/auth/device"
            className="inline-block text-sm font-mono text-[#7DD3FC] hover:text-[#BAE6FD] pt-2"
          >
            Enter a different code
          </Link>
        </div>
      </div>
    </div>
  );
}

function DonePanel({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="flex flex-col flex-1 w-full items-center justify-center py-20 px-4"
      style={{ zIndex: 2 }}
    >
      <div className="w-full max-w-md">
        <div className="hud-card hud-corners p-8 text-center space-y-3">
          <div className="p-3 rounded border border-[#7DD3FC]/20 bg-[#7DD3FC]/5 inline-flex">
            <Check className="w-6 h-6 text-[#7DD3FC]" />
          </div>
          <h1 className="text-xl font-black text-[#f8fafc]">{title}</h1>
          <p className="text-sm font-mono text-[#f8fafc]/60">{body}</p>
        </div>
      </div>
    </div>
  );
}
