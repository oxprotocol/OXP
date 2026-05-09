import { describe, it, expect } from "vitest";
import { validateManifest, assertManifest } from "../src/index.js";

const minimal = {
  specVersion: "1",
  id: "@acme/hello",
  version: "0.1.0",
  displayName: "Hello",
  publisher: "acme",
  license: "MIT",
  engines: { oxp: "^1.0.0" },
  main: { ui: "ui/index.html" },
};

describe("validateManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const r = validateManifest(minimal);
    expect(r.ok).toBe(true);
  });

  it("rejects when version is missing", () => {
    const { version: _v, ...bad } = minimal;
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/version/);
  });

  it("rejects an invalid id pattern", () => {
    const r = validateManifest({ ...minimal, id: "no-at-sign/foo" });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown top-level properties (additionalProperties:false)", () => {
    const r = validateManifest({ ...minimal, mystery: 1 });
    expect(r.ok).toBe(false);
  });

  it("requires either ui or wasm in main", () => {
    const r = validateManifest({ ...minimal, main: {} });
    expect(r.ok).toBe(false);
  });

  it("assertManifest throws on invalid input", () => {
    expect(() => assertManifest({ specVersion: "1" })).toThrow(
      /Invalid OXP manifest/,
    );
  });

  // ──────────────────────────────────────────────────────────────────
  // Phase A.12 / A.13 — runtime limits
  // ──────────────────────────────────────────────────────────────────

  it("accepts manifest with limits within range", () => {
    const r = validateManifest({
      ...minimal,
      limits: { timeMsPerCall: 250, maxMemoryMb: 128 },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects timeMsPerCall above the documented maximum (5000)", () => {
    const r = validateManifest({
      ...minimal,
      limits: { timeMsPerCall: 10_000 },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects maxMemoryMb above the documented maximum (256)", () => {
    const r = validateManifest({
      ...minimal,
      limits: { maxMemoryMb: 1024 },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown properties inside limits", () => {
    const r = validateManifest({
      ...minimal,
      limits: { fuel: 1_000_000 },
    });
    expect(r.ok).toBe(false);
  });
});
