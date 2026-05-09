/**
 * Public live-status page. Real liveness checks (no fake green dots):
 *   • Postgres — `SELECT 1` round-trip via Prisma
 *   • Blob root — write+read of an ephemeral probe key
 *   • Outbound HTTPS — TCP/TLS reachability of api.paddle.com (billing dep)
 *
 * Re-rendered on every request (`force-dynamic`, no-store), so reloading
 * the page is the source of truth.
 */

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Status · OXP" };

interface Check {
  name: string;
  detail: string;
  ok: boolean;
  ms: number;
  err?: string;
}

async function checkDatabase(): Promise<Check> {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      name: "Postgres",
      detail: "Primary database (Neon)",
      ok: true,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      name: "Postgres",
      detail: "Primary database (Neon)",
      ok: false,
      ms: Date.now() - t0,
      err: (e as Error).message.slice(0, 200),
    };
  }
}

async function checkBlob(): Promise<Check> {
  const t0 = Date.now();
  try {
    const { putBundle, getBundle } = await import("@/lib/blob-store");
    const { createHash } = await import("node:crypto");
    const probe = Buffer.from(`probe-${Date.now()}-${Math.random()}`);
    const sha = createHash("sha256").update(probe).digest("hex");
    await putBundle(sha, probe);
    const got = await getBundle(sha);
    if (!got || got.length !== probe.length) throw new Error("read mismatch");
    return {
      name: "Blob store",
      detail: "Bundle artifact storage",
      ok: true,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      name: "Blob store",
      detail: "Bundle artifact storage",
      ok: false,
      ms: Date.now() - t0,
      err: (e as Error).message.slice(0, 200),
    };
  }
}

async function checkPaddle(): Promise<Check> {
  const t0 = Date.now();
  try {
    const ctrl = AbortSignal.timeout(4000);
    const res = await fetch("https://api.paddle.com/", { signal: ctrl });
    return {
      name: "Paddle",
      detail: "Billing provider reachability",
      ok: res.status > 0 && res.status < 600,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      name: "Paddle",
      detail: "Billing provider reachability",
      ok: false,
      ms: Date.now() - t0,
      err: (e as Error).message.slice(0, 200),
    };
  }
}

export default async function StatusPage() {
  const [db, blob, paddle] = await Promise.all([
    checkDatabase(),
    checkBlob(),
    checkPaddle(),
  ]);
  const checks: Check[] = [db, blob, paddle];
  const allGreen = checks.every((c) => c.ok);
  const now = new Date().toISOString();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 font-mono text-sky-200">
      <p className="text-[10px] tracking-[0.2em] text-sky-300/50 uppercase">
        / status
      </p>
      <h1 className="text-3xl tracking-[0.18em] uppercase mt-2 mb-2">
        System status
      </h1>
      <p className="text-xs text-sky-300/50 mb-10">
        Live checks executed at request time · {now}
      </p>

      <div
        className={`hud-card p-6 mb-8 border-l-2 ${
          allGreen ? "border-l-cyan-300" : "border-l-red-400"
        }`}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-sm tracking-[0.18em] uppercase text-sky-100">
            {allGreen ? "All systems operational" : "Degraded service"}
          </span>
          <span
            className={`text-xs tracking-[0.2em] uppercase ${allGreen ? "text-cyan-300" : "text-red-300"}`}
          >
            {allGreen ? "GREEN" : "RED"}
          </span>
        </div>
      </div>

      <ul className="space-y-3">
        {checks.map((c) => (
          <li key={c.name} className="hud-card p-5">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <h2 className="text-sm tracking-[0.18em] uppercase text-sky-100">
                  {c.name}
                </h2>
                <p className="text-xs text-sky-300/60 mt-1">{c.detail}</p>
              </div>
              <div className="text-right">
                <span
                  className={`text-[10px] tracking-[0.2em] uppercase ${c.ok ? "text-cyan-300" : "text-red-300"}`}
                >
                  {c.ok ? "OK" : "FAIL"}
                </span>
                <div className="text-[10px] text-sky-300/40 mt-1">
                  {c.ms} ms
                </div>
              </div>
            </div>
            {c.err && (
              <pre className="mt-3 text-[10px] text-red-300/80 bg-black/40 p-2 overflow-x-auto">
                {c.err}
              </pre>
            )}
          </li>
        ))}
      </ul>

      <p className="text-[10px] tracking-[0.18em] uppercase text-sky-300/40 mt-10">
        Uptime SLA terms →{" "}
        <a href="/sla" className="text-sky-300/80 hover:text-cyan-300">
          /sla
        </a>{" "}
        · Security &amp; compliance →{" "}
        <a href="/trust" className="text-sky-300/80 hover:text-cyan-300">
          /trust
        </a>
      </p>
    </main>
  );
}
