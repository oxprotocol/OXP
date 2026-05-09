/**
 * Settings UI rendering via `@oxprotocol/ui` v1.
 *
 * An extension declares a `contributes.settings` JSON file inside its
 * bundle. Piye reads it, builds a `UiTree` using the frozen v1 vocabulary,
 * and hands the tree to the host renderer (DOM in PIYE-IDE, terminal in a
 * future TUI host). Setting values come from the host's persistent store
 * \u2014 this module is pure: tree in / tree out.
 *
 * Contribution shape:
 *
 *     {
 *       "title": "Hello",
 *       "groups": [{
 *         "id": "general",
 *         "label": "General",
 *         "settings": [
 *           { "id": "name", "label": "Name", "type": "string", "default": "world" },
 *           { "id": "loud", "label": "Loud", "type": "boolean", "default": false }
 *         ]
 *       }]
 *     }
 */

import {
  Box,
  Button,
  Stack,
  Text,
  type UiNode,
  type UiTree,
} from "@oxprotocol/ui";

export type SettingType = "string" | "number" | "boolean" | "enum";

export interface SettingDefBase {
  id: string;
  label: string;
  description?: string;
}

export interface StringSettingDef extends SettingDefBase {
  type: "string";
  default?: string;
}

export interface NumberSettingDef extends SettingDefBase {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
}

export interface BooleanSettingDef extends SettingDefBase {
  type: "boolean";
  default?: boolean;
}

export interface EnumSettingDef extends SettingDefBase {
  type: "enum";
  default?: string;
  values: readonly { value: string; label: string }[];
}

export type SettingDef =
  | StringSettingDef
  | NumberSettingDef
  | BooleanSettingDef
  | EnumSettingDef;

export interface SettingsGroup {
  id: string;
  label: string;
  description?: string;
  settings: readonly SettingDef[];
}

export interface SettingsContribution {
  title: string;
  groups: readonly SettingsGroup[];
}

export type SettingValue = string | number | boolean;
export type SettingValues = Readonly<Record<string, SettingValue | undefined>>;

/** Parse a `contributes.settings` JSON blob. Throws on malformed input. */
export function parseSettingsContribution(raw: string): SettingsContribution {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `settings contribution: invalid JSON: ${(err as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("settings contribution: expected an object");
  }
  const obj = parsed as Partial<SettingsContribution>;
  if (typeof obj.title !== "string" || !obj.title.trim()) {
    throw new Error("settings contribution: missing `title`");
  }
  if (!Array.isArray(obj.groups) || obj.groups.length === 0) {
    throw new Error("settings contribution: at least one group required");
  }
  const groups: SettingsGroup[] = obj.groups.map((g, gi) => parseGroup(g, gi));
  return { title: obj.title, groups };
}

function parseGroup(raw: unknown, idx: number): SettingsGroup {
  if (!raw || typeof raw !== "object") {
    throw new Error(`settings contribution: group #${idx} must be an object`);
  }
  const g = raw as Partial<SettingsGroup>;
  if (typeof g.id !== "string" || !/^[a-zA-Z][\w-]*$/.test(g.id)) {
    throw new Error(`settings contribution: group #${idx} bad id`);
  }
  if (typeof g.label !== "string" || !g.label.trim()) {
    throw new Error(`settings contribution: group ${g.id} missing label`);
  }
  if (!Array.isArray(g.settings) || g.settings.length === 0) {
    throw new Error(`settings contribution: group ${g.id} has no settings`);
  }
  const settings = g.settings.map((s, si) =>
    parseSetting(s, g.id ?? `${idx}`, si),
  );
  return {
    id: g.id,
    label: g.label,
    description: typeof g.description === "string" ? g.description : undefined,
    settings,
  };
}

function parseSetting(raw: unknown, groupId: string, idx: number): SettingDef {
  if (!raw || typeof raw !== "object") {
    throw new Error(`settings ${groupId}[${idx}]: must be an object`);
  }
  const s = raw as Partial<SettingDef> & { values?: unknown };
  if (typeof s.id !== "string" || !/^[a-zA-Z][\w.-]*$/.test(s.id)) {
    throw new Error(`settings ${groupId}[${idx}]: bad id`);
  }
  if (typeof s.label !== "string" || !s.label.trim()) {
    throw new Error(`settings ${groupId}.${s.id}: missing label`);
  }
  switch (s.type) {
    case "string":
      return {
        id: s.id,
        label: s.label,
        type: "string",
        description: s.description,
        default: typeof s.default === "string" ? s.default : undefined,
      };
    case "number": {
      const n = s as Partial<NumberSettingDef>;
      return {
        id: s.id,
        label: s.label,
        type: "number",
        description: s.description,
        default: typeof n.default === "number" ? n.default : undefined,
        min: typeof n.min === "number" ? n.min : undefined,
        max: typeof n.max === "number" ? n.max : undefined,
      };
    }
    case "boolean":
      return {
        id: s.id,
        label: s.label,
        type: "boolean",
        description: s.description,
        default: typeof s.default === "boolean" ? s.default : undefined,
      };
    case "enum": {
      if (!Array.isArray(s.values) || s.values.length === 0) {
        throw new Error(`settings ${groupId}.${s.id}: enum needs values[]`);
      }
      const values = s.values.map((v, vi) => {
        if (
          !v ||
          typeof v !== "object" ||
          typeof (v as { value?: unknown }).value !== "string" ||
          typeof (v as { label?: unknown }).label !== "string"
        ) {
          throw new Error(
            `settings ${groupId}.${s.id}: enum value #${vi} malformed`,
          );
        }
        return v as { value: string; label: string };
      });
      return {
        id: s.id,
        label: s.label,
        type: "enum",
        description: s.description,
        default: typeof s.default === "string" ? s.default : undefined,
        values,
      };
    }
    default:
      throw new Error(
        `settings ${groupId}.${s.id}: unknown type "${String(s.type)}"`,
      );
  }
}

/**
 * Resolve the effective value for a setting: stored value > default >
 * undefined. Type-checks the stored value and falls back to default if
 * it doesn't match.
 */
export function effectiveValue(
  def: SettingDef,
  values: SettingValues,
): SettingValue | undefined {
  const stored = values[def.id];
  if (stored !== undefined && matchesType(def, stored)) return stored;
  return def.default;
}

function matchesType(def: SettingDef, v: SettingValue): boolean {
  switch (def.type) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number";
    case "boolean":
      return typeof v === "boolean";
    case "enum":
      return typeof v === "string" && def.values.some((o) => o.value === v);
  }
}

/**
 * Build a UiTree for a settings contribution. The host wires Buttons
 * (`action: "set:<groupId>.<settingId>"`) back to a value-change handler;
 * because v1 has no input nodes yet, boolean/enum render as buttons and
 * string/number render as read-only Text + a Button to invoke a host
 * picker. PIYE-IDE supplies the picker; oxp-ui-v1 stays frozen.
 */
export function renderSettingsTree(
  contrib: SettingsContribution,
  values: SettingValues = {},
): UiTree {
  const groupNodes: UiNode[] = contrib.groups.map((g) =>
    Box({ pad: 4, gap: 3 }, [
      Text(g.label, { variant: "heading" }),
      ...(g.description ? [Text(g.description, { variant: "caption" })] : []),
      Stack(
        { axis: "vertical", gap: 3 },
        g.settings.map((s) => renderSetting(g.id, s, values)),
      ),
    ]),
  );
  return Box({ pad: 4, gap: 4 }, [
    Text(contrib.title, { variant: "heading" }),
    Stack({ axis: "vertical", gap: 4 }, groupNodes),
  ]);
}

function renderSetting(
  groupId: string,
  def: SettingDef,
  values: SettingValues,
): UiNode {
  const action = `set:${groupId}.${def.id}`;
  const value = effectiveValue(def, values);
  const header: UiNode[] = [Text(def.label, { variant: "body" })];
  if (def.description)
    header.push(Text(def.description, { variant: "caption" }));

  switch (def.type) {
    case "boolean":
      return Stack({ axis: "vertical", gap: 1 }, [
        ...header,
        Button({
          label: value === true ? "On" : "Off",
          action: `${action}:toggle`,
          variant: value === true ? "primary" : "secondary",
        }),
      ]);
    case "enum":
      return Stack({ axis: "vertical", gap: 1 }, [
        ...header,
        Stack(
          { axis: "horizontal", gap: 1 },
          def.values.map((opt) =>
            Button({
              label: opt.label,
              action: `${action}:${opt.value}`,
              variant: opt.value === value ? "primary" : "secondary",
            }),
          ),
        ),
      ]);
    case "string":
    case "number":
      return Stack({ axis: "vertical", gap: 1 }, [
        ...header,
        Stack({ axis: "horizontal", gap: 2 }, [
          Text(value === undefined ? "(unset)" : String(value), {
            variant: "caption",
          }),
          Button({
            label: "Edit",
            action: `${action}:edit`,
            variant: "secondary",
          }),
        ]),
      ]);
  }
}
