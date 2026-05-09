/**
 * Grants store unit tests — round-trips against a real tmp dir using
 * the same `nodeFs()` adapter the activator test uses, plus the
 * `addedPermissions` diff helper.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Grants, addedPermissions, type HostFs } from "../src/index.js";

function nodeFs(): HostFs {
  return {
    async exists(p) {
      try {
        await fs.stat(p);
        return true;
      } catch {
        return false;
      }
    },
    async mkdirp(p) {
      await fs.mkdir(p, { recursive: true });
    },
    async readFile(p) {
      return await fs.readFile(p);
    },
    async writeFile(p, bytes) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, bytes);
    },
    async rm(p) {
      await fs.rm(p, { recursive: true, force: true });
    },
    join(...segments) {
      return path.join(...segments);
    },
  };
}

describe("Grants", () => {
  let root: string;
  let grants: Grants;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "oxp-grants-"));
    grants = new Grants(nodeFs(), root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns empty when grants.json is missing", async () => {
    expect(await grants.readAll()).toEqual([]);
    expect(await grants.get("alice", "tool")).toBeUndefined();
  });

  it("set + get round-trips a grant", async () => {
    const g = {
      publisher: "alice",
      slug: "tool",
      granted: ["fs.read:workspace"],
      decidedAt: "2025-01-01T00:00:00.000Z",
      lastSeenVersion: "0.1.0",
      lastSeenManifestPermissions: ["fs.read:workspace", "net.fetch:*"],
    };
    await grants.set(g);
    const got = await grants.get("alice", "tool");
    expect(got).toEqual(g);
  });

  it("set replaces a prior grant with the same key", async () => {
    await grants.set({
      publisher: "alice",
      slug: "tool",
      granted: ["fs.read:workspace"],
      decidedAt: "2025-01-01T00:00:00.000Z",
      lastSeenVersion: "0.1.0",
      lastSeenManifestPermissions: ["fs.read:workspace"],
    });
    await grants.set({
      publisher: "alice",
      slug: "tool",
      granted: ["fs.read:workspace", "net.fetch:*"],
      decidedAt: "2025-02-01T00:00:00.000Z",
      lastSeenVersion: "0.2.0",
      lastSeenManifestPermissions: ["fs.read:workspace", "net.fetch:*"],
    });
    const all = await grants.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].lastSeenVersion).toBe("0.2.0");
    expect(all[0].granted).toEqual(["fs.read:workspace", "net.fetch:*"]);
  });

  it("keeps grants for different (publisher, slug) keys separate", async () => {
    await grants.set({
      publisher: "alice",
      slug: "tool",
      granted: [],
      decidedAt: "2025-01-01T00:00:00.000Z",
      lastSeenVersion: "0.1.0",
      lastSeenManifestPermissions: [],
    });
    await grants.set({
      publisher: "bob",
      slug: "tool",
      granted: [],
      decidedAt: "2025-01-01T00:00:00.000Z",
      lastSeenVersion: "0.1.0",
      lastSeenManifestPermissions: [],
    });
    expect(await grants.readAll()).toHaveLength(2);
  });

  it("clear removes only the matching grant", async () => {
    await grants.set({
      publisher: "alice",
      slug: "a",
      granted: [],
      decidedAt: "2025-01-01T00:00:00.000Z",
      lastSeenVersion: "0.1.0",
      lastSeenManifestPermissions: [],
    });
    await grants.set({
      publisher: "alice",
      slug: "b",
      granted: [],
      decidedAt: "2025-01-01T00:00:00.000Z",
      lastSeenVersion: "0.1.0",
      lastSeenManifestPermissions: [],
    });
    expect(await grants.clear("alice", "a")).toBe(true);
    expect(await grants.clear("alice", "missing")).toBe(false);
    const all = await grants.readAll();
    expect(all.map((g) => g.slug)).toEqual(["b"]);
  });
});

describe("addedPermissions", () => {
  it("returns items in requested missing from prevSeen", () => {
    expect(
      addedPermissions(["fs.read:workspace"], [
        "fs.read:workspace",
        "net.fetch:*",
      ]),
    ).toEqual(["net.fetch:*"]);
  });

  it("returns empty when prevSeen ⊇ requested", () => {
    expect(
      addedPermissions(
        ["fs.read:workspace", "net.fetch:*"],
        ["fs.read:workspace"],
      ),
    ).toEqual([]);
  });

  it("returns the full list on first install (prevSeen empty)", () => {
    expect(addedPermissions([], ["fs.read:workspace"])).toEqual([
      "fs.read:workspace",
    ]);
  });
});
