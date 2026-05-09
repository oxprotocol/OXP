/**
 * Phase A.4 — permission-prompt unit tests.
 */
import { describe, expect, it } from "vitest";

import {
  allowAllPrompt,
  buildPromptItems,
  denyAllPrompt,
  type PermissionPromptRequest,
} from "../src/index.js";

const stubReq = (
  items: PermissionPromptRequest["items"] = [],
): PermissionPromptRequest => ({
  extensionId: "@alice/tool",
  publisher: "alice",
  slug: "tool",
  version: "0.1.0",
  displayName: "Tool",
  items,
  isUpgrade: false,
});

describe("buildPromptItems", () => {
  it("filters ambient capabilities (log, storage, ui)", () => {
    expect(
      buildPromptItems(
        ["log.write", "storage.read", "ui.render", "notifications.show"],
        new Set(),
      ),
    ).toEqual([]);
  });

  it("includes install-time and sensitive capabilities", () => {
    const items = buildPromptItems(
      ["fs.read:workspace", "net.fetch:api.example.com"],
      new Set(),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      raw: "fs.read:workspace",
      capability: "fs.read",
      scope: "workspace",
      previouslyGranted: false,
    });
    expect(items[0].description).toBeTruthy();
    expect(items[1].scope).toBe("api.example.com");
  });

  it("dedupes repeated permission strings", () => {
    const items = buildPromptItems(
      ["fs.read:workspace", "fs.read:workspace"],
      new Set(),
    );
    expect(items).toHaveLength(1);
  });

  it("marks items in previouslyGrantedRaw as previouslyGranted", () => {
    const items = buildPromptItems(
      ["fs.read:workspace", "net.fetch:*"],
      new Set(["fs.read:workspace"]),
    );
    expect(items.find((i) => i.raw === "fs.read:workspace")?.previouslyGranted).toBe(true);
    expect(items.find((i) => i.raw === "net.fetch:*")?.previouslyGranted).toBe(false);
  });

  it("drops unparseable / unknown capability strings", () => {
    const items = buildPromptItems(
      ["not.a.capability", "fs.read:workspace"],
      new Set(),
    );
    expect(items.map((i) => i.raw)).toEqual(["fs.read:workspace"]);
  });
});

describe("denyAllPrompt", () => {
  it("returns deny with a reason", async () => {
    const decision = await denyAllPrompt(stubReq());
    expect(decision.kind).toBe("deny");
    if (decision.kind === "deny") expect(decision.reason).toBeTruthy();
  });
});

describe("allowAllPrompt", () => {
  it("grants every requested raw string", async () => {
    const items = buildPromptItems(["fs.read:workspace", "net.fetch:*"], new Set());
    const decision = await allowAllPrompt(stubReq(items));
    expect(decision.kind).toBe("grant");
    if (decision.kind === "grant") {
      expect(decision.grantedRaw.sort()).toEqual([
        "fs.read:workspace",
        "net.fetch:*",
      ]);
    }
  });
});
