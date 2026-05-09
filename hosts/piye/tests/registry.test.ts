import { describe, it, expect, vi } from "vitest";
import { Registry, type RegistryEntry } from "../src/registry.js";
import type { MountedExtension } from "../src/mount.js";
import type { InstalledRecord } from "@oxprotocol/host-core";

function fakeRecord(id: string): InstalledRecord {
  return {
    id,
    version: "0.0.1",
    publisher: "test",
    slug: id,
    keyId: "test:key",
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

function fakeMounted(id: string): {
  mounted: MountedExtension;
  events: Array<{ topic: string; payload: unknown }>;
  unmounts: number;
} {
  const events: Array<{ topic: string; payload: unknown }> = [];
  let unmounts = 0;
  const mounted: MountedExtension = {
    record: fakeRecord(id),
    sendEvent: (topic, payload) => events.push({ topic, payload }),
    unmount: async () => {
      unmounts += 1;
    },
  };
  return {
    mounted,
    events,
    get unmounts() {
      return unmounts;
    },
  };
}

function entry(
  id: string,
  surface = "panel-1",
): RegistryEntry & {
  events: Array<{ topic: string; payload: unknown }>;
  unmounts: number;
} {
  const f = fakeMounted(id);
  return {
    id,
    surface,
    mounted: f.mounted,
    get events() {
      return f.events;
    },
    get unmounts() {
      return f.unmounts;
    },
  };
}

describe("Registry", () => {
  it("adds and lists extensions", () => {
    const r = new Registry();
    r.add(entry("a"));
    r.add(entry("b"));
    expect(r.size).toBe(2);
    expect(r.list().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("rejects duplicate ids", () => {
    const r = new Registry();
    r.add(entry("a"));
    expect(() => r.add(entry("a"))).toThrow(/already registered/);
  });

  it("removes and unmounts", async () => {
    const r = new Registry();
    const e = entry("a");
    r.add(e);
    expect(await r.remove("a")).toBe(true);
    expect(r.size).toBe(0);
    expect(e.unmounts).toBe(1);
    expect(await r.remove("a")).toBe(false);
  });

  it("routes events to one extension", () => {
    const r = new Registry();
    const a = entry("a");
    const b = entry("b");
    r.add(a);
    r.add(b);
    expect(r.send("a", "hello", 1)).toBe(true);
    expect(a.events).toEqual([{ topic: "hello", payload: 1 }]);
    expect(b.events).toEqual([]);
    expect(r.send("missing", "x")).toBe(false);
  });

  it("broadcasts to all", () => {
    const r = new Registry();
    const a = entry("a");
    const b = entry("b");
    r.add(a);
    r.add(b);
    r.broadcast("ping");
    expect(a.events).toEqual([{ topic: "ping", payload: undefined }]);
    expect(b.events).toEqual([{ topic: "ping", payload: undefined }]);
  });

  it("notifies listeners on add/remove", async () => {
    const r = new Registry();
    const events: string[] = [];
    const off = r.subscribe((e) => events.push(`${e.kind}:${e.id}`));
    r.add(entry("a"));
    await r.remove("a");
    off();
    r.add(entry("b"));
    expect(events).toEqual(["added:a", "removed:a"]);
  });

  it("listener errors are isolated", () => {
    const r = new Registry();
    const seen: string[] = [];
    r.subscribe(() => {
      throw new Error("boom");
    });
    r.subscribe((e) => seen.push(e.id));
    r.add(entry("a"));
    expect(seen).toEqual(["a"]);
  });

  it("shutdown unmounts everything", async () => {
    const r = new Registry();
    const a = entry("a");
    const b = entry("b");
    r.add(a);
    r.add(b);
    await r.shutdown();
    // shutdown clears the entries map before iterating, so we capture the
    // unmount counter via the closure created in fakeMounted.
    expect(r.size).toBe(0);
  });
});

describe("Registry shutdown actually unmounts", () => {
  it("calls unmount on each entry", async () => {
    const r = new Registry();
    const aSpy = vi.fn(async () => {});
    const bSpy = vi.fn(async () => {});
    r.add({
      id: "a",
      surface: "p",
      mounted: {
        record: fakeRecord("a"),
        sendEvent: () => {},
        unmount: aSpy,
      },
    });
    r.add({
      id: "b",
      surface: "p",
      mounted: {
        record: fakeRecord("b"),
        sendEvent: () => {},
        unmount: bSpy,
      },
    });
    await r.shutdown();
    expect(aSpy).toHaveBeenCalledTimes(1);
    expect(bSpy).toHaveBeenCalledTimes(1);
    expect(r.size).toBe(0);
  });
});
