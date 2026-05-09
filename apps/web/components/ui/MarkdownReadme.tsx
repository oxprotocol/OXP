import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Premium README renderer for VSX-mirrored extensions.
 *
 * Styled to match the OXP cyan dev-tool aesthetic:
 *   - Headings get a `// h1` mono-prefix and a thin cyan underline.
 *   - Inline code is pill-shaped with a phosphor tint.
 *   - Fenced code blocks are dark surfaces with a left bar.
 *   - Links are cyan with hover.
 *   - Tables, lists, blockquotes all themed.
 *
 * All text is `text-xs` minimum per the project style rules.
 */
export function MarkdownReadme({ source }: { source: string }) {
  return (
    <div className="oxp-md font-mono text-xs text-[#f8fafc]/75 leading-relaxed max-h-[700px] overflow-y-auto pr-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Disable raw HTML entirely — Open VSX READMEs are user input.
        skipHtml
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-3 first:mt-0 text-base font-bold text-[#f8fafc] flex items-baseline gap-2 border-b border-[#7DD3FC]/15 pb-2">
              <span className="text-[#7DD3FC]/40 select-none">#</span>
              <span>{children}</span>
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 mb-3 text-sm font-bold text-[#f8fafc] flex items-baseline gap-2 border-b border-[#7DD3FC]/10 pb-1.5">
              <span className="text-[#7DD3FC]/40 select-none">##</span>
              <span>{children}</span>
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-5 mb-2 text-xs font-bold uppercase tracking-wider text-[#7DD3FC]/80 flex items-baseline gap-2">
              <span className="text-[#7DD3FC]/40 select-none">###</span>
              <span>{children}</span>
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 mb-2 text-xs font-bold text-[#f8fafc]/90">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="my-3 text-xs text-[#f8fafc]/70 leading-[1.7]">
              {children}
            </p>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#7DD3FC] hover:text-[#BAE6FD] underline-offset-2 hover:underline break-words"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="my-3 space-y-1.5 list-none pl-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 space-y-1.5 list-decimal list-inside text-xs text-[#f8fafc]/70">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-xs text-[#f8fafc]/70 leading-[1.6] flex gap-2">
              <span className="text-[#7DD3FC]/40 select-none flex-shrink-0">
                ›
              </span>
              <span className="min-w-0">{children}</span>
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-[#7DD3FC]/40 bg-[#7DD3FC]/5 px-3 py-2 text-xs text-[#f8fafc]/60 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-5 border-[#7DD3FC]/10" />,
          code: ({ className, children, ...props }) => {
            // Block code uses a `language-*` className from remark.
            const isBlock = /language-/.test(className || "");
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="px-1.5 py-0.5 rounded bg-[#7DD3FC]/8 border border-[#7DD3FC]/15 text-[#BAE6FD] text-xs font-mono">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-4 p-4 rounded border border-[#7DD3FC]/10 bg-[#030711] overflow-x-auto text-xs leading-relaxed text-[#f8fafc]/85 border-l-2 border-l-[#7DD3FC]/40">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded border border-[#7DD3FC]/10">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#030711]/60 border-b border-[#7DD3FC]/10">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-mono uppercase tracking-wider text-[#7DD3FC]/70 text-xs">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-xs text-[#f8fafc]/70 border-t border-[#7DD3FC]/8">
              {children}
            </td>
          ),
          img: ({ src, alt }) =>
            src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt || ""}
                className="my-3 rounded border border-[#7DD3FC]/10 max-w-full h-auto"
                loading="lazy"
              />
            ) : null,
          strong: ({ children }) => (
            <strong className="font-bold text-[#f8fafc]/95">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-[#f8fafc]/80">{children}</em>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
