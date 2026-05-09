import { redirect } from "next/navigation";
import { Settings as SettingsIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { SettingsClient } from "./SettingsClient";

export const metadata = { title: "Account settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/signin?next=/settings");
  }

  return (
    <div className="flex flex-col flex-1 w-full relative" style={{ zIndex: 2 }}>
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="app-container app-shell py-8">
          <div className="flex items-center gap-2 mb-3 text-xs font-mono text-[#f8fafc]/30 tracking-wider uppercase">
            <a href="/dashboard" className="hover:text-[#7DD3FC]">
              Dashboard
            </a>
            <span className="text-[#f8fafc]/15">/</span>
            <span className="text-[#7DD3FC]/60">Settings</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="auth-icon-tile">
              <SettingsIcon className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-[#f8fafc]">
                Account settings
              </h1>
              <p className="text-xs font-mono text-[#f8fafc]/40 mt-1">
                Profile, email, password and security — everything tied to{" "}
                <span className="text-[#7DD3FC]/70">@{user.handle}</span>.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="app-container app-shell py-10 max-w-3xl">
        <SettingsClient user={user} />
      </section>
    </div>
  );
}
