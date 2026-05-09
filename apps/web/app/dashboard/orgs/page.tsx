import { redirect } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listUserOrgs } from "@/lib/orgs";
import { CreateOrgForm } from "./CreateOrgForm";

export const metadata = { title: "Teams" };
export const dynamic = "force-dynamic";

export default async function OrgsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/signin?next=/dashboard/orgs");
  const orgs = await listUserOrgs(me.id);

  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-10">
          <div className="flex items-center gap-3 mb-3">
            <Users className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// Teams"}
            </h2>
          </div>
          <h1 className="text-3xl font-black text-[#f8fafc] mb-2">
            Organizations
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/50 max-w-2xl">
            Create a shared namespace to publish under, invite teammates with
            scoped roles, and share private extensions. Free orgs work for small
            teams; Teams plans add SSO, audit logs, and custom domains.
          </p>
        </div>
      </section>

      <section className="app-container app-shell py-8 space-y-8">
        <div className="hud-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#060a13] border-b border-[#7DD3FC]/10">
              <tr className="text-left">
                <th className="px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-[#7DD3FC]/50">
                  Org
                </th>
                <th className="px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-[#7DD3FC]/50">
                  Role
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-6 text-center text-xs font-mono text-[#f8fafc]/40"
                  >
                    You aren&apos;t in any organizations yet. Create one below.
                  </td>
                </tr>
              ) : (
                orgs.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-[#7DD3FC]/5 last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[#f8fafc]">
                      <Link
                        href={`/${o.handle}`}
                        className="hover:text-[#7DD3FC]"
                      >
                        @{o.handle}
                      </Link>
                      <span className="ml-2 text-xs text-[#f8fafc]/40">
                        {o.displayName}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#f8fafc]/60 uppercase tracking-wider">
                      {o.role}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono">
                      {o.role === "owner" || o.role === "admin" ? (
                        <Link
                          href={`/org/${o.handle}/admin`}
                          className="text-[#7DD3FC] hover:underline"
                        >
                          admin →
                        </Link>
                      ) : (
                        <Link
                          href={`/org/${o.handle}/admin/members`}
                          className="text-[#f8fafc]/40 hover:text-[#7DD3FC]"
                        >
                          members →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="hud-card px-5 py-5">
          <h2 className="text-sm font-mono tracking-[0.18em] uppercase text-[#7DD3FC]/70 mb-4">
            Create a new organization
          </h2>
          <CreateOrgForm />
        </div>
      </section>
    </div>
  );
}
