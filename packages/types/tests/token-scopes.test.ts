import { describe, expect, it } from "vitest";
import {
  canPublish,
  canRotateOthers,
  isValidScope,
  parsePackageId,
} from "../src/token-scopes.js";

describe("parsePackageId", () => {
  it("parses well-formed ids", () => {
    expect(parsePackageId("@aldgar/first-extension")).toEqual({
      publisher: "aldgar",
      slug: "first-extension",
    });
  });
  it("rejects missing leading @", () => {
    expect(parsePackageId("aldgar/first")).toBeNull();
  });
  it("rejects uppercase / underscores", () => {
    expect(parsePackageId("@Aldgar/first")).toBeNull();
    expect(parsePackageId("@aldgar/first_one")).toBeNull();
  });
  it("rejects nested slashes", () => {
    expect(parsePackageId("@aldgar/first/extra")).toBeNull();
  });
});

describe("canPublish", () => {
  it("denies when no scopes", () => {
    expect(canPublish([], "@aldgar/x")).toBe(false);
  });
  it("denies for malformed package ids regardless of scope", () => {
    expect(canPublish(["*"], "not-a-pkg")).toBe(false);
  });
  it("root scope `*` allows anything", () => {
    expect(canPublish(["*"], "@aldgar/x")).toBe(true);
  });
  it("`publish:*` and bare legacy `publish` both allow anything", () => {
    expect(canPublish(["publish:*"], "@aldgar/x")).toBe(true);
    expect(canPublish(["publish"], "@aldgar/x")).toBe(true);
  });
  it("namespace scope matches only its handle", () => {
    expect(canPublish(["publish:@aldgar/*"], "@aldgar/x")).toBe(true);
    expect(canPublish(["publish:@aldgar/*"], "@aldgar/other")).toBe(true);
    expect(canPublish(["publish:@aldgar/*"], "@bob/x")).toBe(false);
  });
  it("exact scope matches only that package", () => {
    expect(canPublish(["publish:@aldgar/x"], "@aldgar/x")).toBe(true);
    expect(canPublish(["publish:@aldgar/x"], "@aldgar/y")).toBe(false);
    expect(canPublish(["publish:@aldgar/x"], "@bob/x")).toBe(false);
  });
  it("any matching scope is enough; non-publish scopes are ignored", () => {
    expect(
      canPublish(["tokens:rotate", "publish:@a/b"], "@a/b"),
    ).toBe(true);
  });
  it("ignores garbage entries without throwing", () => {
    expect(
      canPublish(["", "publish:foo", "publish:@/x", "publish:@a/b"], "@a/b"),
    ).toBe(true);
  });
});

describe("canRotateOthers", () => {
  it("requires `*` or `tokens:rotate`", () => {
    expect(canRotateOthers([])).toBe(false);
    expect(canRotateOthers(["publish:*"])).toBe(false);
    expect(canRotateOthers(["tokens:rotate"])).toBe(true);
    expect(canRotateOthers(["*"])).toBe(true);
  });
});

describe("isValidScope", () => {
  it("accepts the fixed vocabulary", () => {
    for (const s of ["*", "publish", "publish:*", "tokens:rotate"]) {
      expect(isValidScope(s), s).toBe(true);
    }
  });
  it("accepts namespace and exact publish scopes", () => {
    expect(isValidScope("publish:@aldgar/*")).toBe(true);
    expect(isValidScope("publish:@aldgar/first-extension")).toBe(true);
  });
  it("rejects malformed scopes", () => {
    expect(isValidScope("publish:foo")).toBe(false); // no @
    expect(isValidScope("publish:@/*")).toBe(false); // empty handle
    expect(isValidScope("publish:@aldgar/")).toBe(false);
    expect(isValidScope("publish:@Aldgar/*")).toBe(false); // uppercase
    expect(isValidScope("write:@a/b")).toBe(false); // unknown verb
    expect(isValidScope("")).toBe(false);
  });
});
