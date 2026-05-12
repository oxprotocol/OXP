/**
 * Serves the shell installer script for `curl -fsSL https://oxp.sh/install | sh`.
 *
 * The script lives in the repo at `scripts/install.sh`. Vercel can't read
 * arbitrary repo files at runtime, so we inline it at build time.
 *
 * IMPORTANT: keep this file's contents byte-identical to `scripts/install.sh`.
 * The test in `apps/web/__tests__/install.test.ts` enforces this.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  // Resolve relative to the monorepo root. `process.cwd()` during build is
  // `apps/web`; the script is three directories up at `<repo>/scripts/install.sh`.
  const scriptPath = path.resolve(process.cwd(), "../../scripts/install.sh");
  const body = await fs.readFile(scriptPath, "utf8");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
