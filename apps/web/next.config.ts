import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native binary modules + workspace packages that wrap them must not be
  // bundled — they are loaded at runtime by Node from node_modules.
  serverExternalPackages: [
    "@mongodb-js/zstd",
    "@oxprotocol/bundle",
    "@oxprotocol/schema",
    "tar-stream",
  ],

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
            request === "@oxprotocol/bundle" ||
            request === "@oxprotocol/schema" ||
            request === "tar-stream" ||
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
