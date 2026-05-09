/**
 * Phase 1 — bandwidth usage card on /dashboard.
 *
 * Server component. Reads the current-month bytes served for the user
 * (publisher subject) and renders a progress bar against the plan cap.
 */

import Link from "next/link";
import { Gauge } from "lucide-react";
import { PLANS, type PlanId } from "@/lib/billing";
import { getCurrentMonthBytes, currentYearMonth } from "@/lib/bandwidth";

const GB = 1024 * 1024 * 1024;

function formatGb(bytes: bigint): string {
  const gb = Number(bytes) / GB;
  if (gb >= 10) return `${gb.toFixed(0)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  if (gb >= 0.01) return `${gb.toFixed(2)} GB`;
  const mb = Number(bytes) / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export async function BandwidthCard({
  userId,
  plan,
}: {
  userId: string;
  plan: PlanId;
}) {
  const used = await getCurrentMonthBytes({ kind: "user", id: userId });
  const capGb = PLANS[plan].limits.cdnBandwidthGb;
  const unlimited = capGb < 0;
  const capBytes = unlimited ? BigInt(0) : BigInt(capGb) * BigInt(GB);
  const pct = unlimited
    ? 0
    : Math.min(
        100,
        Number((used * BigInt(1000)) / (capBytes || BigInt(1))) / 10,
      );

  const overCap = !unlimited && used >= capBytes;
  const nearCap = !unlimited && pct >= 80 && !overCap;

  const barColor = overCap
    ? "bg-rose-500"
    : nearCap
      ? "bg-amber-400"
      : "bg-[#7DD3FC]";

  return (
    <div className="hud-card hud-corners p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5" />
          {"// Bandwidth · " + currentYearMonth()}
        </h4>
        <span className="text-[10px] font-mono text-[#f8fafc]/40 uppercase tracking-wider">
          {plan}
        </span>
      </div>

      <div className="text-sm font-mono">
        <span className="text-[#f8fafc]">{formatGb(used)}</span>
        <span className="text-[#f8fafc]/40">
          {" / "}
          {unlimited ? "∞" : `${capGb} GB`}
        </span>
      </div>

      {!unlimited && (
        <div className="h-1.5 w-full rounded bg-[#7DD3FC]/10 overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
      )}

      {overCap && (
        <p className="text-[11px] font-mono text-rose-400">
          Cap exceeded. Bundle downloads return 402 until next UTC month.
        </p>
      )}
      {nearCap && (
        <p className="text-[11px] font-mono text-amber-300/80">
          Approaching monthly cap.
        </p>
      )}

      {plan === "free" && (
        <Link
          href="/pricing"
          className="inline-block text-[10px] font-mono font-bold tracking-wider uppercase text-[#7DD3FC]/80 hover:text-[#7DD3FC]"
        >
          Upgrade for 100 GB →
        </Link>
      )}
    </div>
  );
}
