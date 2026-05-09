/** Hard limits from spec/v1/bundle.md §1.2-§1.4 + Pillar 8.3 (perf). */
export const BUNDLE_LIMITS = {
  /**
   * Total .oxp (zstd-compressed) bundle size, bytes. Pillar 8.3 brand
   * promise: "the lightest extension ecosystem ever built." 5 MiB hard
   * cap by default; manifest may request a higher ceiling later via a
   * declared `size-exception` once that field lands. Enforced at both
   * `oxp pack` and the registry publish handler.
   */
  compressedBytes: 5 * 1024 * 1024,
  /** Total uncompressed bundle size, bytes. */
  totalBytes: 64 * 1024 * 1024,
  /** Single file size, bytes. */
  fileBytes: 16 * 1024 * 1024,
  /** Maximum file count (excluding directories). */
  fileCount: 2000,
  /** UI bundle size, gzipped. */
  uiGzipBytes: 300 * 1024,
  /** Wasm component size, bytes. */
  wasmBytes: 8 * 1024 * 1024,
} as const;

/** Reserved paths added by `oxp publish`. Authors must not include these. */
export const RESERVED_PATHS = new Set<string>([
  ".oxp/integrity.json",
  ".oxp/SIGNATURE",
]);

/** Deterministic tar entry mtime: 1980-01-01T00:00:00Z. */
export const DETERMINISTIC_MTIME = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

/** File-name pattern enforced on every bundle entry. */
export const PATH_PATTERN = /^[A-Za-z0-9._-][A-Za-z0-9._/-]{0,254}$/;
