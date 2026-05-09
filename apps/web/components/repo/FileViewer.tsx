import { File as FileIcon } from "lucide-react";
import { codeToHtml, bundledLanguages, type BundledLanguage } from "shiki";
import type { RepoFile } from "@/lib/repos";

const LANG_MAP: Record<string, BundledLanguage> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  go: "go",
  java: "java",
  css: "css",
  html: "html",
  prisma: "prisma",
  sql: "sql",
};

function resolveLang(language: string): BundledLanguage {
  const key = language.toLowerCase();
  if (LANG_MAP[key]) return LANG_MAP[key];
  if (key in bundledLanguages) return key as BundledLanguage;
  return "plaintext" as BundledLanguage;
}

export async function FileViewer({ file }: { file: RepoFile }) {
  const lines = file.content.split("\n");
  const lang = resolveLang(file.language);

  // Dual themes: Shiki emits CSS variables (--shiki / --shiki-light) so the
  // viewer flips with the global light/dark toggle. See globals.css for the
  // light-mode bg override below `.shiki-viewer`.
  const html = await codeToHtml(file.content, {
    lang,
    themes: {
      dark: "github-dark-default",
      light: "github-light",
    },
    defaultColor: false,
  });

  const lineMatches =
    html.match(
      /<span class="line">([\s\S]*?)<\/span>(?=<span class="line">|<\/code>|<\/pre>)/g,
    ) ?? [];
  const highlighted = lineMatches.map((m) =>
    m.replace(/^<span class="line">/, "").replace(/<\/span>$/, ""),
  );

  return (
    <div className="hud-card hud-corners overflow-hidden shiki-viewer">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-[#7DD3FC]/10 bg-[#030711]/60 shiki-viewer-header">
        <div className="flex items-center gap-3 font-mono">
          <FileIcon className="w-4 h-4 text-[#7DD3FC]/60" />
          <span className="text-sm text-[#f8fafc]/80 font-semibold">
            {file.name}
          </span>
          <span className="text-[12px] uppercase tracking-wider text-[#7DD3FC] border border-[#7DD3FC]/25 bg-[#7DD3FC]/10 rounded px-2 py-0.5 font-bold">
            {file.language}
          </span>
        </div>
        <div className="text-xs font-mono text-[#f8fafc]/60 tracking-wider uppercase">
          {lines.length} lines · {file.size} B
        </div>
      </div>

      <div className="shiki-viewer-body overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[14px] leading-[1.7]">
          <tbody>
            {lines.map((_, i) => (
              <tr key={i} className="shiki-viewer-row">
                <td className="shiki-viewer-gutter select-none text-right pr-5 pl-5 align-top w-14">
                  {i + 1}
                </td>
                <td
                  className="whitespace-pre pr-8 py-px"
                  dangerouslySetInnerHTML={{
                    __html:
                      highlighted[i] && highlighted[i].length > 0
                        ? highlighted[i]
                        : "&nbsp;",
                  }}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
