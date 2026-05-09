import { createHash } from "node:crypto";

/**
 * Canonical-form normalization for WIT source files.
 *
 * Two `.wit` files that differ only in comments, blank lines, or
 * trailing whitespace MUST produce the same canonical hash. The hash
 * is what Phase A.11 pins on the manifest and what the registry
 * verifies on publish.
 *
 * Rules (deliberately minimal — we are NOT a WIT parser):
 *   1. Strip line comments (`//` to end of line). Block comments
 *      (`/* … *​/`) are not part of WIT syntax and are left intact
 *      so they would simply differ visibly if anyone tries to use one.
 *   2. Trim trailing whitespace on every line.
 *   3. Collapse runs of blank lines to a single blank line.
 *   4. Normalize line endings to LF.
 *   5. Ensure the file ends with exactly one trailing newline.
 *
 * We intentionally do NOT collapse intra-line whitespace or rewrite
 * tokens — anything beyond the rules above is a meaningful diff and
 * should change the hash. A fancier WIT-aware canonicalizer can be
 * added later without changing this contract because the hash is
 * version-pinned alongside the WIT package version itself.
 */
export function canonicalizeWit(source: string): string {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(stripLineComment)
    .map((l) => l.replace(/[\t ]+$/u, ""));

  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    const blank = line.length === 0;
    if (blank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = blank;
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") {
    collapsed.pop();
  }
  return collapsed.join("\n") + "\n";
}

function stripLineComment(line: string): string {
  // Walk the line tracking string state; strip from the first `//`
  // that is not inside a string. WIT strings use double quotes.
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== "\\") {
      inStr = !inStr;
      continue;
    }
    if (!inStr && c === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Hex sha256 of the canonical form. This is the value Phase A.11 pins.
 */
export function canonicalSha256(source: string): string {
  return createHash("sha256")
    .update(canonicalizeWit(source), "utf8")
    .digest("hex");
}

/**
 * Convenience: hash multiple .wit files in a deterministic order, the way
 * a WIT *world* (which spans multiple files) is pinned. Files are joined
 * by their relative path sorted lexicographically and a single LF.
 */
export function canonicalWorldSha256(
  files: ReadonlyArray<{ path: string; source: string }>,
): string {
  const sorted = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const hasher = createHash("sha256");
  for (const f of sorted) {
    hasher.update(f.path, "utf8");
    hasher.update("\n", "utf8");
    hasher.update(canonicalizeWit(f.source), "utf8");
    hasher.update("\n", "utf8");
  }
  return hasher.digest("hex");
}
