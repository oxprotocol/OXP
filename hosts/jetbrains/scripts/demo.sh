#!/usr/bin/env bash
# One-shot human-visible demo: builds runtime + hello-rust component, then
# launches a sandboxed IntelliJ Community with the OXP plugin pre-installed.
# Open the OXP tool window on the right edge, click "Install .wasm…",
# pick examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm,
# then "Send hello.greet" — watch real wasm output in the panel.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$HOME/.cargo/bin:$PATH"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }

bold "→ build oxp-runtime (debug, used by the bundled-binary lookup)"
(cd "$ROOT/runtime" && cargo build)

bold "→ build hello-rust component"
(cd "$ROOT/examples/hello-rust" && cargo build --target wasm32-wasip2 --release)

bold "→ stage runtime into plugin distribution"
"$ROOT/hosts/jetbrains/scripts/stage-runtime.sh"

bold "→ launching sandboxed IntelliJ Community with OXP plugin"
echo
echo "When the IDE opens:"
echo "  1. Open any folder (or the OXP repo)"
echo "  2. View → Tool Windows → OXP   (right edge, plugin icon)"
echo "  3. Click 'Start runtime'"
echo "  4. Click 'Install .wasm…' and pick:"
echo "       $ROOT/examples/hello-rust/target/wasm32-wasip2/release/hello_rust.wasm"
echo "  5. Click 'Send hello.greet' — output appears in the panel"
echo

# Explicit override so the plugin doesn't depend on cwd-walk fallback under runIde.
export OXP_RUNTIME="$ROOT/runtime/target/debug/oxp-runtime"

exec "$ROOT/hosts/jetbrains/gradlew" -p "$ROOT/hosts/jetbrains" runIde
