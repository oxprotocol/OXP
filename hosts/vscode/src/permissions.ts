/**
 * Manifest permissions can be either bare strings (`"fs.read:./**"`)
 * or the structured `{id, scope?, rationale?}` form. The bridge
 * handler expects the wire-string shape, so flatten the union at the
 * boundary. Without this, manifests that use the object form (e.g.
 * `examples/git-panel`) would have every `oxp.*` call silently
 * permission-denied.
 */
export function extractPermissionStrings(perms: unknown): string[] {
  if (!Array.isArray(perms)) return [];
  const out: string[] = [];
  for (const p of perms) {
    if (typeof p === "string") { out.push(p); continue; }
    if (p && typeof p === "object") {
      const obj = p as { id?: unknown; scope?: unknown };
      if (typeof obj.id !== "string") continue;
      if (Array.isArray(obj.scope) && obj.scope.length > 0) {
        for (const s of obj.scope) {
          if (typeof s === "string") out.push(`${obj.id}:${s}`);
        }
      } else if (typeof obj.scope === "string") {
        out.push(`${obj.id}:${obj.scope}`);
      } else {
        out.push(obj.id);
      }
    }
  }
  return out;
}
