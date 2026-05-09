"use client";
/**
 * Client-side member roster + invite controls. Talks to the
 * /api/org/[handle]/members[/...] endpoints and refreshes the route on
 * mutation so server-rendered audit log updates land too.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type OrgRole = "owner" | "admin" | "contributor" | "reader";

interface Member {
  userId: string;
  handle: string;
  displayName: string;
  email: string;
  role: OrgRole;
}
interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
}

const ROLE_OPTIONS: OrgRole[] = ["admin", "contributor", "reader"];
const ROLE_OPTIONS_OWNER: OrgRole[] = [
  "owner",
  "admin",
  "contributor",
  "reader",
];

export function MembersPanel({
  orgHandle,
  meUserId,
  canManage,
  isOwner,
  initialMembers,
  initialInvites,
}: {
  orgHandle: string;
  meUserId: string;
  canManage: boolean;
  isOwner: boolean;
  initialMembers: Member[];
  initialInvites: Invite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  // Invite form state
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("contributor");

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function call(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      // ignore
    }
    if (!res.ok) {
      const msg = (json.error as string) || `HTTP ${res.status}`;
      setError(msg);
      return { ok: false, error: msg };
    }
    return { ok: true, data: json };
  }

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    const r = await call("POST", `/api/org/${orgHandle}/members`, {
      email: email.trim(),
      role,
    });
    if (r.ok) {
      setEmail("");
      setRole("contributor");
      if (typeof r.data?.acceptUrl === "string") {
        setLastInviteUrl(r.data.acceptUrl);
      }
      refresh();
    }
  }

  async function onChangeRole(userId: string, newRole: OrgRole) {
    const r = await call("PATCH", `/api/org/${orgHandle}/members/${userId}`, {
      role: newRole,
    });
    if (r.ok) refresh();
  }

  async function onRemove(userId: string, label: string) {
    if (!confirm(`Remove ${label} from @${orgHandle}?`)) return;
    const r = await call("DELETE", `/api/org/${orgHandle}/members/${userId}`);
    if (r.ok) refresh();
  }

  async function onRevokeInvite(inviteId: string, email: string) {
    if (!confirm(`Revoke invite to ${email}?`)) return;
    const r = await call(
      "DELETE",
      `/api/org/${orgHandle}/members/invites/${inviteId}`,
    );
    if (r.ok) refresh();
  }

  const roleChoices = isOwner ? ROLE_OPTIONS_OWNER : ROLE_OPTIONS;

  return (
    <div className="space-y-10">
      {error ? (
        <div className="hud-card border-red-400/40 bg-red-500/5 px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      {canManage ? (
        <section className="hud-card px-5 py-5">
          <h2 className="text-sm tracking-[0.18em] uppercase mb-4">
            Invite a teammate
          </h2>
          <form
            onSubmit={onInvite}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label className="flex-1 text-[10px] tracking-[0.2em] uppercase text-sky-300/60">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dev@your-co.com"
                className="mt-1 w-full bg-black/40 border border-sky-300/20 px-3 py-2 text-sm font-mono text-sky-100 focus:border-sky-300/50 outline-none"
              />
            </label>
            <label className="text-[10px] tracking-[0.2em] uppercase text-sky-300/60">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as OrgRole)}
                className="mt-1 block bg-black/40 border border-sky-300/20 px-3 py-2 text-sm font-mono text-sky-100 focus:border-sky-300/50 outline-none"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={pending}
              className="px-4 py-2 text-xs tracking-[0.2em] uppercase border border-sky-300/40 text-sky-100 hover:bg-sky-500/10 disabled:opacity-50"
            >
              Send invite
            </button>
          </form>
          {lastInviteUrl ? (
            <div className="mt-4 text-xs">
              <p className="text-sky-300/60 mb-1">
                Invite link (copy + send manually):
              </p>
              <code className="block break-all bg-black/40 border border-sky-300/20 px-3 py-2 text-sky-100">
                {lastInviteUrl}
              </code>
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 className="text-sm tracking-[0.18em] uppercase mb-3">Members</h2>
        <ul className="hud-card divide-y divide-sky-300/10">
          {initialMembers.map((m) => {
            const isMe = m.userId === meUserId;
            const editableRoles = canManage && (isOwner || m.role !== "owner");
            return (
              <li
                key={m.userId}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <div className="flex-1 min-w-[12rem]">
                  <div className="text-sky-100">
                    {m.displayName}{" "}
                    <span className="text-sky-300/50">@{m.handle}</span>
                    {isMe ? (
                      <span className="ml-2 text-[10px] tracking-[0.2em] uppercase text-sky-300/50">
                        (you)
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-sky-300/50">{m.email}</div>
                </div>
                {editableRoles ? (
                  <select
                    value={m.role}
                    onChange={(e) =>
                      onChangeRole(m.userId, e.target.value as OrgRole)
                    }
                    disabled={pending}
                    className="bg-black/40 border border-sky-300/20 px-2 py-1 text-xs font-mono text-sky-100"
                  >
                    {roleChoices.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs tracking-[0.18em] uppercase text-sky-300/60 px-2">
                    {m.role}
                  </span>
                )}
                {canManage && (isMe || isOwner || m.role !== "owner") ? (
                  <button
                    onClick={() => onRemove(m.userId, m.displayName)}
                    disabled={pending}
                    className="text-[10px] tracking-[0.2em] uppercase text-red-300/80 hover:text-red-200 px-2 py-1 border border-red-400/30 hover:border-red-400/60"
                  >
                    {isMe ? "Leave" : "Remove"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {canManage && initialInvites.length > 0 ? (
        <section>
          <h2 className="text-sm tracking-[0.18em] uppercase mb-3">
            Pending invites
          </h2>
          <ul className="hud-card divide-y divide-sky-300/10">
            {initialInvites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <div className="flex-1 min-w-[14rem]">
                  <div className="text-sky-100">{inv.email}</div>
                  <div className="text-[11px] text-sky-300/50">
                    role {inv.role} · expires{" "}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => onRevokeInvite(inv.id, inv.email)}
                  disabled={pending}
                  className="text-[10px] tracking-[0.2em] uppercase text-red-300/80 hover:text-red-200 px-2 py-1 border border-red-400/30 hover:border-red-400/60"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
