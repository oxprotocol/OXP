/**
 * Public SLA terms. The 99.95 % commitment is contractual on Enterprise
 * (signed MSA addendum) and aspirational on every other tier — we keep
 * the page honest about that.
 */

export const metadata = { title: "SLA · OXP" };

export default function SlaPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 font-mono text-sky-200">
      <p className="text-[10px] tracking-[0.2em] text-sky-300/50 uppercase">
        / sla
      </p>
      <h1 className="text-3xl tracking-[0.18em] uppercase mt-2 mb-6">
        Uptime SLA
      </h1>

      <section className="hud-card p-6 space-y-3 text-sm leading-relaxed text-sky-100">
        <p>
          OXP commits to a monthly uptime of{" "}
          <span className="text-cyan-300 font-semibold">99.95&nbsp;%</span> for
          the registry API, the bundle CDN, and any custom-domain proxy
          targeting <code>edge.oxp.sh</code>. This commitment is{" "}
          <span className="text-sky-200">contractual on Enterprise</span> via a
          signed MSA addendum. Free / Pro / Teams customers get the same target
          on a best-effort, non-contractual basis.
        </p>
        <p>
          Excluded: scheduled maintenance announced ≥ 72 hours in advance via
          status.oxp.sh; outages caused by customer code (rejected uploads,
          throttled keys); outages of upstream sub-processors (Cloudflare, Neon,
          Paddle) where their own SLA pays out.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-base tracking-[0.18em] uppercase mb-3">
          Service credits
        </h2>
        <table className="w-full text-sm border border-sky-300/15">
          <thead className="text-[10px] tracking-[0.2em] uppercase text-sky-300/60">
            <tr>
              <th className="text-left p-3 border-b border-sky-300/15">
                Monthly uptime
              </th>
              <th className="text-left p-3 border-b border-sky-300/15">
                Service credit (Enterprise)
              </th>
            </tr>
          </thead>
          <tbody className="text-sky-100">
            <tr>
              <td className="p-3 border-b border-sky-300/10">
                &lt; 99.95 % and ≥ 99.0 %
              </td>
              <td className="p-3 border-b border-sky-300/10">
                10 % of monthly fee
              </td>
            </tr>
            <tr>
              <td className="p-3 border-b border-sky-300/10">
                &lt; 99.0 % and ≥ 95.0 %
              </td>
              <td className="p-3 border-b border-sky-300/10">
                25 % of monthly fee
              </td>
            </tr>
            <tr>
              <td className="p-3">&lt; 95.0 %</td>
              <td className="p-3">50 % of monthly fee</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-sky-300/60 mt-3">
          Credits are claimed within 30 days of the billing month and capped at
          the monthly fee.
        </p>
      </section>

      <section className="mt-10 hud-card p-6 text-sm">
        <h2 className="text-base tracking-[0.18em] uppercase mb-3">
          Live status
        </h2>
        <p className="text-sky-300/70">
          Real-time:{" "}
          <a className="text-cyan-300" href="/status">
            /status
          </a>
          . Historical incidents and post-mortems are appended within 5 business
          days.
        </p>
      </section>
    </main>
  );
}
