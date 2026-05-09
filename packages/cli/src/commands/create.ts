import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worldSha256 } from "@oxprotocol/wit";
import { fail, info, readCredentials, registryUrl } from "../util.js";

/**
 * Templates shipped with the CLI. Add more by dropping a directory in
 *   packages/cli/templates/<name>/
 * with placeholder substitutions:
 *   __PUBLISHER__         npm-style scope without the leading @
 *   __SLUG__              kebab-case project slug
 *   __SLUG_UNDERSCORED__  same with - → _ (Rust crate names)
 *   __DISPLAY_NAME__      title-cased name for UIs
 *   __WIT_SHA__           sha256 of the canonical oxp:extension WIT world
 *                         this CLI was built against (component-v1 only)
 */
const TEMPLATES = [
  "hello-html",
  "hello-code",
  "hello-tree",
  "hello-rust",
] as const;
type TemplateName = (typeof TEMPLATES)[number];
const DEFAULT_TEMPLATE: TemplateName = "hello-html";

/**
 * `oxp create [--template <name>] <project>` — copy a template into ./<project>,
 * substituting placeholders. Default template: hello-html.
 */
export async function create(args: string[]): Promise<number> {
  let template: TemplateName = DEFAULT_TEMPLATE;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--template" || a === "-t") {
      const v = args[++i];
      if (!v) fail("usage: oxp create --template <name> <project>");
      assertTemplate(v);
      template = v;
    } else if (a.startsWith("--template=")) {
      const v = a.slice("--template=".length);
      assertTemplate(v);
      template = v;
    } else if (a === "--list-templates") {
      process.stdout.write(TEMPLATES.join("\n") + "\n");
      return 0;
    } else {
      positional.push(a);
    }
  }

  const name = positional[0];
  if (!name)
    fail(
      "usage: oxp create [--template <name>] <project>\n" +
        `  templates: ${TEMPLATES.join(", ")}`,
    );

  const slug = name.toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    fail(
      `'${name}' is not a valid slug (lowercase letters, digits, dashes only)`,
    );
  }

  const dest = resolve(process.cwd(), name);
  try {
    await fs.access(dest);
    fail(`destination '${name}' already exists`);
  } catch {
    // good
  }

  const here = fileURLToPath(import.meta.url);
  const templateDir = await locateTemplate(here, template);
  if (!templateDir) fail(`could not find template '${template}'`);

  const publisher = await resolvePublisher();
  const displayName = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
  // Rust crate / wasm artefact names cannot contain dashes.
  const slugUnderscored = slug.replace(/-/g, "_");
  // Only computed for component-v1 templates that ship `wit/`. Reading
  // the canonical world from disk is cheap (~5 KB), so unconditional.
  const witSha = worldSha256();

  await copyTree(templateDir, dest, (txt) =>
    txt
      .replaceAll("__PUBLISHER__", publisher)
      .replaceAll("__SLUG_UNDERSCORED__", slugUnderscored)
      .replaceAll("__SLUG__", slug)
      .replaceAll("__DISPLAY_NAME__", displayName)
      .replaceAll("__WIT_SHA__", witSha),
  );

  info(`✓ created ${name}/ from template '${template}'`);
  info(`  publisher: @${publisher}`);
  info(`  slug:      ${slug}`);
  info("");
  if (template === "hello-rust") {
    info(`Next steps:`);
    info(`  cd ${name}`);
    info(
      `  rustup target add wasm32-wasip2                                  # one-time`,
    );
    info(
      `  oxp pack                                                         # builds + packs`,
    );
    info(
      `  oxp publish                                                      # ship it`,
    );
  } else if (template === "hello-code") {
    info(`Next steps:`);
    info(`  cd ${name}`);
    info(`  pnpm install`);
    info(
      `  oxp dev                                                          # live reload in IDE`,
    );
    info(
      `  oxp pack && oxp publish                                          # ship it`,
    );
  } else {
    info(`Next steps:`);
    info(`  cd ${name}`);
    info(
      `  oxp dev                                                          # live reload in IDE`,
    );
    info(
      `  oxp pack && oxp publish                                          # ship it`,
    );
  }
  return 0;
}

/**
 * Resolve the publisher handle to use for the new project.
 *
 * Priority:
 *  1. Logged-in registry handle (from `oxp whoami`)
 *  2. System username ($USER / $USERNAME), normalised to [a-z0-9-]
 *
 * Network call is best-effort with a 3 s timeout — if anything fails we
 * fall back silently so `oxp create` still works offline.
 */
async function resolvePublisher(): Promise<string> {
  const fallback = (process.env.USER ?? process.env.USERNAME ?? "you")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");

  const token = await readCredentials();
  if (!token) return fallback;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch(`${registryUrl()}/api/v1/auth/whoami`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return fallback;
    const body = (await res.json()) as { ok: boolean; handle?: string | null };
    if (body.ok && body.handle) return body.handle;
  } catch {
    // offline or timeout — fall back without noise
  }
  return fallback;
}

function assertTemplate(v: string): asserts v is TemplateName {
  if (!(TEMPLATES as readonly string[]).includes(v)) {
    fail(`unknown template '${v}'. available: ${TEMPLATES.join(", ")}`);
  }
}

async function locateTemplate(
  fromFile: string,
  template: string,
): Promise<string | null> {
  let dir = fromFile;
  for (let i = 0; i < 8; i++) {
    dir = resolve(dir, "..");
    const candidates = [
      join(dir, "templates", template),
      join(dir, "packages/cli/templates", template),
    ];
    if (template === "hello-html") {
      candidates.push(join(dir, "examples/hello-world/template"));
    }
    for (const candidate of candidates) {
      try {
        await fs.access(join(candidate, "oxp.json"));
        return candidate;
      } catch {
        // keep walking
      }
    }
  }
  return null;
}

const TEXT_EXT = new Set([
  ".json",
  ".html",
  ".md",
  ".txt",
  ".js",
  ".ts",
  ".css",
  ".toml",
  ".rs",
  ".wit",
  ".gitignore",
]);

async function copyTree(
  src: string,
  dest: string,
  transform: (s: string) => string,
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const sp = join(src, entry.name);
    const dp = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sp, dp, transform);
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (TEXT_EXT.has(ext)) {
        const txt = await fs.readFile(sp, "utf8");
        await fs.writeFile(dp, transform(txt));
      } else {
        await fs.copyFile(sp, dp);
      }
    }
  }
}
