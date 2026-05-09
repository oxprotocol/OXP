import React from "react";
import { slugifyHeading } from "@/lib/docs";
import { CodeBlock } from "./CodeBlock";
import {
  Info,
  Lightbulb,
  AlertTriangle,
  ShieldAlert,
  MessageSquare,
} from "lucide-react";

/**
 * Lightweight markdown-ish renderer.
 *
 * Block syntax:
 *   ## Heading             h2 (anchored, in TOC)
 *   ### Heading            h3 (anchored, in TOC)
 *   #### Heading           h4
 *   ```fenced```           fenced code block (optional language tag)
 *   - item                 unordered list
 *   1. item                ordered list
 *   > quote                blockquote
 *   | a | b |              GFM-style pipe table (header + --- divider + rows)
 *   blank line             paragraph break
 *
 * Inline syntax:
 *   `code`                 inline code
 *   **bold**               bold
 *   _italic_               italic
 *   [text](href)           link
 */
export function DocBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const info = line.slice(3).trim();
      const { lang, filename } = parseFenceInfo(info);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <CodeBlock
          key={key++}
          code={code.join("\n")}
          lang={lang}
          filename={filename}
        />,
      );
      continue;
    }

    // Callouts: :::note | :::tip | :::warning | :::danger | :::info
    const calloutOpen = /^:::(note|tip|warning|danger|info)(?:\s+(.+))?$/.exec(
      line,
    );
    if (calloutOpen) {
      const variant = calloutOpen[1] as CalloutVariant;
      const title = calloutOpen[2]?.trim();
      const inner: string[] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) {
        inner.push(lines[i]);
        i++;
      }
      i++; // skip closing :::
      blocks.push(
        <Callout key={key++} variant={variant} title={title}>
          <DocBody body={inner.join("\n")} />
        </Callout>,
      );
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const id = slugifyHeading(h2[1]);
      blocks.push(
        <h2
          key={key++}
          id={id}
          className="doc-h2 mt-12 mb-4 scroll-mt-24 text-2xl font-bold tracking-tight"
        >
          {renderInline(h2[1])}
        </h2>,
      );
      i++;
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      const id = slugifyHeading(h3[1]);
      blocks.push(
        <h3
          key={key++}
          id={id}
          className="doc-h3 mt-8 mb-3 scroll-mt-24 text-lg font-semibold tracking-tight"
        >
          {renderInline(h3[1])}
        </h3>,
      );
      i++;
      continue;
    }
    const h4 = /^####\s+(.+)$/.exec(line);
    if (h4) {
      blocks.push(
        <h4
          key={key++}
          className="doc-h4 mt-6 mb-2 text-base font-semibold tracking-tight"
        >
          {renderInline(h4[1])}
        </h4>,
      );
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="doc-quote my-5 rounded-md border-l-2 px-4 py-2 text-[16px] leading-7"
        >
          {renderInline(quoted.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\|?\s*:?-{2,}/.test(lines[i + 1])
    ) {
      const header = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push(
        <div
          key={key++}
          className="doc-table-wrap my-6 overflow-x-auto rounded-md border"
        >
          <table className="doc-table w-full text-[15px] leading-6">
            <thead>
              <tr>
                {header.map((h, idx) => (
                  <th
                    key={idx}
                    className="doc-th px-3 py-2 text-left font-semibold"
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ridx) => (
                <tr key={ridx}>
                  {r.map((c, cidx) => (
                    <td key={cidx} className="doc-td px-3 py-2 align-top">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol
          key={key++}
          className="doc-list my-4 list-decimal space-y-2 pl-6 text-[17px] leading-8"
        >
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ""));
        i++;
      }
      blocks.push(
        <ul
          key={key++}
          className="doc-list my-4 list-disc space-y-2 pl-5 text-[17px] leading-8"
        >
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^-\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^:::/.test(lines[i]) &&
      !lines[i].trim().startsWith("|")
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="doc-p my-4 text-[17px] leading-8">
        {renderInline(para.join(" "))}
      </p>,
    );
  }

  return <div className="doc-body">{blocks}</div>;
}

function parseRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

/**
 * Parse a fenced-code info string. Examples:
 *   ts                       => { lang: 'ts' }
 *   ts title="oxp.json"      => { lang: 'ts', filename: 'oxp.json' }
 *   bash title='install.sh'  => { lang: 'bash', filename: 'install.sh' }
 */
function parseFenceInfo(info: string): { lang?: string; filename?: string } {
  if (!info) return {};
  const titleMatch = /title=("([^"]+)"|'([^']+)')/.exec(info);
  const filename = titleMatch ? titleMatch[2] || titleMatch[3] : undefined;
  const stripped = info.replace(/title=("[^"]+"|'[^']+')/, "").trim();
  const lang = stripped ? stripped.split(/\s+/)[0] : undefined;
  return { lang, filename };
}

type CalloutVariant = "note" | "tip" | "warning" | "danger" | "info";

const calloutMeta: Record<
  CalloutVariant,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  note: { label: "Note", Icon: MessageSquare },
  tip: { label: "Tip", Icon: Lightbulb },
  info: { label: "Info", Icon: Info },
  warning: { label: "Warning", Icon: AlertTriangle },
  danger: { label: "Danger", Icon: ShieldAlert },
};

function Callout({
  variant,
  title,
  children,
}: {
  variant: CalloutVariant;
  title?: string;
  children: React.ReactNode;
}) {
  const { label, Icon } = calloutMeta[variant];
  return (
    <aside
      data-variant={variant}
      className="doc-callout my-6 rounded-md border px-4 py-3"
    >
      <div className="doc-callout-head mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
        <Icon className="h-3.5 w-3.5" />
        <span>{title || label}</span>
      </div>
      <div className="doc-callout-body">{children}</div>
    </aside>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, idx) => {
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={idx}
          className="doc-inline-code rounded px-1.5 py-0.5 text-[0.95em] font-mono"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return (
      <React.Fragment key={idx}>{renderRichInline(p, idx)}</React.Fragment>
    );
  });
}

function renderRichInline(text: string, baseKey: number): React.ReactNode {
  const re = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(_([^_]+)_)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const href = m[3];
      const label = m[2];
      const isExternal = /^https?:\/\//.test(href);
      out.push(
        <a
          key={`${baseKey}-${k++}`}
          href={href}
          className="doc-link underline-offset-2 hover:underline"
          {...(isExternal ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {label}
        </a>,
      );
    } else if (m[4]) {
      out.push(
        <strong key={`${baseKey}-${k++}`} className="doc-strong font-semibold">
          {m[5]}
        </strong>,
      );
    } else if (m[6]) {
      out.push(
        <em key={`${baseKey}-${k++}`} className="doc-em italic">
          {m[7]}
        </em>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
