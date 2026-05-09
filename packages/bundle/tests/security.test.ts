/**
 * Phase A.10 / A.3 — bundle policy enforcement.
 *
 * These tests pin the security guarantees the registry and CLI rely on.
 * If you change a CAPABILITY name or relax a rule, expect to update this
 * file AND ROADMAP-SECURITY.md AND SECURITY.md.
 */
import { describe, it, expect } from "vitest";
import { assertBundlePolicy, BundlePolicyError } from "../src/security.js";

const baseManifest = {
  id: "@a/x",
  ui: { components: "oxp-ui-v1" as const },
};

describe("assertBundlePolicy — A.10 ui-v1 forbids code", () => {
  for (const ext of [
    ".js",
    ".mjs",
    ".cjs",
    ".jsx",
    ".ts",
    ".tsx",
    ".wasm",
    ".sh",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
  ]) {
    it(`rejects ${ext} in oxp-ui-v1`, () => {
      expect(() =>
        assertBundlePolicy(baseManifest, ["oxp.json", `evil${ext}`]),
      ).toThrowError(BundlePolicyError);
      try {
        assertBundlePolicy(baseManifest, [`evil${ext}`]);
      } catch (e) {
        expect((e as BundlePolicyError).code).toBe("UI_V1_CONTAINS_CODE");
      }
    });
  }

  it("allows json/png/css/md in oxp-ui-v1", () => {
    expect(() =>
      assertBundlePolicy(baseManifest, [
        "oxp.json",
        "tree.json",
        "icon.png",
        "styles.css",
        "README.md",
      ]),
    ).not.toThrow();
  });

  it("escape-hatch is no longer a relaxation valve (WASM pivot)", () => {
    // Pre-pivot, ui.components === "escape-hatch" allowed .js. Post-pivot
    // the only sanctioned code form is .wasm in a component-v1 / hybrid-v1
    // bundle. Verify the old escape hatch is closed.
    expect(() =>
      assertBundlePolicy(
        { ...baseManifest, ui: { components: "escape-hatch" } },
        ["oxp.json", "main.js"],
      ),
    ).toThrowError(BundlePolicyError);
  });
});

describe("assertBundlePolicy — A.10 component-v1 / hybrid-v1 (WASM pivot)", () => {
  const componentManifest = {
    id: "@a/x",
    kind: "component-v1" as const,
    main: { wasm: "ext.wasm" },
  };

  it("allows .wasm in a component-v1 bundle", () => {
    expect(() =>
      assertBundlePolicy(componentManifest, ["oxp.json", "ext.wasm"]),
    ).not.toThrow();
  });

  it("rejects .js in a component-v1 bundle", () => {
    expect(() =>
      assertBundlePolicy(componentManifest, [
        "oxp.json",
        "ext.wasm",
        "stub.js",
      ]),
    ).toThrowError(BundlePolicyError);
    try {
      assertBundlePolicy(componentManifest, ["stub.js"]);
    } catch (e) {
      expect((e as BundlePolicyError).code).toBe("SCRIPT_FORBIDDEN");
    }
  });

  it("rejects component-v1 without main.wasm", () => {
    try {
      assertBundlePolicy({ id: "@a/x", kind: "component-v1" as const }, [
        "oxp.json",
      ]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BundlePolicyError);
      expect((e as BundlePolicyError).code).toBe("COMPONENT_MISSING_WASM");
    }
  });

  it("derives kind from main.wasm when manifest.kind absent", () => {
    expect(() =>
      assertBundlePolicy({ id: "@a/x", main: { wasm: "ext.wasm" } }, [
        "oxp.json",
        "ext.wasm",
      ]),
    ).not.toThrow();
  });

  it("hybrid-v1 allows both ui tree files and .wasm", () => {
    expect(() =>
      assertBundlePolicy(
        {
          id: "@a/x",
          kind: "hybrid-v1" as const,
          main: { ui: "tree.json", wasm: "ext.wasm" },
        },
        ["oxp.json", "tree.json", "ext.wasm", "icon.png"],
      ),
    ).not.toThrow();
  });
});

describe("assertBundlePolicy — A.3 known permissions", () => {
  it("accepts known capability strings", () => {
    expect(() =>
      assertBundlePolicy(
        {
          ...baseManifest,
          permissions: ["clipboard.read", "net.fetch:api.github.com"],
        },
        ["oxp.json"],
      ),
    ).not.toThrow();
  });

  it("rejects unknown capability strings", () => {
    try {
      assertBundlePolicy({ ...baseManifest, permissions: ["rm.rf.slash"] }, [
        "oxp.json",
      ]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BundlePolicyError);
      expect((e as BundlePolicyError).code).toBe("UNKNOWN_PERMISSION");
    }
  });

  it("rejects non-array permissions", () => {
    try {
      assertBundlePolicy(
        { ...baseManifest, permissions: "fs.read" as unknown },
        ["oxp.json"],
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BundlePolicyError).code).toBe("PERMISSIONS_NOT_ARRAY");
    }
  });

  it("rejects terminal.shell from unverified publishers", () => {
    try {
      assertBundlePolicy(
        { ...baseManifest, permissions: ["terminal.shell"] },
        ["oxp.json"],
        { publisherVerified: false },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BundlePolicyError).code).toBe("VERIFIED_ONLY_CAPABILITY");
    }
  });

  it("accepts terminal.shell from verified publishers", () => {
    expect(() =>
      assertBundlePolicy(
        { ...baseManifest, permissions: ["terminal.shell"] },
        ["oxp.json"],
        { publisherVerified: true },
      ),
    ).not.toThrow();
  });

  it("accepts structured Permission { id, scope, rationale }", () => {
    expect(() =>
      assertBundlePolicy(
        {
          ...baseManifest,
          permissions: [
            { id: "fs.read", scope: ["**/*.md"], rationale: "read docs" },
          ] as unknown,
        },
        ["oxp.json"],
      ),
    ).not.toThrow();
  });
});
