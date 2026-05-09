import { describe, it, expect } from "vitest";
import { detectHosts } from "../src/lib/host-detect.js";

describe("detectHosts", () => {
  it("returns an array without throwing on this machine", async () => {
    const hosts = await detectHosts({ skipProcessProbe: true });
    expect(Array.isArray(hosts)).toBe(true);
    // Every detected host carries the canonical metadata shape.
    for (const h of hosts) {
      expect(typeof h.id).toBe("string");
      expect(typeof h.displayName).toBe("string");
      expect(["vscode", "jetbrains", "zed", "piye", "other"]).toContain(
        h.family,
      );
      expect(typeof h.installed).toBe("boolean");
      expect(typeof h.partial).toBe("boolean");
      // running may be false because we asked to skip the process probe.
      expect(typeof h.running).toBe("boolean");
    }
  });
});
