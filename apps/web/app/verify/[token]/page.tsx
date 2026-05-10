/**
 * /verify/[token] — consume an email verification token and sign the user
 * in. The token is single-use, expires after a short window, and is bound
 * to the userId — possessing it is proof of email control, equivalent to
 * a successful sign-in. We mint the NextAuth session cookie directly and
 * land them on the dashboard. No re-login required.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { consumeEmailVerification } from "@/lib/email-tokens";
import { sendEmail, welcomeEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session-mint";

export const dynamic = "force-dynamic";

export default async function VerifyTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await consumeEmailVerification(decodeURIComponent(token));

  if (result.ok) {
    const u = await prisma.user.findUnique({
      where: { id: result.userId },
      select: {
        id: true,
        email: true,
        handle: true,
        displayName: true,
        avatarSeed: true,
      },
    });
    if (u) {
      // Welcome email — fire-and-forget; failures don't block sign-in.
      void sendEmail({
        to: u.email,
        template: welcomeEmail({
          handle: u.handle,
          displayName: u.displayName,
        }),
        tag: "welcome",
      });
      // Auto sign-in: set the NextAuth session cookie and go to dashboard.
      await setSessionCookie({
        id: u.id,
        email: u.email,
        handle: u.handle,
        displayName: u.displayName,
        avatarSeed: u.avatarSeed,
      });
      redirect("/dashboard?welcome=1");
    }
    // User row vanished between consume and read — fall through to signin.
    redirect("/signin?verified=1");
  }

  const reason =
    result.reason === "expired"
      ? "This verification link expired. Request a fresh one below."
      : result.reason === "already-consumed"
        ? "This link was already used. Try signing in."
        : "This verification link is invalid.";

  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center font-mono text-sky-200">
      <div className="hud-card px-8 py-10">
        <AlertCircle className="w-10 h-10 mx-auto text-amber-300 mb-4" />
        <h1 className="text-xl tracking-[0.18em] uppercase mb-3 text-sky-100">
          Couldn&apos;t verify
        </h1>
        <p className="text-sm text-sky-300/70 mb-6">{reason}</p>
        <Link
          href="/verify/sent"
          className="inline-flex items-center px-4 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10"
        >
          Get a new link →
        </Link>
      </div>
    </main>
  );
}
