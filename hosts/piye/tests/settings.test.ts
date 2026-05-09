import { describe, it, expect } from "vitest";
import {
  parseSettingsContribution,
  effectiveValue,
  renderSettingsTree,
  type SettingsContribution,
} from "../src/settings.js";
import { renderTreeToHtml } from "@oxprotocol/ui/dom";

const validRaw = JSON.stringify({
  title: "Hello",
  groups: [
    {
      id: "general",
      label: "General",
      settings: [
        { id: "name", label: "Name", type: "string", default: "world" },
        { id: "age", label: "Age", type: "number", default: 7, min: 0 },
        { id: "loud", label: "Loud", type: "boolean", default: false },
        {
          id: "mode",
          label: "Mode",
          type: "enum",
          default: "soft",
          values: [
            { value: "soft", label: "Soft" },
            { value: "hard", label: "Hard" },
          ],
        },
      ],
    },
  ],
});

describe("parseSettingsContribution", () => {
  it("parses every setting type", () => {
    const c = parseSettingsContribution(validRaw);
    expect(c.title).toBe("Hello");
    expect(c.groups[0].settings.map((s) => s.type)).toEqual([
      "string",
      "number",
      "boolean",
      "enum",
    ]);
  });

  it("rejects bad JSON", () => {
    expect(() => parseSettingsContribution("not json")).toThrow(/invalid JSON/);
  });

  it("rejects missing title", () => {
    expect(() =>
      parseSettingsContribution(JSON.stringify({ groups: [] })),
    ).toThrow(/title/);
  });

  it("rejects empty groups", () => {
    expect(() =>
      parseSettingsContribution(JSON.stringify({ title: "x", groups: [] })),
    ).toThrow(/at least one group/);
  });

  it("rejects unknown setting type", () => {
    expect(() =>
      parseSettingsContribution(
        JSON.stringify({
          title: "x",
          groups: [
            {
              id: "g",
              label: "G",
              settings: [{ id: "s", label: "S", type: "color" }],
            },
          ],
        }),
      ),
    ).toThrow(/unknown type/);
  });

  it("rejects enum without values", () => {
    expect(() =>
      parseSettingsContribution(
        JSON.stringify({
          title: "x",
          groups: [
            {
              id: "g",
              label: "G",
              settings: [{ id: "m", label: "M", type: "enum" }],
            },
          ],
        }),
      ),
    ).toThrow(/enum needs values/);
  });
});

describe("effectiveValue", () => {
  const c = parseSettingsContribution(validRaw);
  const settings = c.groups[0].settings;
  const nameDef = settings[0];
  const ageDef = settings[1];
  const modeDef = settings[3];

  it("returns stored value when type matches", () => {
    expect(effectiveValue(nameDef, { name: "alice" })).toBe("alice");
  });

  it("falls back to default on type mismatch", () => {
    expect(effectiveValue(ageDef, { age: "seven" as unknown as number })).toBe(
      7,
    );
  });

  it("falls back to default when unset", () => {
    expect(effectiveValue(nameDef, {})).toBe("world");
  });

  it("rejects enum value not in allowed list", () => {
    expect(effectiveValue(modeDef, { mode: "violent" })).toBe("soft");
  });
});

describe("renderSettingsTree", () => {
  it("produces a tree the DOM renderer accepts", () => {
    const c = parseSettingsContribution(validRaw);
    const tree = renderSettingsTree(c, { name: "alice", loud: true });
    const html = renderTreeToHtml(tree);
    expect(html).toContain("Hello");
    expect(html).toContain("General");
    expect(html).toContain("Name");
    // boolean true renders "On"
    expect(html).toContain("On");
    // string value renders next to Edit button
    expect(html).toContain("alice");
    expect(html).toContain("Edit");
    // enum renders both options
    expect(html).toContain("Soft");
    expect(html).toContain("Hard");
  });

  it("emits action attributes for each setting", () => {
    const c = parseSettingsContribution(validRaw);
    const tree = renderSettingsTree(c);
    const html = renderTreeToHtml(tree);
    expect(html).toContain("set:general.loud:toggle");
    expect(html).toContain("set:general.mode:soft");
    expect(html).toContain("set:general.name:edit");
  });

  it("shows (unset) when no default and no value", () => {
    const c: SettingsContribution = {
      title: "T",
      groups: [
        {
          id: "g",
          label: "G",
          settings: [{ id: "x", label: "X", type: "string" }],
        },
      ],
    };
    const html = renderTreeToHtml(renderSettingsTree(c));
    expect(html).toContain("(unset)");
  });
});
