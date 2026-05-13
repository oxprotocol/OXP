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
  /**
   * Dev-mode: auto-stamp the bundle's existing inline <script> and <style>
   * tags with the per-render nonce so the developer's own bundled code runs
   * under CSP. This is the same trust model as `oxp dev` signature-bypass
   * (the bundle is the author's WIP). NEVER set this in production / marketplace flow.
   */
  dev?: boolean;
  /**
   * Trusted installed bundle: the extension was signature-verified by the OXP
   * store (TOFU + Ed25519). Inline scripts in the bundle are safe to nonce —
   * the signature guarantees they haven't been tampered with post-publish.
   * This enables single-file esbuild bundles (oxp-ui-only mode) to execute
   * without requiring authors to manage nonces manually.
   */
  trusted?: boolean;
}

export type RenderOutcome =
  | { kind: "html"; html: string; nonce: string }
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
function buildCsp(
  webview: vscode.Webview,
  nonce: string,
  dev: boolean = false,
): string {
  const src = webview.cspSource;
  // In dev we allow https: for styles/fonts/connect so common patterns
  // (Google Fonts `@import`, asset CDNs, dev-server fetches) work
  // without the author having to think about CSP yet. PROD stays
  // deny-by-default. This is the same trust-the-dev-bundle stance as
  // signature bypass.
  const styleHttps = dev ? " https:" : "";
  const fontHttps = dev ? " https:" : "";
  // Dev allows unsafe-eval because most JS bundlers (esbuild sourcemaps,
  // Vite HMR shims, many React libs that ship `new Function()` for safe
  // expression eval) trigger CSP violations otherwise. PROD never gets eval.
  const scriptExtras = dev ? " 'unsafe-eval'" : "";
  const connectSrc = dev
    ? `connect-src ${src} https: ws: wss:`
    : `connect-src 'none'`;
  return [
    `default-src 'none'`,
    `script-src ${src} 'nonce-${nonce}'${scriptExtras}`,
    `style-src ${src} 'nonce-${nonce}' 'unsafe-inline'${styleHttps}`,
    `img-src ${src} data: https:`,
    `font-src ${src} data:${fontHttps}`,
    connectSrc,
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
  dev: boolean,
): string {
  const csp = buildCsp(webview, nonce, dev);
  const bootstrap = dev ? buildDevBootstrap(nonce) : "";
  return `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta http-equiv="X-Content-Type-Options" content="nosniff" />
<meta name="referrer" content="no-referrer" />
${bootstrap}</head><body style="${bodyStyle}">${body}</body></html>`;
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
      html: wrapHtml(
        body,
        input.webview,
        nonce,
        "margin:0;padding:16px",
        !!input.dev,
      ),
      nonce,
    };
  }

  // HTML mode (escape-hatch / oxp-ui-only). We rewrite asset URLs and inject
  // CSP. Inline <script> and <style> tags get the nonce stamped when:
  //   - dev mode: the author's WIP bundle (same trust as signature-bypass), OR
  //   - trusted: bundle from the verified OXP store (Ed25519 + TOFU — inline
  //     scripts are guaranteed untampered, so nonce-stamping is safe here too).
  // Without either flag the inline tags run nonce-less and CSP blocks them.
  const bytes = await input.read(uiRel);
  let html = new TextDecoder().decode(bytes);
  html = rewriteAssetUrls(html, input.webview, input.resourceRoot, uiRel);
  if (input.dev || input.trusted) html = stampInlineNonces(html, nonce);
  html = injectCspMeta(html, input.webview, nonce, !!input.dev);
  if (input.dev) html = injectDevBootstrap(html, nonce);
  return { kind: "html", html, nonce };
}

/**
 * Dev-only: add `nonce="..."` to every <script> and <style> tag in the
 * bundle that doesn't already carry one. Lets the author's own inline
 * bundled JS/CSS execute under CSP without forcing them to manage nonces
 * by hand during iteration. PROD must never call this.
 *
 * IMPORTANT: We must NOT do a naive global regex over the document —
 * minified JS bundles legitimately contain string literals like
 * `"<script><\/script>"` (React uses one to detect IE quirks) and a
 * blind regex would rewrite that string, producing
 * `"<script nonce=\"…\"><\/script>"` which is invalid JavaScript. The
 * walker below only stamps *real* opening tags, skipping everything
 * between a `<script>`/`<style>` open tag and its matching close tag.
 */
function stampInlineNonces(html: string, nonce: string): string {
  // Match either an opening <script>/<style> (capturing whole tag + body
  // up to its close) OR every other character. We can rewrite the open
  // tag, then re-emit the body and close tag unchanged.
  return html.replace(
    /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    (_full, tag: string, attrs: string, body: string) => {
      const hasNonce = /\bnonce\s*=/.test(attrs);
      const openTag = hasNonce
        ? `<${tag}${attrs}>`
        : `<${tag}${attrs} nonce="${nonce}">`;
      return `${openTag}${body}</${tag}>`;
    },
  );
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
  dev: boolean,
): string {
  const csp = buildCsp(webview, nonce, dev);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" /><meta http-equiv="X-Content-Type-Options" content="nosniff" /><meta name="referrer" content="no-referrer" />`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  }
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

/**
 * Dev-only: splice the in-page error-boundary script into <head>.
 * The boundary catches uncaught errors and unhandled promise rejections,
 * shows a dark, dismissable overlay in the webview, AND postMessages
 * `{kind:"oxp:dev:error", message, stack}` to the host so the failure
 * also lands in the dev Output channel. Prod must never call this.
 */
function injectDevBootstrap(html: string, nonce: string): string {
  const script = buildDevBootstrap(nonce);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<\/head>/i, `${script}</head>`);
  }
  return `${script}${html}`;
}

function buildDevBootstrap(nonce: string): string {
  // Keep this string self-contained — it executes inside the bundled
  // webview before the author's code. No dependencies, no globals.
  // Style and copy are intentionally restrained so author error stacks
  // stay readable on small sidebar widths.
  const body = `
(function () {
  var vs = null;
  try { vs = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null; } catch (_) {}
  var overlay = null;
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = '__oxp_dev_err__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,17,23,0.96);color:#e8e8e8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.45;padding:16px;overflow:auto;display:none;border-left:3px solid #f87171';
    overlay.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong style="color:#f87171;font-size:13px">\u26a0 Extension runtime error</strong><button type="button" id="__oxp_dev_err_close__" style="background:transparent;border:1px solid #3f3f46;color:#e8e8e8;border-radius:3px;padding:2px 8px;cursor:pointer;font:inherit">close</button></div><div id="__oxp_dev_err_msg__" style="color:#f87171;white-space:pre-wrap;margin-bottom:8px"></div><pre id="__oxp_dev_err_stack__" style="white-space:pre-wrap;color:#a1a1aa;margin:0"></pre>';
    function appendWhenReady() {
      if (document.body) {
        document.body.appendChild(overlay);
        var btn = document.getElementById('__oxp_dev_err_close__');
        if (btn) btn.addEventListener('click', function () { overlay.style.display = 'none'; });
      } else {
        document.addEventListener('DOMContentLoaded', appendWhenReady, { once: true });
      }
    }
    appendWhenReady();
    return overlay;
  }
  function report(message, stack) {
    var el = ensureOverlay();
    var m = document.getElementById('__oxp_dev_err_msg__');
    var s = document.getElementById('__oxp_dev_err_stack__');
    if (m) m.textContent = String(message || 'Unknown error');
    if (s) s.textContent = String(stack || '');
    if (el) el.style.display = 'block';
    try { if (vs) vs.postMessage({ kind: 'oxp:dev:error', message: String(message || ''), stack: String(stack || '') }); } catch (_) {}
  }
  window.addEventListener('error', function (e) {
    var err = e && e.error;
    report((err && err.message) || e.message, (err && err.stack) || '');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    var msg = (r && r.message) || (typeof r === 'string' ? r : 'Unhandled promise rejection');
    var stack = (r && r.stack) || '';
    report(msg, stack);
  });
})();
`;
  return `<script nonce="${nonce}">${body}</script>`;
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
