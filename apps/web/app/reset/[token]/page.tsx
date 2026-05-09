/**
 * /reset/[token] — set a new password using a reset token.
 *
 * The page server-side checks the token validity once so we can show a
 * friendly error before the user fills in the form. The form posts back
 * to the `resetPassword` server action which atomically consumes the
 * token and updates the password hash.
 */
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { lookupPasswordReset } from "@/lib/email-tokens";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";

export default async function ResetTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const raw = decodeURIComponent(token);
  const probe = await lookupPasswordReset(raw);

  return (
    <main className="mx-auto max-w-md px-6 py-20 font-mono text-sky-200">
      <div className="hud-card px-8 py-10">
        <div className="text-center mb-6">
          <KeyRound className="w-10 h-10 mx-auto text-sky-300 mb-3" />
          <h1 className="text-xl tracking-[0.18em] uppercase text-sky-100">
            Choose a new password
          </h1>
        </div>

        {probe.ok ? (
          <ResetForm token={raw} />
        ) : (
          <div className="text-center">
            <p className="text-sm text-red-300 mb-4">
              This reset link is{" "}
              {probe.reason === "expired"
                ? "expired"
                : probe.reason === "already-consumed"
                  ? "already used"
                  : "invalid"}
              .
            </p>
            <Link
              href="/forgot"
              className="inline-flex items-center px-4 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10"
            >
              Request a new link →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
