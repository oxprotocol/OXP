#!/usr/bin/env bash
#
# Pack the OXP Neovim plugin into a tarball under packages/cli/vendor/
# and refresh oxp-neovim.json. The CLI auto-installs from these files
# on the first `oxp dev` inside Neovim — same vendoring shape that VS
# Code (.vsix) and JetBrains (.zip) use, so all three IDE adapters
# stay symmetric.
#
# Usage (manual):
#   ./hosts/neovim/scripts/vendor.sh
#
# Wired into CI by .github/workflows/neovim-plugin.yml on push to main.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
host_root="$(cd "$here/.." && pwd)"
repo_root="$(cd "$host_root/../.." && pwd)"

version="$(<"$host_root/VERSION")"
vendor_dir="$repo_root/packages/cli/vendor"
mkdir -p "$vendor_dir"

# Pack from a clean staging dir so the archive root is always "oxp.nvim/".
# Anything not strictly needed at runtime (tests, scripts, README) is
# excluded to keep the tarball small.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/oxp.nvim"
cp -R "$host_root/lua"    "$stage/oxp.nvim/lua"
cp -R "$host_root/plugin" "$stage/oxp.nvim/plugin"
cp    "$host_root/VERSION" "$stage/oxp.nvim/VERSION"

archive="$vendor_dir/oxp-neovim.tar.gz"
# BSD tar (macOS) and GNU tar (Linux) both accept these flags. We avoid
# --owner/--group/--mtime so the archive byte-stable across platforms
# isn't needed — CI commits a fresh one each release anyway.
tar -czf "$archive" -C "$stage" "oxp.nvim"

manifest="$vendor_dir/oxp-neovim.json"
cat > "$manifest" <<JSON
{
  "pluginName": "oxp.nvim",
  "version": "$version",
  "archiveFile": "oxp-neovim.tar.gz",
  "rootDir": "oxp.nvim"
}
JSON

size=$(wc -c < "$archive" | tr -d ' ')
echo "✓ vendored oxp.nvim $version → packages/cli/vendor/ ($size bytes)"
