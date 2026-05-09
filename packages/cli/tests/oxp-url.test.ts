import { describe, it, expect } from "vitest";
import {
  parseOxpUrl,
  buildInstallUrl,
  OxpUrlError,
} from "../src/lib/oxp-url.js";

describe("parseOxpUrl", () => {
  it("parses a simple install URL", () => {
    const r = parseOxpUrl("oxp://install/@oxprotocol/example");
    expect(r).toEqual({
      kind: "install",
      id: "@oxprotocol/example",
      version: undefined,
      hosts: undefined,
    });
  });

  it("parses version + host filters", () => {
    const r = parseOxpUrl(
      "oxp://install/@me/thing?version=1.2.3&host=vscode&host=cursor",
    );
    expect(r).toEqual({
      kind: "install",
      id: "@me/thing",
      version: "1.2.3",
      hosts: ["vscode", "cursor"],
    });
  });

  it("rejects non-oxp scheme", () => {
    expect(() => parseOxpUrl("https://install/@a/b")).toThrow(OxpUrlError);
  });

  it("rejects unknown action", () => {
    expect(() => parseOxpUrl("oxp://uninstall/@a/b")).toThrow(OxpUrlError);
  });

  it("rejects malformed id", () => {
    expect(() => parseOxpUrl("oxp://install/not-an-id")).toThrow(OxpUrlError);
    expect(() => parseOxpUrl("oxp://install/@only-publisher")).toThrow(
      OxpUrlError,
    );
  });

  it("rejects bad host filter values", () => {
    expect(() => parseOxpUrl("oxp://install/@a/b?host=Bad%20Host")).toThrow(
      OxpUrlError,
    );
  });

  it("rejects bad version", () => {
    expect(() => parseOxpUrl("oxp://install/@a/b?version=1%20.0")).toThrow(
      OxpUrlError,
    );
  });

  it("round-trips through buildInstallUrl", () => {
    const built = buildInstallUrl("@me/x", {
      version: "0.2.0",
      hosts: ["vscode"],
    });
    expect(built).toBe("oxp://install/@me/x?version=0.2.0&host=vscode");
    const back = parseOxpUrl(built);
    expect(back.id).toBe("@me/x");
    expect(back.version).toBe("0.2.0");
    expect(back.hosts).toEqual(["vscode"]);
  });

  it("buildInstallUrl rejects bad id", () => {
    expect(() => buildInstallUrl("nope")).toThrow(OxpUrlError);
  });
});
