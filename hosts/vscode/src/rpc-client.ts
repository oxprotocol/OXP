/**
 * Tiny JSON-RPC 2.0 client over a child-process stdio pair.
 *
 * Mirrors `hosts/jetbrains/.../protocol/RpcClient.kt`: byte-counted
 * `Content-Length` framing, request/response correlated by numeric id,
 * notification (id-less) one-way send. Single-file on purpose — no
 * dependency on @oxprotocol/host-runtime, this talks to the Rust
 * `oxp-runtime` binary via stdio.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";

export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
};

type NotificationHandler = (method: string, params: unknown) => void;

export class RpcClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf: Buffer = Buffer.alloc(0);
  private notifHandler?: NotificationHandler;

  constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stdout.on("end", () =>
      this.failAll(new Error("runtime stdout closed")),
    );
    proc.on("exit", (code) =>
      this.failAll(new Error(`runtime exited (${code})`)),
    );
  }

  onNotification(handler: NotificationHandler): void {
    this.notifHandler = handler;
  }

  request<T>(method: string, params?: unknown, timeoutMs = 10_000): Promise<T> {
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params: params ?? null };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new RpcError(
            -32000,
            `timeout after ${timeoutMs}ms calling ${method}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.write(msg);
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params: params ?? null });
  }

  /** Close stdin — the runtime's reader loop only checks exit-flag between
   *  reads, so we have to provoke EOF for it to actually quit. */
  closeStdin(): void {
    if (!this.proc.stdin.destroyed) this.proc.stdin.end();
  }

  private write(msg: unknown): void {
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    const header = Buffer.from(
      `Content-Length: ${body.length}\r\n\r\n`,
      "ascii",
    );
    this.proc.stdin.write(header);
    this.proc.stdin.write(body);
  }

  private onData(chunk: Buffer): void {
    this.buf =
      this.buf.length === 0
        ? chunk
        : Buffer.concat([this.buf as Buffer, chunk]);
    while (this.buf.length > 0) {
      const sep = this.buf.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const headerText = this.buf.slice(0, sep).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!m) {
        // Bogus framing — drop until next sep so we don't hang forever.
        this.buf = this.buf.slice(sep + 4);
        continue;
      }
      const len = parseInt(m[1]!, 10);
      const total = sep + 4 + len;
      if (this.buf.length < total) return;
      const body = this.buf.slice(sep + 4, total).toString("utf8");
      this.buf = this.buf.slice(total);
      this.dispatch(body);
    }
  }

  private dispatch(text: string): void {
    let msg: {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    };
    try {
      msg = JSON.parse(text);
    } catch (e) {
      // Unparseable frame — best effort: ignore. Real bug? crash logs will show.
      return;
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (p.timer) clearTimeout(p.timer);
      if (msg.error)
        p.reject(
          new RpcError(msg.error.code, msg.error.message, msg.error.data),
        );
      else p.resolve(msg.result);
      return;
    }
    if (msg.method && this.notifHandler) {
      this.notifHandler(msg.method, msg.params);
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
