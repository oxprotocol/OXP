/**
 * Typed TS mirror of the `oxp:host@0.1.0` WIT interfaces. Backends
 * adapt their wasmtime/jco bindgen output into shapes that match these
 * types so the broker's permission gating logic stays backend-agnostic.
 *
 * Keep this file in lockstep with `packages/wit/wit/oxp-host.wit`. If
 * you add an interface here, also add a `Permission` constant for it
 * and update the WIT pin (the SHA changes → manifests must rebuild).
 */

// ── log ──────────────────────────────────────────────────────────────
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
export interface LogCapability {
  log(level: LogLevel, message: string): void;
}

// ── storage ──────────────────────────────────────────────────────────
export interface StorageCapability {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

// ── ui ───────────────────────────────────────────────────────────────
export interface UiCapability {
  /** Push a serialized oxp-ui-v1 tree (msgpack or JSON; host decides). */
  render(tree: Uint8Array): Promise<void>;
  setStatus(text: string, tooltip?: string): Promise<void>;
  /** Show a toast; resolves to the user's button choice or undefined. */
  notify(
    message: string,
    buttons?: readonly string[],
  ): Promise<string | undefined>;
}

// ── fs (gated) ───────────────────────────────────────────────────────
export type FsErrorTag = "not-found" | "forbidden" | "io" | "too-large";
export interface FsError {
  tag: FsErrorTag;
  message?: string;
  bytes?: number;
}
export interface FsStat {
  size: number;
  isDir: boolean;
  mtimeMs: number;
}
export interface FsCapability {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  stat(path: string): Promise<FsStat>;
  listDir(path: string): Promise<string[]>;
}

// ── net (gated) ──────────────────────────────────────────────────────
export interface HttpRequest {
  method: string;
  url: string;
  headers: ReadonlyArray<readonly [string, string]>;
  body?: Uint8Array;
}
export interface HttpResponse {
  status: number;
  headers: ReadonlyArray<readonly [string, string]>;
  body: Uint8Array;
}
export type NetErrorTag = "forbidden" | "timeout" | "transport" | "too-large";
export interface NetError {
  tag: NetErrorTag;
  message?: string;
  bytes?: number;
}
export interface NetCapability {
  fetch(req: HttpRequest): Promise<HttpResponse>;
}

// ── secrets (gated) ──────────────────────────────────────────────────
export interface SecretsCapability {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// ── commands (gated) ─────────────────────────────────────────────────
export interface CommandsCapability {
  execute(id: string, argsJson: string): Promise<string>;
}

/**
 * The full host-import surface. Backends instantiate components against
 * this exact object shape (after the broker has wrapped each capability
 * in its permission gate).
 *
 * Always-on interfaces are non-optional. Gated interfaces are optional
 * because the broker omits them entirely when the matching permission
 * is not granted — a missing import is what makes a Wasm component
 * literally unable to call the function.
 */
export interface CapabilityBroker {
  /** Always available. */
  readonly log: LogCapability;
  /** Always available. */
  readonly storage: StorageCapability;
  /** Always available. */
  readonly ui: UiCapability;

  /** Present iff `fs.read|write|delete` granted. */
  readonly fs?: FsCapability;
  /** Present iff `net.fetch` granted. */
  readonly net?: NetCapability;
  /** Present iff `secrets.read|write` granted. */
  readonly secrets?: SecretsCapability;
  /** Present iff `commands.executeHost` granted. */
  readonly commands?: CommandsCapability;
}
