import { describe, it, expect } from "vitest";
import { CommandPalette, parseCommandsContribution } from "../src/commands.js";
import { Registry } from "../src/registry.js";
import type { MountedExtension } from "../src/mount.js";
import type { InstalledRecord } from "@oxprotocol/host-core";

function rec(id: string): InstalledRecord {
  return {
    id,
    version: "0.0.1",
    publisher: "test",
    slug: id,
    keyId: "k",
    tarSha256: "0".repeat(64),
    manifest: {
      $schema: "https://oxp.dev/spec/v1/manifest.schema.json",
      id,
      name: id,
      version: "0.0.1",
      publisher: "test",
      activation: ["onStartup"],
      permissions: [],
    } as InstalledRecord["manifest"],
    installedAt: new Date().toISOString(),
    files: [],
  };
}

function mounted(id: string) {
  const events: Array<{ topic: string; payload: unknown }> = [];
  const m: MountedExtension = {
    record: rec(id),
    sendEvent: (t, p) => events.push({ topic: t, payload: p }),
    unmount: async () => {},
  };
  return { id, surface: "p", mounted: m, events };
}

describe("parseCommandsContribution", () => {
  it("parses a valid file", () => {
    const out = parseCommandsContribution(
      JSON.stringify({
        commands: [
          { id: "a.b", title: "AB", category: "X", keywords: ["foo"] },
          { id: "c.d", title: "CD" },
        ],
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "a.b",
      title: "AB",
      category: "X",
      keywords: ["foo"],
    });
  });

  it("rejects bad JSON", () => {
    expect(() => parseCommandsContribution("{")).toThrow(/invalid JSON/);
  });

  it("rejects missing commands array", () => {
    expect(() => parseCommandsContribution("{}")).toThrow(/commands/);
  });

  it("rejects bad ids", () => {
    expect(() =>
      parseCommandsContribution(
        JSON.stringify({ commands: [{ id: "9bad", title: "x" }] }),
      ),
    ).toThrow(/bad id/);
  });

  it("rejects missing title", () => {
    expect(() =>
      parseCommandsContribution(
        JSON.stringify({ commands: [{ id: "ok", title: "" }] }),
      ),
    ).toThrow(/missing title/);
  });
});

describe("CommandPalette", () => {
  it("registers and lists", () => {
    const r = new Registry();
    const p = new CommandPalette(r);
    p.register("ext", [
      { id: "greet", title: "Greet" },
      { id: "wave", title: "Wave" },
    ]);
    expect(p.list().map((c) => c.id)).toEqual(["greet", "wave"]);
  });

  it("re-register replaces previous set", () => {
    const r = new Registry();
    const p = new CommandPalette(r);
    p.register("ext", [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ]);
    p.register("ext", [{ id: "c", title: "C" }]);
    expect(p.list().map((c) => c.id)).toEqual(["c"]);
  });

  it("empty query returns alphabetised list", () => {
    const r = new Registry();
    const p = new CommandPalette(r);
    p.register("ext", [
      { id: "z", title: "Zeta" },
      { id: "a", title: "Alpha" },
    ]);
    expect(p.search("").map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("ranks exact match best", () => {
    const r = new Registry();
    const p = new CommandPalette(r);
    p.register("ext", [
      { id: "greeter", title: "Greeter" },
      { id: "greet", title: "Greet" },
    ]);
    const top = p.search("greet")[0];
    expect(top.id).toBe("greet");
    expect(top.score).toBe(0);
  });

  it("matches subsequence", () => {
    const r = new Registry();
    const p = new CommandPalette(r);
    p.register("ext", [{ id: "fixthebug", title: "Fix The Bug" }]);
    expect(p.search("fxbg")).toHaveLength(1);
    expect(p.search("zzz")).toHaveLength(0);
  });

  it("execute dispatches command event to owning extension", () => {
    const r = new Registry();
    const m = mounted("ext");
    r.add(m);
    const p = new CommandPalette(r);
    p.register("ext", [{ id: "greet", title: "Greet" }]);
    expect(p.execute("ext", "greet", { who: "world" })).toBe(true);
    expect(m.events).toEqual([
      { topic: "command:greet", payload: { who: "world" } },
    ]);
  });

  it("execute returns false for unknown command", () => {
    const r = new Registry();
    r.add(mounted("ext"));
    const p = new CommandPalette(r);
    expect(p.execute("ext", "missing")).toBe(false);
  });

  it("auto-unregisters when extension is removed", async () => {
    const r = new Registry();
    r.add(mounted("ext"));
    const p = new CommandPalette(r);
    p.register("ext", [{ id: "greet", title: "Greet" }]);
    expect(p.list()).toHaveLength(1);
    await r.remove("ext");
    expect(p.list()).toHaveLength(0);
  });
});
