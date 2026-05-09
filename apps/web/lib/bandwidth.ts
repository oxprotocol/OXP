/**
 * CDN bandwidth metering — Phase 1.
 *
 * Charges every served byte to the **owner** of the extension (User or
 * Organization), not to the downloader. That keeps the model symmetrical
 * with how plans are billed (a publisher's plan determines their cap)
 * and avoids needing identity at install time.
 *
 * Caps come from `PLANS[plan].limits.cdnBandwidthGb`:
 *   free    →  10 GB / month
 *   pro     → 100 GB / month
 *   teams   →   1 TB / month
 *   ent.    →   unlimited (-1)
 *
 * Storage is a single row per (subject, yearMonth) updated atomically.
 */

import type { AccountKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PLANS, type PlanId } from "@/lib/billing";

export type BandwidthSubject = { kind: AccountKind; id: string };

const GB = 1024 * 1024 * 1024;

/** UTC year-month string, e.g. "2026-05". */
export function currentYearMonth(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Atomically add `bytes` to the subject's current-month counter. */
export async function incrementBandwidth(
  subject: BandwidthSubject,
  bytes: number,
): Promise<void> {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  const yearMonth = currentYearMonth();
  await prisma.bandwidthUsage.upsert({
    where: {
      subjectKind_subjectId_yearMonth: {
        subjectKind: subject.kind,
        subjectId: subject.id,
        yearMonth,
      },
    },
    create: {
      subjectKind: subject.kind,
      subjectId: subject.id,
      yearMonth,
      bytesServed: BigInt(Math.floor(bytes)),
    },
    update: {
      bytesServed: { increment: BigInt(Math.floor(bytes)) },
    },
  });
}

/** Bytes served to this subject in the current UTC month. 0 if unmetered. */
export async function getCurrentMonthBytes(
  subject: BandwidthSubject,
): Promise<bigint> {
  const row = await prisma.bandwidthUsage.findUnique({
    where: {
      subjectKind_subjectId_yearMonth: {
        subjectKind: subject.kind,
        subjectId: subject.id,
        yearMonth: currentYearMonth(),
      },
    },
    select: { bytesServed: true },
  });
  return row?.bytesServed ?? BigInt(0);
}

/** GB used this month, rounded to 2 decimals. */
export async function getCurrentMonthUsageGb(
  subject: BandwidthSubject,
): Promise<number> {
  const bytes = await getCurrentMonthBytes(subject);
  return Math.round((Number(bytes) / GB) * 100) / 100;
}

export interface BandwidthCheck {
  ok: boolean;
  /** Bytes already served this month. */
  used: bigint;
  /** Cap in bytes. -1n means unlimited. */
  cap: bigint;
  /** GB cap as configured. -1 means unlimited. */
  capGb: number;
  plan: PlanId;
}

/**
 * Returns `ok: false` if the subject has already exceeded their monthly
 * bandwidth cap. Callers should respond 402 in that case.
 *
 * Soft-fail policy: we check **before** adding the bytes about to be served,
 * so a single download that pushes the subject just past the cap is allowed.
 * The next request after the cap is breached returns 402.
 */
export async function assertBandwidthAvailable(
  subject: BandwidthSubject,
  plan: PlanId,
): Promise<BandwidthCheck> {
  const capGb = PLANS[plan].limits.cdnBandwidthGb;
  const used = await getCurrentMonthBytes(subject);
  if (capGb < 0) {
    return { ok: true, used, cap: BigInt(-1), capGb, plan };
  }
  const cap = BigInt(capGb) * BigInt(GB);
  return { ok: used < cap, used, cap, capGb, plan };
}
