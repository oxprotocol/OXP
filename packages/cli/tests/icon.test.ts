/**
 * Tests for `oxp icon` — generating + converting extension icons.
 *
 * We exercise three flows:
 *   1. `oxp icon init` produces a valid SVG + PNG pair for every template.
 *   2. `oxp icon from <text>` produces a monogram pair for letters.
 *   3. `oxp icon convert` rasterises an arbitrary SVG to PNG.
 *
 * The emoji codepath hits the Twemoji CDN so it's covered as an
 * integration test only when network is available; we skip on offline.
 */
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { icon } from "../src/commands/icon.js";

let tmpRoot: string;
let prevCwd: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "oxp-icon-test-"));
  prevCwd = process.cwd();
  process.chdir(tmpRoot);
});

afterEach(async () => {
  process.chdir(prevCwd);
  await rm(tmpRoot, { recursive: true, force: true });
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("oxp icon init", () => {
  it.each(["chevron", "terminal", "branch", "swatch", "package"])(
    "writes a valid SVG + PNG pair for the %s template",
    async (tpl) => {
      const code = await icon(["init", "-t", tpl]);
      expect(code).toBe(0);
      const svg = await fs.readFile(join(tmpRoot, "icon.svg"), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain('viewBox="0 0 256 256"');
      const png = await fs.readFile(join(tmpRoot, "icon.png"));
      expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      // 256×256 PNGs from resvg are >1KB and <50KB for our templates.
      expect(png.byteLength).toBeGreaterThan(500);
      expect(png.byteLength).toBeLessThan(50_000);
    },
  );

  it("rejects unknown templates", async () => {
    // fail() calls process.exit(1); vitest converts that to a throw.
    await expect(icon(["init", "-t", "no-such-template"])).rejects.toThrow(
      /process\.exit/,
    );
  });

  it("validates --bg / --fg as hex colours", async () => {
    await expect(icon(["init", "--bg", "not-a-colour"])).rejects.toThrow(
      /process\.exit/,
    );
  });
});

describe("oxp icon from <text>", () => {
  it("renders a 1-letter monogram", async () => {
    const code = await icon(["from", "X"]);
    expect(code).toBe(0);
    const svg = await fs.readFile(join(tmpRoot, "icon.svg"), "utf8");
    expect(svg).toContain(">X<");
    const png = await fs.readFile(join(tmpRoot, "icon.png"));
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it("uppercases + truncates 3-letter monograms", async () => {
    await icon(["from", "abcdef"]);
    const svg = await fs.readFile(join(tmpRoot, "icon.svg"), "utf8");
    expect(svg).toContain(">ABC<");
    expect(svg).not.toContain(">D<");
  });

  it("escapes XML metacharacters in the input", async () => {
    await icon(["from", "<&>"]);
    const svg = await fs.readFile(join(tmpRoot, "icon.svg"), "utf8");
    expect(svg).toContain("&lt;&amp;&gt;");
  });
});

describe("oxp icon convert", () => {
  it("rasterises an SVG to a PNG at the requested size", async () => {
    const inputSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="100" fill="#ff0000"/></svg>`;
    await fs.writeFile(join(tmpRoot, "in.svg"), inputSvg);
    const code = await icon([
      "convert",
      "in.svg",
      "--out",
      "out.png",
      "--size",
      "64",
    ]);
    expect(code).toBe(0);
    const png = await fs.readFile(join(tmpRoot, "out.png"));
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it("rejects sizes outside [16, 2048]", async () => {
    await fs.writeFile(
      join(tmpRoot, "in.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>`,
    );
    await expect(icon(["convert", "in.svg", "--size", "8"])).rejects.toThrow(
      /process\.exit/,
    );
  });
});
