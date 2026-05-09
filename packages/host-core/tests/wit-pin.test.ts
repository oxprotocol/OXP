/**
 * Phase A.11 — host-side WIT pin enforcement.
 *
 * The host MUST refuse to instantiate any component whose declared WIT
 * contract does not match what this host actually links. These tests
 * pin that boundary; if you relax any rule expect to update SECURITY.md
 * and ROADMAP-SECURITY.md A.11.
 */
import { describe, it, expect } from "vitest";
import { assertHostWitPin } from "../src/wit-pin.js";
import { VerifyError } from "../src/types.js";
import {
  worldSha256,
  OXP_EXTENSION_PACKAGE,
  OXP_EXTENSION_VERSION,
} from "@oxprotocol/wit";

const baseCommon = {
  specVersion: "1",
  id: "@a/x",
  publisher: "a",
  version: "0.0.1",
  displayName: "X",
};

describe("assertHostWitPin — A.11", () => {
  it("ui-v1 manifest with no pin is accepted", () => {
    expect(() =>
      assertHostWitPin({ ...baseCommon, kind: "ui-v1" }),
    ).not.toThrow();
  });

  it("legacy manifest with no kind and no main.wasm is treated as ui-v1", () => {
    expect(() => assertHostWitPin({ ...baseCommon })).not.toThrow();
  });

  it("component-v1 without a pin is rejected", () => {
    try {
      assertHostWitPin({
        ...baseCommon,
        kind: "component-v1",
        main: { wasm: "ext.wasm" },
      });
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VerifyError);
      expect((e as VerifyError).code).toBe("WIT_PIN_REQUIRED");
    }
  });

  it("hybrid-v1 without a pin is rejected", () => {
    try {
      assertHostWitPin({
        ...baseCommon,
        kind: "hybrid-v1",
        main: { ui: "tree.json", wasm: "ext.wasm" },
      });
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VerifyError);
      expect((e as VerifyError).code).toBe("WIT_PIN_REQUIRED");
    }
  });

  it("derives kind from main.wasm when manifest.kind is absent", () => {
    try {
      assertHostWitPin({
        ...baseCommon,
        main: { wasm: "ext.wasm" },
      });
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VerifyError);
      expect((e as VerifyError).code).toBe("WIT_PIN_REQUIRED");
    }
  });

  it("rejects an unsupported package@version", () => {
    try {
      assertHostWitPin({
        ...baseCommon,
        kind: "component-v1",
        main: { wasm: "ext.wasm" },
        wit: {
          // intentionally wrong package — host pin is "oxp:extension"
          package: "oxp:host" as "oxp:extension",
          version: "0.1.0",
          sha256: worldSha256(),
        },
      });
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VerifyError);
      expect((e as VerifyError).code).toBe("WIT_PIN_UNSUPPORTED");
    }
  });

  it("rejects a hash mismatch", () => {
    try {
      assertHostWitPin({
        ...baseCommon,
        kind: "component-v1",
        main: { wasm: "ext.wasm" },
        wit: {
          package: OXP_EXTENSION_PACKAGE,
          version: OXP_EXTENSION_VERSION,
          sha256:
            "0000000000000000000000000000000000000000000000000000000000000000",
        },
      });
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VerifyError);
      expect((e as VerifyError).code).toBe("WIT_PIN_HASH_MISMATCH");
    }
  });

  it("accepts a correct pin for component-v1", () => {
    expect(() =>
      assertHostWitPin({
        ...baseCommon,
        kind: "component-v1",
        main: { wasm: "ext.wasm" },
        wit: {
          package: OXP_EXTENSION_PACKAGE,
          version: OXP_EXTENSION_VERSION,
          sha256: worldSha256(),
        },
      }),
    ).not.toThrow();
  });

  it("accepts a correct pin for hybrid-v1", () => {
    expect(() =>
      assertHostWitPin({
        ...baseCommon,
        kind: "hybrid-v1",
        main: { ui: "tree.json", wasm: "ext.wasm" },
        wit: {
          package: OXP_EXTENSION_PACKAGE,
          version: OXP_EXTENSION_VERSION,
          sha256: worldSha256(),
        },
      }),
    ).not.toThrow();
  });
});
