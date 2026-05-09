/**
 * Programmatic entry point for `@oxprotocol/cli`. Exposes individual subcommand
 * functions so wrapper packages (e.g. `create-oxp`, integrations, IDE
 * extensions) can invoke them without spawning a subprocess.
 *
 * The CLI binary in `cli.ts` parses argv and dispatches to these same
 * functions — keeping this module thin avoids drift.
 */

export { create } from "./commands/create.js";
export { pack } from "./commands/pack.js";
export { dev } from "./commands/dev.js";
export { login } from "./commands/login.js";
export { publish } from "./commands/publish.js";
export { install } from "./commands/install.js";
export { keygen } from "./commands/keygen.js";
export { token } from "./commands/token.js";
export { protocolRegister } from "./commands/protocol-register.js";

export { detectHosts, detectHost } from "./lib/host-detect.js";
export type { DetectedHost } from "./lib/host-detect.js";
export { ensureAdapter, ensureAdapters } from "./lib/host-adapter.js";
export type { AdapterStatus } from "./lib/host-adapter.js";
export { broadcast, notifyInboxPath } from "./lib/broadcast.js";
export type { NotifyEvent } from "./lib/broadcast.js";
export { parseOxpUrl, buildInstallUrl, OxpUrlError } from "./lib/oxp-url.js";
export type { ParsedOxpUrl, InstallUrl } from "./lib/oxp-url.js";
