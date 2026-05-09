/**
 * Parse the fenced ```json oxp-vsx-meta block embedded in a VSX-mirrored
 * extension's `readme`. The Open VSX importer (`scripts/import-openvsx.mjs`)
 * writes this block so the detail page can render real icons, install
 * targets, and a "Claim" CTA without a schema migration.
 */

export interface VsxMeta {
  source: "open-vsx";
  namespace: string;
  name: string;
  version: string;
  iconUrl?: string | null;
  vsixUrl?: string | null;
  worksIn?: string[];
  claimable?: boolean;
}

const FENCE_RE = /```json oxp-vsx-meta\s*([\s\S]*?)```/;

export function parseVsxMeta(
  readme: string | null | undefined,
): VsxMeta | null {
  if (!readme) return null;
  const m = FENCE_RE.exec(readme);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]!);
    if (!obj || typeof obj !== "object") return null;
    if (obj.source !== "open-vsx") return null;
    if (typeof obj.namespace !== "string" || typeof obj.name !== "string") {
      return null;
    }
    return obj as VsxMeta;
  } catch {
    return null;
  }
}
