"use client";

import React, { useState, useCallback, useMemo } from "react";
import { Check, Copy } from "lucide-react";
import { highlight } from "@/lib/highlight";

interface CodeBlockProps {
  code: string;
  lang?: string;
  filename?: string;
}

/**
 * Tech-doc style code block: filename bar on top, language badge, copy button,
 * and lightweight syntax highlighting.
 */
export function CodeBlock({ code, lang, filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  }, [code]);

  const tokens = useMemo(() => highlight(code, lang), [code, lang]);

  const showHeader = Boolean(filename) || Boolean(lang);

  return (
    <figure className="doc-codeblock my-5 overflow-hidden rounded-md border">
      {showHeader && (
        <header className="doc-codeblock-head flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {filename && (
              <span className="doc-codeblock-file truncate font-mono text-xs">
                {filename}
              </span>
            )}
            {lang && (
              <span className="doc-codeblock-lang rounded px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide">
                {lang}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? "Copied" : "Copy code"}
            className="doc-codeblock-copy inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy
              </>
            )}
          </button>
        </header>
      )}
      <pre
        data-lang={lang || undefined}
        className="doc-code overflow-x-auto px-4 py-3 text-[14px] leading-relaxed font-mono"
      >
        <code>
          {tokens.map((t, i) =>
            t.type === "plain" ? (
              <React.Fragment key={i}>{t.value}</React.Fragment>
            ) : (
              <span key={i} className={`tok tok-${t.type}`}>
                {t.value}
              </span>
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
