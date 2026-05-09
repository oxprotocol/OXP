/**
 * Postmark email client + typed templates.
 *
 * All transactional mail flows through `sendEmail()`. Each template is a
 * function that returns `{ subject, html, text }`. We keep templates in
 * this single file to make a future swap to Postmark template IDs trivial.
 *
 * Behaviour when not configured (`POSTMARK_TOKEN` missing): the helper logs
 * and returns `{ skipped: true }` — never throws — so dev environments and
 * CI keep working without credentials.
 */

import { ServerClient } from "postmark";

const TOKEN = process.env.POSTMARK_TOKEN;

/**
 * Sender envelopes.
 *  - `noreply` — automated transactional mail (verify, reset, billing,
 *     webhook receipts). Replies are not monitored; ReplyTo points at
 *     support so any reply still lands in the inbox we read.
 *  - `support` — human-authored or human-replyable mail. From and ReplyTo
 *     are both the support inbox.
 *
 * Each address must be a verified Sender Signature in Postmark (or the
 *  server's domain must be DKIM/Return-Path verified for the whole apex).
 */
const FROM_NOREPLY =
  process.env.POSTMARK_FROM_NOREPLY ??
  process.env.POSTMARK_FROM_ADDRESS ??
  "OXP <noreply@oxp.sh>";
const FROM_SUPPORT =
  process.env.POSTMARK_FROM_SUPPORT ?? "OXP Support <support@oxp.sh>";
const REPLY_TO = process.env.POSTMARK_REPLY_TO ?? "support@oxp.sh";
const STREAM = process.env.POSTMARK_MESSAGE_STREAM ?? "outbound";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://oxp.sh";

let _client: ServerClient | null = null;
function client(): ServerClient | null {
  if (!TOKEN) return null;
  if (_client) return _client;
  _client = new ServerClient(TOKEN);
  return _client;
}

export function isEmailConfigured(): boolean {
  return Boolean(TOKEN);
}

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

interface SendArgs {
  to: string;
  template: Rendered;
  /** Postmark `Tag` — surfaces in the dashboard for filtering. */
  tag?: string;
  /** Postmark `MessageStream` override; defaults to env / "outbound". */
  stream?: string;
  /**
   * Sender envelope. Defaults to `noreply` since almost everything we send
   * is automated. Use `support` only for human-written replies / outreach.
   */
  from?: "noreply" | "support";
}

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email through Postmark. Failures are caught and returned —
 * never thrown — because email delivery should never block a request
 * (account creation, payment webhook, etc.).
 */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const c = client();
  if (!c) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        "[email] skipped (POSTMARK_TOKEN unset):",
        args.template.subject,
        "→",
        args.to,
      );
    }
    return { ok: false, skipped: true };
  }
  try {
    const fromAddress = args.from === "support" ? FROM_SUPPORT : FROM_NOREPLY;
    const res = await c.sendEmail({
      From: fromAddress,
      To: args.to,
      ReplyTo: REPLY_TO,
      Subject: args.template.subject,
      HtmlBody: args.template.html,
      TextBody: args.template.text,
      MessageStream: args.stream ?? STREAM,
      Tag: args.tag,
      TrackOpens: false,
      // postmark's LinkTrackingOptions enum isn't re-exported from the package
      // root, so we pass the raw enum value as a string. Valid values:
      // "None" | "HtmlAndText" | "HtmlOnly" | "TextOnly".
      TrackLinks: "None" as never,
      // RFC 8058 one-click unsubscribe + RFC 2369 mailto fallback. Required
      // by Gmail/Yahoo bulk-sender rules and improves inbox placement even
      // at low volume.
      Headers: [
        {
          Name: "List-Unsubscribe",
          Value: `<mailto:${REPLY_TO}?subject=unsubscribe>, <${APP_URL}/settings/notifications>`,
        },
        {
          Name: "List-Unsubscribe-Post",
          Value: "List-Unsubscribe=One-Click",
        },
      ],
    });
    return { ok: true, messageId: res.MessageID };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] send failed:", msg);
    return { ok: false, error: msg };
  }
}

/* ─── Shared HTML chrome ───────────────────────────────────────────── */

function shell(title: string, bodyHtml: string): string {
  // Inline styles only — most email clients strip <style> blocks.
  // Palette uses safe hex (no oklch) and CSS that survives Gmail/Outlook.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#060a13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#060a13;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0a0f1c;border:1px solid rgba(125,211,252,0.15);border-radius:6px;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid rgba(125,211,252,0.12);">
                <a href="${APP_URL}" style="text-decoration:none;color:#7DD3FC;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700;font-size:15px;letter-spacing:0.02em;">
                  &gt; oxp.sh
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-size:15px;line-height:1.65;color:rgba(248,250,252,0.85);">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid rgba(125,211,252,0.08);font-size:12px;color:rgba(248,250,252,0.4);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
                OXP Protocol &middot; Sent from a no-reply mailbox.<br />
                Need help? Reply to this email or write to <a href="mailto:${REPLY_TO}" style="color:#7DD3FC;text-decoration:underline;">${REPLY_TO}</a>.<br />
                <a href="${APP_URL}/legal/privacy" style="color:rgba(125,211,252,0.7);text-decoration:underline;">Privacy</a>
                &nbsp;&middot;&nbsp;
                <a href="${APP_URL}/legal/terms" style="color:rgba(125,211,252,0.7);text-decoration:underline;">Terms</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background:#7DD3FC;border-radius:4px;">
        <a href="${href}" style="display:inline-block;padding:12px 22px;font-weight:700;font-size:14px;color:#060a13;text-decoration:none;letter-spacing:0.04em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:uppercase;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ─── Templates ────────────────────────────────────────────────────── */

export function welcomeEmail(args: {
  handle: string;
  displayName?: string | null;
}): Rendered {
  const name = args.displayName?.trim() || args.handle;
  const subject = `Welcome to OXP, @${args.handle}`;
  const html = shell(
    subject,
    `<p style="margin:0 0 16px;">Hey ${escapeHtml(name)},</p>
     <p style="margin:0 0 16px;">Your account is live. You're on the <strong>Free</strong> plan — unlimited public extensions, full WASM runtime, every host adapter.</p>
     <p style="margin:0 0 16px;">A few useful next steps:</p>
     <ul style="margin:0 0 16px 20px;padding:0;">
       <li style="margin-bottom:6px;">Install the CLI: <code style="background:rgba(125,211,252,0.1);padding:1px 6px;border-radius:3px;color:#BAE6FD;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;">npm i -g @oxprotocol/cli</code></li>
       <li style="margin-bottom:6px;">Scaffold an extension: <code style="background:rgba(125,211,252,0.1);padding:1px 6px;border-radius:3px;color:#BAE6FD;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;">oxp init my-ext</code></li>
       <li>Browse what others built: <a href="${APP_URL}/packages" style="color:#7DD3FC;">${APP_URL.replace(/^https?:\/\//, "")}/packages</a></li>
     </ul>
     ${button(`${APP_URL}/dashboard`, "Open dashboard")}
     <p style="margin:24px 0 0;color:rgba(248,250,252,0.55);font-size:13px;">If you didn't create this account, ignore this email or write to <a href="mailto:${REPLY_TO}" style="color:#7DD3FC;">${REPLY_TO}</a>.</p>`,
  );
  const text = `Hey ${name},

Your OXP account is live. You're on the Free plan — unlimited public extensions, full WASM runtime, every host adapter.

Next steps:
  • Install the CLI: npm i -g @oxprotocol/cli
  • Scaffold an extension: oxp init my-ext
  • Browse what others built: ${APP_URL}/packages

Open the dashboard: ${APP_URL}/dashboard

If you didn't create this account, ignore this email or contact ${REPLY_TO}.`;
  return { subject, html, text };
}

export function emailVerificationEmail(args: {
  handle: string;
  verifyUrl: string;
}): Rendered {
  const subject = "Verify your OXP email";
  const html = shell(
    subject,
    `<p style="margin:0 0 16px;">Hi @${escapeHtml(args.handle)},</p>
     <p style="margin:0 0 16px;">Confirm this is the right address for your OXP account so we can send security alerts and receipts here.</p>
     ${button(args.verifyUrl, "Verify email")}
     <p style="margin:0 0 8px;font-size:13px;color:rgba(248,250,252,0.55);">Or paste this link into your browser:</p>
     <p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${args.verifyUrl}" style="color:#7DD3FC;">${escapeHtml(args.verifyUrl)}</a></p>
     <p style="margin:24px 0 0;font-size:13px;color:rgba(248,250,252,0.55);">The link expires in 24 hours. If you didn't request this, you can safely ignore the message.</p>`,
  );
  const text = `Hi @${args.handle},

Confirm this is the right address for your OXP account.

Verify: ${args.verifyUrl}

The link expires in 24 hours. If you didn't request this, ignore this message.`;
  return { subject, html, text };
}

export function passwordResetEmail(args: {
  handle: string;
  resetUrl: string;
}): Rendered {
  const subject = "Reset your OXP password";
  const html = shell(
    subject,
    `<p style="margin:0 0 16px;">Hi @${escapeHtml(args.handle)},</p>
     <p style="margin:0 0 16px;">We received a request to reset your password. Click below to choose a new one.</p>
     ${button(args.resetUrl, "Reset password")}
     <p style="margin:0 0 8px;font-size:13px;color:rgba(248,250,252,0.55);">Or use this link directly:</p>
     <p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${args.resetUrl}" style="color:#7DD3FC;">${escapeHtml(args.resetUrl)}</a></p>
     <p style="margin:24px 0 0;font-size:13px;color:rgba(248,250,252,0.55);">The link is valid for 1 hour. If you didn't request a reset, ignore this email and your password stays unchanged.</p>`,
  );
  const text = `Hi @${args.handle},

We received a request to reset your password.

Reset link: ${args.resetUrl}

The link is valid for 1 hour. If you didn't request a reset, ignore this email and your password stays unchanged.`;
  return { subject, html, text };
}

export function subscriptionActivatedEmail(args: {
  handle: string;
  planName: string;
  amountDisplay: string;
  invoiceUrl?: string;
}): Rendered {
  const subject = `You're on OXP ${args.planName} — receipt inside`;
  const html = shell(
    subject,
    `<p style="margin:0 0 16px;">Hi @${escapeHtml(args.handle)},</p>
     <p style="margin:0 0 16px;">Your <strong>OXP ${escapeHtml(args.planName)}</strong> subscription is active. Charged: <strong>${escapeHtml(args.amountDisplay)}</strong>.</p>
     <p style="margin:0 0 16px;">All paid features are unlocked on your account immediately. The dashboard now shows the new plan badge.</p>
     ${button(`${APP_URL}/dashboard`, "Open dashboard")}
     ${
       args.invoiceUrl
         ? `<p style="margin:8px 0 0;font-size:13px;"><a href="${args.invoiceUrl}" style="color:#7DD3FC;">View Paddle invoice</a></p>`
         : ""
     }
     <p style="margin:24px 0 0;font-size:13px;color:rgba(248,250,252,0.55);">Thanks for backing OXP. Hit reply with anything you'd like to see next — we read every message.</p>`,
  );
  const text = `Hi @${args.handle},

Your OXP ${args.planName} subscription is active. Charged: ${args.amountDisplay}.

Dashboard: ${APP_URL}/dashboard${args.invoiceUrl ? `\nInvoice: ${args.invoiceUrl}` : ""}

Thanks for backing OXP.`;
  return { subject, html, text };
}

export function subscriptionCanceledEmail(args: {
  handle: string;
  planName: string;
  endsAt: Date;
}): Rendered {
  const ends = args.endsAt.toISOString().slice(0, 10);
  const subject = `Your OXP ${args.planName} subscription will end on ${ends}`;
  const html = shell(
    subject,
    `<p style="margin:0 0 16px;">Hi @${escapeHtml(args.handle)},</p>
     <p style="margin:0 0 16px;">We've scheduled the cancellation of your <strong>OXP ${escapeHtml(args.planName)}</strong> plan. You'll keep all paid features until <strong>${ends}</strong>, after which the account drops back to the Free plan automatically.</p>
     <p style="margin:0 0 16px;">No content is deleted on downgrade — private extensions stay stored but become unlisted until billing is restored.</p>
     ${button(`${APP_URL}/pricing`, "Re-subscribe")}
     <p style="margin:24px 0 0;font-size:13px;color:rgba(248,250,252,0.55);">If this was a mistake or you'd like to share why you cancelled, just reply — it genuinely helps.</p>`,
  );
  const text = `Hi @${args.handle},

We've scheduled the cancellation of your OXP ${args.planName} plan. You'll keep paid features until ${ends}, then the account drops to Free.

No content is deleted on downgrade — private extensions stay stored but become unlisted until billing is restored.

Re-subscribe: ${APP_URL}/pricing

If this was a mistake or you'd like to share why you cancelled, just reply.`;
  return { subject, html, text };
}
