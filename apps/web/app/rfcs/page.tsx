import Link from "next/link";
import { Award, GitBranch, FileText } from "lucide-react";

export const metadata = {
  title: "RFCs — OXP",
  description:
    "The Open eXtensions Protocol RFC process. Propose changes to the spec, runtime, or host adapters.",
};

const STAGES = [
  {
    id: "0",
    name: "Draft",
    desc: "Sketch the problem and a rough proposal in GitHub Discussions. No format required.",
  },
  {
    id: "1",
    name: "Proposal",
    desc: "Open a PR against `spec/rfcs/` with a numbered RFC document. Solicit feedback from maintainers.",
  },
  {
    id: "2",
    name: "Review",
    desc: "Maintainers review for scope, security, and cross-host implications. Iterate in the PR.",
  },
  {
    id: "3",
    name: "Accepted",
    desc: "Merged with a stable RFC number. Implementation tracked in a follow-up issue.",
  },
  {
    id: "4",
    name: "Shipped",
    desc: "Reflected in the spec, host adapters, and CLI. Released under semver.",
  },
];

const TEMPLATE = `# RFC-NNNN: <title>

- **Author(s):** <github handle(s)>
- **Status:** Draft
- **Created:** YYYY-MM-DD
- **Target:** spec | runtime | host-* | cli | sdk

## Summary
One paragraph: what changes and why.

## Motivation
The problem this solves. Concrete use cases.

## Detailed design
The proposal. Be precise — include schemas, API shapes, error modes.

## Security considerations
Permissions, sandbox impact, supply-chain implications.

## Backwards compatibility
What breaks. Migration path.

## Alternatives
What else was considered and why it was rejected.

## Unresolved questions
Open items to resolve before acceptance.
`;

export default function RfcsPage() {
  return (
    <div className="flex flex-col flex-1 w-full" style={{ zIndex: 2 }}>
      {/* Hero */}
      <section className="border-b border-[#7DD3FC]/10 bg-[#060a13]/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center gap-3 mb-3">
            <Award className="w-4 h-4 text-[#7DD3FC]/40" />
            <h2 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/50 uppercase">
              {"// RFC Process"}
            </h2>
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[#f8fafc] mb-2">
            Propose changes to the protocol.
          </h1>
          <p className="text-sm font-mono text-[#f8fafc]/40 max-w-2xl">
            OXP evolves through a lightweight RFC process. Anyone can draft —
            maintainers review for scope, security, and cross-host implications.
            Discussion happens in the open.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12 w-full">
        {/* Stages */}
        <div>
          <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase mb-5 flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5" />
            {"// Lifecycle"}
          </h3>
          <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {STAGES.map((s) => (
              <li key={s.id} className="hud-card hud-corners p-5">
                <div className="text-xs font-mono text-[#7DD3FC]/60 mb-2">
                  STAGE {s.id}
                </div>
                <div className="text-base font-bold text-[#f8fafc] mb-2">
                  {s.name}
                </div>
                <p className="text-xs font-mono text-[#f8fafc]/50">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Template */}
        <div className="hud-card hud-corners p-6">
          <h3 className="text-xs font-mono font-bold tracking-[0.2em] text-[#7DD3FC]/60 uppercase mb-5 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" />
            {"// RFC template"}
          </h3>
          <pre className="text-xs font-mono text-[#f8fafc]/80 bg-[#0b1220] border border-[#7DD3FC]/10 rounded p-4 overflow-x-auto whitespace-pre">
            {TEMPLATE}
          </pre>
        </div>

        <div className="text-center">
          <Link
            href="/community"
            className="inline-flex items-center gap-2 text-xs font-mono text-[#7DD3FC]/60 hover:text-[#7DD3FC]"
          >
            ← Back to Community
          </Link>
        </div>
      </section>
    </div>
  );
}
