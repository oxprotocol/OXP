#!/usr/bin/env bash
# One-shot human-visible demo for the VS Code host.
#
# Builds the runtime + hello-rust component + the VS Code extension, then
# launches a fresh VS Code Extension Development Host with the OXP plugin
# loaded and OXP_RUNTIME exported so the runtime panel "just works".
#
# After the editor opens:
#   1. Cmd+Shift+P → "OXP: Open Runtime Panel"
#   2. Click "Start runtime"
#   3. Click "Install .wasm…"  →  pick examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm
#   4. Click "Send hello.greet" — output line shows "← \"hello, vscode!\""

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$HOME/.cargo/bin:$PATH"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }

bold "→ build oxp-runtime (debug)"
(cd "$ROOT/runtime" && cargo build)

bold "→ build hello-rust component"
(cd "$ROOT/examples/hello-rust" && cargo build --target wasm32-wasip2 --release)

bold "→ build vscode extension"
(cd "$ROOT/hosts/vscode" && pnpm build)

if ! command -v code >/dev/null 2>&1; then
  echo "✗ 'code' CLI not on PATH."
  echo "  Install it from VS Code: Cmd+Shift+P → 'Shell Command: Install code command in PATH'."
  exit 1
fi

WASM="$ROOT/examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm"

bold "→ launching VS Code extension host"
echo
echo "When the editor opens:"
echo "  1. Cmd+Shift+P → 'OXP: Open Runtime Panel'"
echo "  2. Click 'Start runtime'"
echo "  3. Click 'Install .wasm…' and pick:"
echo "       $WASM"
echo "  4. Click 'Send hello.greet'"
echo

export OXP_RUNTIME="$ROOT/runtime/target/debug/oxp-runtime"

# Open the OXP repo as the workspace inside the dev host so the user has
# something to look at; the extension itself is loaded from --extensionDevelopmentPath.
exec code \
  --new-window \
  --extensionDevelopmentPath="$ROOT/hosts/vscode" \
  "$ROOT"
