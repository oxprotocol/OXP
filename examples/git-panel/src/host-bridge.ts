/**
 * Host capability bridge — webview side.
 *
 * Posts `oxp:cap:invoke` messages to the host (VS Code dev session
 * wires this in `hosts/vscode/src/dev-session.ts`; JetBrains parity is
 * tracked separately) and resolves promises when matching
 * `oxp:cap:result` messages arrive.
 *
 * Capabilities exposed in dev today (read-only, workspace-scoped):
 *   - `fs.read(path)`        → Uint8Array
 *   - `fs.list(path)`        → Array<{ name, kind }>
 *   - `fs.stat(path)`        → { size, mtimeMs, isDir }
 *   - `workspace.root()`     → absolute fsPath
 *
 * The extension's `oxp.json#permissions` MUST include `"fs.read"` for
 * fs.* calls to be granted; otherwise the host replies with a
 * permission-denied error.
 */

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

let vscodeApi: VsCodeApi | null = null;
function api(): VsCodeApi {
  if (!vscodeApi) vscodeApi = acquireVsCodeApi();
  return vscodeApi;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}
const pending = new Map<string, PendingCall>();
let seq = 0;

window.addEventListener("message", (ev) => {
  const m = ev.data;
  if (!m || m.kind !== "oxp:cap:result") return;
  const call = pending.get(m.id);
  if (!call) return;
  pending.delete(m.id);
  if (m.ok) call.resolve(m.value);
  else call.reject(new Error(m.error || "capability call failed"));
});

function invoke<T>(capability: string, args: unknown = {}): Promise<T> {
  const id = `c${++seq}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    api().postMessage({ kind: "oxp:cap:invoke", id, capability, args });
    // Sanity timeout — bridge may not be wired (e.g. extension opened
    // outside dev). Fail loud rather than hang the UI.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(
          new Error(
            `host bridge did not respond within 4s for '${capability}' — is this running under \`oxp dev\`?`,
          ),
        );
      }
    }, 4000);
  });
}

export const host = {
  workspaceRoot: () =>
    invoke<{ path: string }>("workspace.root").then((v) => v.path),

  /** Read a workspace-relative file. Returns raw bytes. */
  readFile: async (path: string): Promise<Uint8Array> => {
    const v = await invoke<{ bytes: string; size: number }>("fs.read", {
      path,
    });
    // atob → binary string → Uint8Array
    const bin = atob(v.bytes);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },

  /** Read a workspace-relative file as UTF-8 text. */
  readText: async (path: string): Promise<string> => {
    const bytes = await host.readFile(path);
    return new TextDecoder("utf-8").decode(bytes);
  },

  list: (path: string) =>
    invoke<{
      entries: Array<{ name: string; kind: "file" | "dir" | "other" }>;
    }>("fs.list", { path }).then((v) => v.entries),

  stat: (path: string) =>
    invoke<{ size: number; mtimeMs: number; isDir: boolean }>("fs.stat", {
      path,
    }),
};
