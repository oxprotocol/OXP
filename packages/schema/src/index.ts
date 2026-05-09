/**
 * @oxprotocol/schema — JSON Schema and Ajv validator for the OXP manifest.
 *
 * The schema file is copied from `spec/v1/manifest.schema.json` at build time
 * (see scripts/sync-schema.mjs).
 */

import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { OxpManifest } from "@oxprotocol/types";

import schemaJson from "./manifest.schema.json" with { type: "json" };

export const manifestSchema = schemaJson as Record<string, unknown>;

const ajv = new Ajv2020({
  strict: true,
  // `required` inside `anyOf` is intentional in the schema (main.ui|wasm).
  strictRequired: false,
  allErrors: true,
});
addFormats(ajv);

const compiled: ValidateFunction<OxpManifest> =
  ajv.compile<OxpManifest>(manifestSchema);

export interface ValidationFailure {
  ok: false;
  errors: ErrorObject[];
  message: string;
}

export interface ValidationSuccess {
  ok: true;
  manifest: OxpManifest;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate an arbitrary JS value as an OXP manifest. Returns a discriminated
 * result; never throws on validation failure.
 */
export function validateManifest(value: unknown): ValidationResult {
  if (compiled(value)) {
    return { ok: true, manifest: value };
  }
  const errs = compiled.errors ?? [];
  return {
    ok: false,
    errors: errs,
    message: formatErrors(errs),
  };
}

/**
 * Like {@link validateManifest} but throws an aggregated error on failure.
 * Useful at trust boundaries where invalid input is a hard error.
 */
export function assertManifest(value: unknown): OxpManifest {
  const r = validateManifest(value);
  if (!r.ok) {
    const err = new Error(`Invalid OXP manifest: ${r.message}`);
    (err as Error & { errors?: ErrorObject[] }).errors = r.errors;
    throw err;
  }
  return r.manifest;
}

function formatErrors(errors: ErrorObject[]): string {
  if (errors.length === 0) return "unknown validation error";
  return errors
    .map((e) => {
      const where = e.instancePath || "/";
      return `${where} ${e.message ?? ""}`.trim();
    })
    .join("; ");
}
