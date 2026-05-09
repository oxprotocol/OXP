#!/usr/bin/env node
/**
 * `oxp` — Open eXtensions Protocol command-line tool.
 *
 * Subcommands:
 *   oxp create <name>       scaffold a new extension from the hello-world template
 *   oxp pack [dir]          build a deterministic, signed .oxp bundle from the project
 *   oxp login               store an API token under ~/.oxp/credentials
 *   oxp publish [bundle]    POST a .oxp + signature to the registry
 *   oxp keygen              show the local Ed25519 key id (creating one if needed)
 *
 * No external CLI library — keeps install lean.
 */

import { create } from "./commands/create.js";
import { pack } from "./commands/pack.js";
import { dev } from "./commands/dev.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { whoami } from "./commands/whoami.js";
import { publish } from "./commands/publish.js";
import { install } from "./commands/install.js";
import { installUrl } from "./commands/install-url.js";
import { keygen } from "./commands/keygen.js";
import { token } from "./commands/token.js";
import { protocolRegister } from "./commands/protocol-register.js";
import { doctor } from "./commands/doctor.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/cli.js → ../package.json
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = readVersion();

const HELP = `oxp ${VERSION} — Open eXtensions Protocol

Usage:
  oxp create [-t TPL] <name> Scaffold a new extension in ./<name>
                             Templates: hello-html (default), hello-code, hello-tree
  oxp dev [dir]              Watch + repack + serve over ws/http (default port 7373)
  oxp pack [dir]             Build dist/<slug>-<version>.oxp from <dir> (default: cwd)
  oxp login                  Sign in (email + password in terminal)
  oxp login --browser        Sign in via browser (OAuth device flow)
  oxp logout [--local-only]  Revoke local credentials (and the server token by default)
  oxp whoami [--json]        Show the identity behind the local credentials
  oxp token rotate           Mint a successor token; old token gets a 5-min grace
  oxp publish [bundle]       Upload a .oxp + signature to the registry
  oxp publish --dry-run      Validate the bundle but do not POST
  oxp install <id> [-y]      Install @publisher/slug from the registry into
                             $OXP_HOME/host-store/, auto-detect IDEs, and
                             keep their host adapters in sync.
  oxp install --from <url>   Install from an oxp:// deep link
  oxp install-url <wasm-url> Install a raw .wasm component (https/file/http)
                             into the shared host-store. Both VS Code and
                             JetBrains hosts pick it up automatically.
  oxp install-url --list     List previously URL-installed extensions
  oxp protocol-register      Register the oxp:// URL scheme on this machine
  oxp doctor [--json]        Inspect this machine and report what OXP can see
  oxp keygen                 Print the local Ed25519 publisher key id
  oxp help                   Show this message
  oxp version                Print version

Environment:
  OXP_REGISTRY               Registry base URL (default http://localhost:3000)
  OXP_HOME                   Config dir (default ~/.oxp)
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return 0;
    case "version":
    case "-v":
    case "--version":
      process.stdout.write(VERSION + "\n");
      return 0;
    case "create":
      return create(rest);
    case "dev":
      return dev(rest);
    case "pack":
      return pack(rest);
    case "login":
      return login(rest);
    case "logout":
      return logout(rest);
    case "whoami":
      return whoami(rest);
    case "token":
      return token(rest);
    case "publish":
      return publish(rest);
    case "install":
      return install(rest);
    case "install-url":
      return installUrl(rest);
    case "protocol-register":
      return protocolRegister(rest);
    case "doctor":
      return doctor(rest);
    case "keygen":
      return keygen(rest);
    default:
      process.stderr.write(`oxp: unknown command '${cmd}'\n\n` + HELP);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`oxp: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
