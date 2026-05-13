/**
 * OXP Host Bridge — injected into every extension webview.
 *
 * This script provides the `window.oxp` API that extensions use to
 * interact with the IDE. It communicates with the host (JetBrains JCEF
 * handler or VS Code webview message handler) via postMessage RPC.
 *
 * Build: this file is compiled to a standalone IIFE and injected into
 * webviews before the extension's own HTML loads.
 *
 * @module @oxprotocol/sdk/bridge
 */

/* ────────────────────────────── types ────────────────────────────── */

export interface OxpBridgeFs {
  /** Read a file as UTF-8 text. Path is relative to workspace root. */
  read(path: string): Promise<string>;
  /** Read a file as raw bytes (base64-encoded). */
  readBytes(path: string): Promise<Uint8Array>;
  /** Write UTF-8 text to a file. */
  write(path: string, content: string): Promise<void>;
  /** List entries in a directory. */
  list(dir: string): Promise<string[]>;
  /** Check if a file or directory exists. */
  exists(path: string): Promise<boolean>;
  /** Get file metadata. */
  stat(path: string): Promise<{ size: number; isDir: boolean; mtimeMs: number }>;
}

export interface OxpBridgeShell {
  /** Execute a command and return the result. */
  exec(
    cmd: string,
    args?: string[],
    opts?: { cwd?: string; timeout?: number },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface OxpBridgeStorage {
  /** Get a stored value by key (extension-scoped). */
  get(key: string): Promise<string | null>;
  /** Set a stored value by key (extension-scoped). */
  set(key: string, value: string): Promise<void>;
  /** Delete a stored value. */
  delete(key: string): Promise<void>;
  /** List all stored keys. */
  keys(): Promise<string[]>;
}

export interface OxpBridgeNet {
  /** Make an HTTP request through the host (respects net.fetch permissions). */
  fetch(
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface OxpBridgeWorkspace {
  /** Get the workspace/project root path. */
  rootPath(): Promise<string>;
  /** Open a file in the IDE editor. */
  openFile(path: string, line?: number): Promise<void>;
}

export interface OxpBridgeUi {
  /** Show a notification/balloon in the IDE. */
  notify(message: string, type?: "info" | "warn" | "error"): void;
  /** Get the current IDE theme. */
  getTheme(): Promise<"dark" | "light">;
}

export interface OxpBridge {
  fs: OxpBridgeFs;
  shell: OxpBridgeShell;
  storage: OxpBridgeStorage;
  net: OxpBridgeNet;
  workspace: OxpBridgeWorkspace;
  ui: OxpBridgeUi;
  /** Extension metadata injected by the host. */
  meta: { extensionId: string; version: string };
}

/* ────────────────────────────── RPC core ────────────────────────────── */

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

let _reqId = 0;
const _pending = new Map<number, PendingRequest>();

/**
 * Send an RPC request to the host and return a promise for the result.
 * The host is expected to reply with a message of the form:
 *   { type: "oxp:response", id: number, result?: any, error?: string }
 */
function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++_reqId;
    _pending.set(id, { resolve, reject });

    const message = { type: "oxp:request", id, method, params };

    // JetBrains JCEF: uses window.__oxp_host_postMessage if injected.
    // VS Code webview: uses acquireVsCodeApi().postMessage().
    // Fallback: window.parent.postMessage (iframe mode).
    if (typeof (window as any).__oxp_host_postMessage === "function") {
      (window as any).__oxp_host_postMessage(JSON.stringify(message));
    } else if (typeof (window as any).__vscode !== "undefined") {
      (window as any).__vscode.postMessage(message);
    } else {
      window.parent.postMessage(message, "*");
    }

    // Timeout after 30s to avoid dangling promises.
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        reject(new Error(`OXP bridge timeout: ${method} (id=${id})`));
      }
    }, 30_000);
  });
}

/** Handle host responses. */
function handleHostMessage(data: any): void {
  if (!data || data.type !== "oxp:response") return;
  const pending = _pending.get(data.id);
  if (!pending) return;
  _pending.delete(data.id);

  if (data.error) {
    pending.reject(new Error(data.error));
  } else {
    pending.resolve(data.result);
  }
}

// Listen for messages from the host.
window.addEventListener("message", (event) => {
  handleHostMessage(event.data);
});

// JetBrains JCEF injects responses via __oxp_host_response(json).
(window as any).__oxp_host_response = (json: string) => {
  try {
    handleHostMessage(JSON.parse(json));
  } catch {
    /* malformed response — ignore */
  }
};

/* ────────────────────────────── API surface ────────────────────────────── */

const fs: OxpBridgeFs = {
  async read(path: string): Promise<string> {
    const res = (await rpc("fs/readFile", { path })) as { bytes: string };
    // Decode base64 to UTF-8 string.
    return atob(res.bytes);
  },
  async readBytes(path: string): Promise<Uint8Array> {
    const res = (await rpc("fs/readFile", { path })) as { bytes: string };
    const binary = atob(res.bytes);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },
  async write(path: string, content: string): Promise<void> {
    const bytes = btoa(content);
    await rpc("fs/writeFile", { path, bytes });
  },
  async list(dir: string): Promise<string[]> {
    const res = (await rpc("fs/listDir", { path: dir })) as { entries: string[] };
    return res.entries;
  },
  async exists(path: string): Promise<boolean> {
    try {
      await rpc("fs/stat", { path });
      return true;
    } catch {
      return false;
    }
  },
  async stat(path: string): Promise<{ size: number; isDir: boolean; mtimeMs: number }> {
    return (await rpc("fs/stat", { path })) as any;
  },
};

const shell: OxpBridgeShell = {
  async exec(cmd, args = [], opts = {}): Promise<{ code: number; stdout: string; stderr: string }> {
    return (await rpc("shell/exec", { cmd, args, cwd: opts.cwd, timeout: opts.timeout })) as any;
  },
};

const storage: OxpBridgeStorage = {
  async get(key: string): Promise<string | null> {
    const res = (await rpc("storage/get", { key })) as { value: string | null };
    if (res.value == null) return null;
    // Storage values are base64-encoded by the host.
    try {
      return atob(res.value);
    } catch {
      return res.value;
    }
  },
  async set(key: string, value: string): Promise<void> {
    await rpc("storage/set", { key, value: btoa(value) });
  },
  async delete(key: string): Promise<void> {
    await rpc("storage/delete", { key });
  },
  async keys(): Promise<string[]> {
    const res = (await rpc("storage/keys", {})) as { keys: string[] };
    return res.keys;
  },
};

const net: OxpBridgeNet = {
  async fetch(url, opts = {}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const headers = opts.headers
      ? Object.entries(opts.headers).map(([k, v]) => [k, v])
      : [];
    const bodyB64 = opts.body ? btoa(opts.body) : undefined;
    const res = (await rpc("net/fetch", {
      url,
      method: opts.method ?? "GET",
      headers,
      body: bodyB64,
    })) as { status: number; headers: [string, string][]; body: string };
    // Convert header tuples to a plain object.
    const hdr: Record<string, string> = {};
    if (Array.isArray(res.headers)) {
      for (const [k, v] of res.headers) hdr[k] = v;
    }
    return { status: res.status, headers: hdr, body: atob(res.body) };
  },
};

const workspace: OxpBridgeWorkspace = {
  async rootPath(): Promise<string> {
    const res = (await rpc("workspace/rootPath", {})) as { path: string };
    return res.path;
  },
  async openFile(path: string, line?: number): Promise<void> {
    await rpc("workspace/openFile", { path, line });
  },
};

const ui: OxpBridgeUi = {
  notify(message: string, type: "info" | "warn" | "error" = "info"): void {
    // Fire-and-forget — no response needed.
    rpc("ui/notify", { message, type }).catch(() => {});
  },
  async getTheme(): Promise<"dark" | "light"> {
    const res = (await rpc("ui/getTheme", {})) as { theme: "dark" | "light" };
    return res.theme;
  },
};

/* ────────────────────────────── global export ────────────────────────────── */

const bridge: OxpBridge = {
  fs,
  shell,
  storage,
  net,
  workspace,
  ui,
  meta: {
    extensionId: (window as any).__oxp_extension_id ?? "",
    version: (window as any).__oxp_extension_version ?? "",
  },
};

// Expose as window.oxp for extension HTML/JS code.
(window as any).oxp = bridge;

// Also export for module consumers.
export default bridge;
export { bridge };
