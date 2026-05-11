import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only truly native modules must remain external (they load a `.node`
  // binary at runtime and cannot be bundled by webpack). Workspace ESM
  // packages must be bundled so webpack transforms them to CJS for the
  // route handler (which Next emits as CJS).
  serverExternalPackages: ["@mongodb-js/zstd"],

  // Defensive: webpack still tries to walk into .node binaries via transitive
  // requires from workspace packages even when listed above. Mark them external
  // explicitly so webpack treats them as `require(...)` at runtime.
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);
      externals.push(
        (
          { request }: { request?: string },
          callback: (err?: unknown, result?: string) => void,
        ) => {
          if (
            request === "@mongodb-js/zstd" ||
            (request && request.endsWith(".node"))
          ) {
            return callback(undefined, "commonjs " + request);
          }
          callback();
        },
      );
      config.externals = externals;
    }
    return config;
  },
};

export default nextConfig;
