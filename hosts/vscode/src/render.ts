/**
 * Pick the right renderer for a bundle's main.ui:
 *
 *   - If `ui.components === "oxp-ui-v1"` AND main.ui ends in `.json`, parse
 *     it as a `UiTree` (frozen V1 component vocab) and render via
 *     `@oxprotocol/ui/dom`. No JS runs from the bundle — this is the static-tree
 *     mode and is safe to render even before the worker harness ships.
 *
 *   - Otherwise treat main.ui as an HTML file and rewrite relative asset
 *     URLs through `webview.asWebviewUri()`.
 */

import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
// esbuild honours `@oxprotocol/ui`'s `exports` map (./dom). tsc with
// `moduleResolution: Node` doesn't, so it can't see the subpath even though
// it resolves at build time. The host runs CJS (VS Code requirement) so we
// can't switch to Node16/Bundler resolution without a wider refactor — silence
// the one false positive here.
// @ts-expect-error — see comment above
import { renderTreeToHtml } from "@oxprotocol/ui/dom";

/**
 * Renderer only needs `main.ui` and `ui.components`. Accept any shape that
 * carries those — `OxpManifest` (strict author-side type) and
 * `VerifiedBundle.manifest` (`ManifestCommon & Record<string, unknown>`)
 * both satisfy this without forcing a cast at call sites.
 */
export type RenderManifest = {
  main?: { ui?: string; entry?: string; wasm?: string };
  ui?: { components?: string; preferredSurface?: string };
};

export interface RenderInput {
  manifest: RenderManifest;
  /** Root resource URI (for HTML asset rewriting). */
  resourceRoot: vscode.Uri;
  /** Webview to rewrite URIs against. */
  webview: vscode.Webview;
  /** Read a bundled file as bytes. */
  read(rel: string): Promise<Uint8Array>;
}

export type RenderOutcome =
  | { kind: "html"; html: string }
  | { kind: "empty"; reason: string };

/**
 * Phase A.5 — strict Content-Security-Policy enforced via <meta http-equiv>
 * on every rendered webview, regardless of mode.
 *
 * Defaults are deny-all. We allow:
 *   - script-src: webview cspSource + per-render nonce (no inline, no eval)
 *   - style-src:  webview cspSource + per-render nonce + 'unsafe-inline'
 *                 for the @oxprotocol/ui base stylesheet (small, trusted, audited)
 *   - img-src:    webview cspSource + data: + https: (extensions ship icons)
 *   - font-src:   webview cspSource
 *   - connect-src: 'none' until Phase A.4 grants per-host network access
 *   - frame-src / frame-ancestors / object-src: 'none'
 */
function buildCsp(webview: vscode.Webview, nonce: string): string {
  const src = webview.cspSource;
  return [
    `default-src 'none'`,
    `script-src ${src} 'nonce-${nonce}'`,
    `style-src ${src} 'nonce-${nonce}' 'unsafe-inline'`,
    `img-src ${src} data: https:`,
    `font-src ${src}`,
    `connect-src 'none'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join("; ");
}

function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

function wrapHtml(
  body: string,
  webview: vscode.Webview,
  nonce: string,
  bodyStyle: string,
): string {
  const csp = buildCsp(webview, nonce);
  return `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta http-equiv="X-Content-Type-Options" content="nosniff" />
<meta name="referrer" content="no-referrer" />
</head><body style="${bodyStyle}">${body}</body></html>`;
}

export async function renderMainUi(input: RenderInput): Promise<RenderOutcome> {
  const uiRel = input.manifest.main?.ui;
  if (!uiRel) {
    return { kind: "empty", reason: "no main.ui (code-only extension)" };
  }

  const nonce = newNonce();
  const components = input.manifest.ui?.components;

  if (components === "oxp-ui-v1" && uiRel.endsWith(".json")) {
    const bytes = await input.read(uiRel);
    let tree: unknown;
    try {
      tree = JSON.parse(new TextDecoder().decode(bytes));
    } catch (err) {
      return {
        kind: "empty",
        reason: `failed to parse ${uiRel}: ${(err as Error).message}`,
      };
    }
    let body: string;
    try {
      body = renderTreeToHtml(tree as never);
    } catch (err) {
      return {
        kind: "empty",
        reason: (err as Error).message,
      };
    }
    return {
      kind: "html",
      html: wrapHtml(body, input.webview, nonce, "margin:0;padding:16px"),
    };
  }

  // HTML mode (escape-hatch). We rewrite asset URLs and inject CSP. Inline
  // <script> and <style> WITHOUT a matching nonce will be blocked by CSP;
  // authors are responsible for nonce'ing or externalising their tags.
  const bytes = await input.read(uiRel);
  let html = new TextDecoder().decode(bytes);
  html = rewriteAssetUrls(html, input.webview, input.resourceRoot, uiRel);
  html = injectCspMeta(html, input.webview, nonce);
  return { kind: "html", html };
}

/**
 * If the bundle's HTML already has a <head>, splice CSP + nonce into it.
 * If it doesn't, wrap the document.
 *
 * NOTE: we deliberately do NOT auto-stamp nonces onto the bundle's existing
 * <script> / <style> tags. Doing so would silently bypass the CSP for any
 * malicious inline script the author might have injected. Instead, authors
 * who need inline code must reference `data-oxp-nonce` (future API) or
 * externalise into a .js file.
 */
function injectCspMeta(
  html: string,
  webview: vscode.Webview,
  nonce: string,
): string {
  const csp = buildCsp(webview, nonce);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" /><meta http-equiv="X-Content-Type-Options" content="nosniff" /><meta name="referrer" content="no-referrer" />`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  }
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

export function rewriteAssetUrls(
  html: string,
  webview: vscode.Webview,
  root: vscode.Uri,
  indexRel: string,
): string {
  const baseDir = indexRel.includes("/")
    ? indexRel.slice(0, indexRel.lastIndexOf("/"))
    : "";
  const resolveRel = (p: string): string => {
    if (/^([a-z]+:|\/\/|#|data:)/i.test(p)) return p;
    const rel = p.startsWith("/")
      ? p.slice(1)
      : baseDir
        ? `${baseDir}/${p}`
        : p;
    const uri = vscode.Uri.joinPath(root, ...rel.split("/"));
    return webview.asWebviewUri(uri).toString();
  };
  return html.replace(
    /\b(src|href)=("([^"]+)"|'([^']+)')/g,
    (
      _match,
      attr: string,
      _q: string,
      dq: string | undefined,
      sq: string | undefined,
    ) => {
      const v = (dq ?? sq) as string;
      return `${attr}="${resolveRel(v)}"`;
    },
  );
}
