import { describe, expect, it } from "vitest";
import {
  canonicalSha256,
  canonicalWorldSha256,
  canonicalizeWit,
} from "../src/canonical.js";
import { readWorldFiles, worldSha256 } from "../src/files.js";
import {
  OXP_EXTENSION_VERSION,
  OXP_HOST_VERSION,
  SUPPORTED_WIT_PINS,
} from "../src/version.js";

describe("canonicalizeWit", () => {
  it("strips line comments outside strings", () => {
    const out = canonicalizeWit("record r { name: string } // a comment\n");
    expect(out).toBe("record r { name: string }\n");
  });

  it("preserves // inside strings", () => {
    const src = 'const url: string = "http://example.com"\n';
    expect(canonicalizeWit(src)).toBe(src);
  });

  it("normalizes line endings and trims trailing whitespace", () => {
    const src = "interface a {  \r\n  foo: func();   \r\n}\r\n";
    expect(canonicalizeWit(src)).toBe("interface a {\n  foo: func();\n}\n");
  });

  it("collapses runs of blank lines", () => {
    const src = "a\n\n\n\nb\n";
    expect(canonicalizeWit(src)).toBe("a\n\nb\n");
  });

  it("ends with exactly one trailing newline", () => {
    expect(canonicalizeWit("x")).toBe("x\n");
    expect(canonicalizeWit("x\n\n\n")).toBe("x\n");
  });

  it("two cosmetically-different files hash the same", () => {
    const a = "interface i {\n  foo: func();\n}\n";
    const b = "interface i {\r\n  foo: func();   // hi\r\n}\r\n\r\n";
    expect(canonicalSha256(a)).toBe(canonicalSha256(b));
  });

  it("a meaningful change in tokens changes the hash", () => {
    const a = "interface i { foo: func(); }\n";
    const b = "interface i { bar: func(); }\n";
    expect(canonicalSha256(a)).not.toBe(canonicalSha256(b));
  });
});

describe("canonicalWorldSha256", () => {
  it("is order-independent", () => {
    const f1 = { path: "a.wit", source: "interface a {}\n" };
    const f2 = { path: "b.wit", source: "interface b {}\n" };
    expect(canonicalWorldSha256([f1, f2])).toBe(canonicalWorldSha256([f2, f1]));
  });

  it("includes the path in the hash (renaming a file changes the hash)", () => {
    const a = canonicalWorldSha256([{ path: "a.wit", source: "x\n" }]);
    const b = canonicalWorldSha256([{ path: "b.wit", source: "x\n" }]);
    expect(a).not.toBe(b);
  });
});

describe("shipped world", () => {
  it("loads both .wit files from disk", () => {
    const files = readWorldFiles();
    expect(files.map((f) => f.path).sort()).toEqual([
      "oxp-extension.wit",
      "oxp-host.wit",
    ]);
    for (const f of files) expect(f.source.length).toBeGreaterThan(100);
  });

  it("worldSha256() is deterministic", () => {
    expect(worldSha256()).toBe(worldSha256());
    expect(worldSha256()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("supported pins list contains both packages at v0.1.0", () => {
    expect(SUPPORTED_WIT_PINS).toContain(`oxp:host@${OXP_HOST_VERSION}`);
    expect(SUPPORTED_WIT_PINS).toContain(
      `oxp:extension@${OXP_EXTENSION_VERSION}`,
    );
  });
});
