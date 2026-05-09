/**
 * Smoke tests for `oxp create --template hello-rust` + `oxp pack`.
 *
 * Verifies the week-6 deliverable end-to-end, but without invoking the
 * Rust toolchain: the test fakes a built `.wasm` artefact (a minimal
 * valid WASI Preview 2 component header) so `packBundle` will accept
 * it under component-v1 rules. The actual cargo build of the example
 * is exercised in `examples/hello-rust/` and re-tested by the
 * host-runtime jco-backend integration test.
 */
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "../src/commands/create.js";
import { pack } from "../src/commands/pack.js";
import { worldSha256 } from "@oxprotocol/wit";

let tmpRoot: string;
let prevCwd: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "oxp-cli-test-"));
  prevCwd = process.cwd();
  process.chdir(tmpRoot);
});

afterEach(async () => {
  process.chdir(prevCwd);
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("oxp create --template hello-rust", () => {
  it("scaffolds a component-v1 project with a populated WIT pin", async () => {
    const code = await create(["--template", "hello-rust", "myext"]);
    expect(code).toBe(0);

    const projectDir = join(tmpRoot, "myext");
    const manifest = JSON.parse(
      await fs.readFile(join(projectDir, "oxp.json"), "utf8"),
    );
    expect(manifest.kind).toBe("component-v1");
    // Slug interpolation with dashes preserved in id, underscores in wasm path.
    expect(manifest.id).toMatch(/^@.+\/myext$/);
    expect(manifest.main.wasm).toBe("build/myext.wasm");
    // WIT pin populated with the canonical hash this CLI was built against.
    expect(manifest.wit).toMatchObject({
      package: "oxp:extension",
      version: "0.1.0",
      sha256: worldSha256(),
    });
    // WIT files shipped inline so the project builds offline.
    await expect(
      fs.access(join(projectDir, "wit/extension.wit")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(join(projectDir, "wit/deps/oxp-host/oxp-host.wit")),
    ).resolves.toBeUndefined();
    // Cargo.toml has the underscored slug as crate name.
    const cargo = await fs.readFile(join(projectDir, "Cargo.toml"), "utf8");
    expect(cargo).toMatch(/name = "myext"/);
    // src/lib.rs got copied
    await expect(
      fs.access(join(projectDir, "src/lib.rs")),
    ).resolves.toBeUndefined();
  });

  it("rewrites dashes to underscores in the wasm artefact name", async () => {
    const code = await create(["--template", "hello-rust", "my-cool-ext"]);
    expect(code).toBe(0);
    const manifest = JSON.parse(
      await fs.readFile(join(tmpRoot, "my-cool-ext/oxp.json"), "utf8"),
    );
    expect(manifest.id).toMatch(/\/my-cool-ext$/);
    expect(manifest.main.wasm).toBe("build/my_cool_ext.wasm");

    const cargo = await fs.readFile(
      join(tmpRoot, "my-cool-ext/Cargo.toml"),
      "utf8",
    );
    expect(cargo).toMatch(/name = "my_cool_ext"/);
  });

  it("lists available templates including hello-rust", async () => {
    const orig = process.stdout.write.bind(process.stdout);
    let captured = "";
    // @ts-expect-error - test-only stub
    process.stdout.write = (chunk: string | Uint8Array) => {
      captured += String(chunk);
      return true;
    };
    try {
      const code = await create(["--list-templates"]);
      expect(code).toBe(0);
    } finally {
      process.stdout.write = orig;
    }
    expect(captured).toContain("hello-rust");
  });
});

describe("oxp pack on a hello-rust project", () => {
  it("produces a .oxp containing the .wasm under component-v1 rules", async () => {
    expect(await create(["--template", "hello-rust", "myext"])).toBe(0);
    const projectDir = join(tmpRoot, "myext");

    // Stand in for `cargo build` output. packBundle only validates that
    // main.wasm is present in the file list and that no scripts leak in;
    // it does NOT parse the wasm bytes. A short non-empty buffer is fine.
    await fs.mkdir(join(projectDir, "build"), { recursive: true });
    await fs.writeFile(
      join(projectDir, "build/myext.wasm"),
      // 8-byte WASM core module header — packBundle doesn't inspect it,
      // but using a recognisable shape keeps the fixture honest.
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    );

    // --no-build: we already wrote a fixture wasm; skip the cargo step
    // (which would take 60s+ and isn't what this test is exercising).
    const code = await pack([projectDir, "--no-build"]);
    expect(code).toBe(0);

    const dist = await fs.readdir(join(projectDir, "dist"));
    expect(dist).toContain("myext-0.0.1.oxp");
    expect(dist).toContain("myext-0.0.1.sig.json");
    expect(dist).toContain("myext-0.0.1.pub.pem");
  });

  it("refuses to pack when main.wasm is missing", async () => {
    expect(await create(["--template", "hello-rust", "myext"])).toBe(0);
    // No build/myext.wasm written → walk() won't see it, packBundle's
    // policy check will fail with WASM_FILE_MISSING. --no-build skips
    // the cargo step so we exercise packBundle's check, not the toolchain.
    await expect(pack([join(tmpRoot, "myext"), "--no-build"])).rejects.toThrow(
      /WASM_FILE_MISSING|build\/myext\.wasm/,
    );
  });
});
