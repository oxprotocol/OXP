/**
 * Phase A.11 — server-side WIT contract pin verification.
 *
 * The pin in the manifest must:
 *   - Be present for component-v1 / hybrid-v1 bundles
 *   - Be optional for ui-v1
 *   - Use a server-supported package@version
 *   - Carry the canonical sha256 of THIS server's WIT world
 */
import { describe, it, expect } from "vitest";
import {
  assertWitPin,
  buildExtensionPin,
  WitPinError,
} from "../src/wit-pin.js";
import {
  worldSha256,
  OXP_EXTENSION_PACKAGE,
  OXP_EXTENSION_VERSION,
} from "@oxprotocol/wit";

describe("assertWitPin — A.11", () => {
  it("ui-v1 bundles may omit the pin", () => {
    expect(() =>
      assertWitPin({ kind: "ui-v1", ui: { components: "oxp-ui-v1" } }),
    ).not.toThrow();
  });

  it("component-v1 bundles MUST declare a pin", () => {
    try {
      assertWitPin({ kind: "component-v1", main: { wasm: "ext.wasm" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WitPinError);
      expect((e as WitPinError).code).toBe("WIT_PIN_REQUIRED");
    }
  });

  it("hybrid-v1 bundles MUST declare a pin", () => {
    try {
      assertWitPin({
        kind: "hybrid-v1",
        main: { ui: "tree.json", wasm: "ext.wasm" },
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WitPinError);
      expect((e as WitPinError).code).toBe("WIT_PIN_REQUIRED");
    }
  });

  it("rejects an unsupported package@version", () => {
    try {
      assertWitPin({
        kind: "component-v1",
        main: { wasm: "ext.wasm" },
        wit: {
          // @ts-expect-error — intentionally outside the union to test rejection
          package: "oxp:host",
          version: "0.1.0",
          sha256: worldSha256(),
        },
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WitPinError);
      expect((e as WitPinError).code).toBe("WIT_PIN_UNSUPPORTED");
    }
  });

  it("rejects a hash mismatch", () => {
    try {
      assertWitPin({
        kind: "component-v1",
        main: { wasm: "ext.wasm" },
        wit: {
          package: OXP_EXTENSION_PACKAGE,
          version: OXP_EXTENSION_VERSION,
          sha256:
            "0000000000000000000000000000000000000000000000000000000000000000",
        },
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WitPinError);
      expect((e as WitPinError).code).toBe("WIT_PIN_HASH_MISMATCH");
    }
  });

  it("accepts a freshly built pin (round-trip)", () => {
    expect(() =>
      assertWitPin({
        kind: "component-v1",
        main: { wasm: "ext.wasm" },
        wit: buildExtensionPin(),
      }),
    ).not.toThrow();
  });

  it("buildExtensionPin returns the shipped package@version + canonical hash", () => {
    const pin = buildExtensionPin();
    expect(pin.package).toBe(OXP_EXTENSION_PACKAGE);
    expect(pin.version).toBe(OXP_EXTENSION_VERSION);
    expect(pin.sha256).toBe(worldSha256());
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
