#!/usr/bin/env bash
# Stage the oxp-runtime binary into hosts/jetbrains/runtime-bin/<triple>/
# so prepareSandbox can package it with the plugin.
#
# Usage:
#   stage-runtime.sh                # current host platform only (dev mode)
#   stage-runtime.sh --all          # all 6 release platforms (needs cross toolchain — CI)
#
# CI is expected to handle --all via cross / cargo-zigbuild. Local dev only
# needs the current platform to test runIde.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_DIR="$REPO_ROOT/runtime"
OUT_ROOT="$(cd "$(dirname "$0")/.." && pwd)/runtime-bin"

# Make cargo visible if user installed via rustup.
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$HOME/.cargo/bin:$PATH"

stage_one() {
    local rust_triple="$1"
    local plugin_triple="$2"
    local exe="$3"

    echo "→ building $rust_triple"
    (
        cd "$RUNTIME_DIR"
        cargo build --release --target "$rust_triple"
    )
    local out_dir="$OUT_ROOT/$plugin_triple"
    mkdir -p "$out_dir"
    cp "$RUNTIME_DIR/target/$rust_triple/release/$exe" "$out_dir/$exe"
    chmod +x "$out_dir/$exe" 2>/dev/null || true
    echo "  staged $out_dir/$exe"
}

if [[ "${1:-}" == "--all" ]]; then
    stage_one "aarch64-apple-darwin"      "macos-aarch64"   "oxp-runtime"
    stage_one "x86_64-apple-darwin"       "macos-x86_64"    "oxp-runtime"
    stage_one "aarch64-unknown-linux-gnu" "linux-aarch64"   "oxp-runtime"
    stage_one "x86_64-unknown-linux-gnu"  "linux-x86_64"    "oxp-runtime"
    stage_one "aarch64-pc-windows-msvc"   "windows-aarch64" "oxp-runtime.exe"
    stage_one "x86_64-pc-windows-msvc"    "windows-x86_64"  "oxp-runtime.exe"
else
    # Detect current platform.
    case "$(uname -s)" in
        Darwin)  os=macos ;;
        Linux)   os=linux ;;
        MINGW*|CYGWIN*|MSYS*) os=windows ;;
        *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
    esac
    case "$(uname -m)" in
        arm64|aarch64) arch=aarch64 ;;
        x86_64|amd64)  arch=x86_64 ;;
        *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
    esac

    plugin_triple="$os-$arch"
    exe="oxp-runtime"; [[ "$os" == "windows" ]] && exe="oxp-runtime.exe"

    echo "→ building host runtime (debug, current platform)"
    (cd "$RUNTIME_DIR" && cargo build)
    out_dir="$OUT_ROOT/$plugin_triple"
    mkdir -p "$out_dir"
    cp "$RUNTIME_DIR/target/debug/$exe" "$out_dir/$exe"
    chmod +x "$out_dir/$exe" 2>/dev/null || true
    echo "  staged $out_dir/$exe"
fi

echo "done."
