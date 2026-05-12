#!/usr/bin/env sh
# One-line installer for OXP.
#
# Usage (consumers):
#   curl -fsSL https://oxp.sh/install | sh
#
# What it does, with zero prompts:
#   1. Make sure Node.js ≥ 20 is on PATH (installs nvm + node if missing).
#   2. Install the @oxprotocol/cli npm package globally.
#   3. Detect installed IDEs and tell the user the *one* command to finish.
#
# The script never asks for sudo unless the OS literally requires it for
# the npm prefix. It never edits dotfiles beyond what nvm itself does.

set -eu

OXP_VERSION="${OXP_VERSION:-latest}"
PURPLE='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

say()  { printf "${PURPLE}oxp${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}!${RESET} %s\n" "$*"; }
die()  { printf "${RED}✗${RESET} %s\n" "$*" >&2; exit 1; }

need_node_major=20

# ── 1. Node ────────────────────────────────────────────────────────────────
have_node() {
  command -v node >/dev/null 2>&1 || return 1
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "${major:-0}" -ge "$need_node_major" ]
}

install_node_via_nvm() {
  say "installing Node.js ${need_node_major} via nvm…"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | sh
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install "$need_node_major" >/dev/null
  nvm use "$need_node_major" >/dev/null
}

if have_node; then
  ok "Node.js $(node -v) detected"
else
  warn "Node.js $need_node_major+ not found"
  install_node_via_nvm
  ok "Node.js $(node -v) installed"
fi

# ── 2. CLI ─────────────────────────────────────────────────────────────────
say "installing @oxprotocol/cli@${OXP_VERSION}…"
# npm prefix that doesn't need sudo on macOS/Linux.
if [ -z "${PREFIX:-}" ] && [ ! -w "$(npm prefix -g 2>/dev/null || echo /usr/local)" ]; then
  export NPM_CONFIG_PREFIX="$HOME/.local"
  mkdir -p "$HOME/.local/bin"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "add $HOME/.local/bin to PATH (e.g. in ~/.zshrc): export PATH=\"\$HOME/.local/bin:\$PATH\""
       export PATH="$HOME/.local/bin:$PATH" ;;
  esac
fi
npm install -g "@oxprotocol/cli@$OXP_VERSION" >/dev/null 2>&1 || \
  die "npm install failed — re-run with: npm install -g @oxprotocol/cli"
ok "installed: $(oxp --version 2>/dev/null || echo @oxprotocol/cli)"

# ── 3. Detect IDEs and tell user the next step ─────────────────────────────
ides=""
add_ide() { ides="${ides:+$ides, }$1"; }
[ -d "/Applications/Visual Studio Code.app" ] && add_ide "VS Code"
[ -d "/Applications/Cursor.app" ]              && add_ide "Cursor"
[ -d "/Applications/Windsurf.app" ]            && add_ide "Windsurf"
ls "/Applications" 2>/dev/null | grep -qiE '(IntelliJ|WebStorm|PyCharm|GoLand|RustRover|CLion|Rider|DataGrip|RubyMine|PhpStorm)' && \
  add_ide "JetBrains"
command -v nvim >/dev/null 2>&1 && add_ide "Neovim"
[ -z "$ides" ] && ides="(none detected)"

printf "\n${GREEN}OXP is installed.${RESET}\n\n"
printf "Detected IDEs: %s\n\n" "$ides"
printf "Next step — install any extension; the host plugin auto-installs on first use:\n\n"
printf "  ${PURPLE}oxp install @aldgar/git-panel${RESET}\n\n"
cat <<'EOF'
The CLI will:
  • install the OXP host plugin into every detected IDE
  • download and verify the extension
  • ask you once to approve the permissions it requests
  • open the extension UI in every running IDE window

That's it — no accounts, no logins, no settings to edit.

Docs:  https://oxp.sh/docs
EOF
