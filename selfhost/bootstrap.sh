#!/usr/bin/env bash
# Bootstrap a self-hosted HackerAI (github.com/hackerai-tech/hackerai) instance
# on a fresh Debian/Ubuntu server. Installs Node 20 + pnpm + git, clones the app,
# installs dependencies, then hands off to the app's own interactive setup wizard.
#
# This is a SERVER script, not a phone script. The full app cannot run on Termux.
# Target: an always-on Linux VPS (e.g. Oracle Cloud Always-Free ARM, Ubuntu 22.04).
# Run as a normal user that has sudo.
#
# Usage:  bash bootstrap.sh [target-dir]      (default: ~/hackerai)

set -euo pipefail

REPO_URL="https://github.com/hackerai-tech/hackerai.git"
TARGET_DIR="${1:-$HOME/hackerai}"
NODE_MAJOR=20

log()  { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required (sudo apt-get install -y curl)."
command -v sudo >/dev/null 2>&1 || die "sudo is required."
command -v apt-get >/dev/null 2>&1 || die "This bootstrap targets Debian/Ubuntu (apt-get). On another distro, install Node 20 + git + corepack manually, then run 'pnpm install' in the repo."

if ! command -v git >/dev/null 2>&1; then
  log "Installing git"
  sudo apt-get update -y
  sudo apt-get install -y git
fi

need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$cur" -ge 18 ]; then
    need_node=0
    log "Node $(node -v) already present (>=18, ok)"
  else
    warn "Node $(node -v) is too old; installing Node ${NODE_MAJOR}"
  fi
fi
if [ "$need_node" -eq 1 ]; then
  log "Installing Node ${NODE_MAJOR} via NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

log "Enabling pnpm via corepack"
sudo corepack enable 2>/dev/null || warn "corepack enable failed; the repo pins pnpm via packageManager, so 'corepack pnpm ...' should still work."

if [ -d "$TARGET_DIR/.git" ]; then
  log "Updating existing checkout at $TARGET_DIR"
  git -C "$TARGET_DIR" pull --ff-only || warn "Skipped pull (local changes or diverged history)."
else
  log "Cloning HackerAI into $TARGET_DIR"
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

log "Installing dependencies"
corepack pnpm install || pnpm install

log "Machine is ready. Nothing secret was written yet."
cat <<NEXT

────────────────────────────────────────────────────────────────────
Next steps (interactive — these need YOUR OWN API keys):

  cd "$TARGET_DIR"
  pnpm run setup

The wizard prompts for OpenRouter, OpenAI, E2B, AWS S3, and WorkOS keys,
generates the server secrets for you, provisions Convex (choose the LOCAL
option to avoid a Convex account), and writes .env.local. It leaves
ABLITERATION_API_KEY blank — leave it blank to keep the models' normal behavior.

Because this is a server (not localhost), then edit .env.local:
  NEXT_PUBLIC_BASE_URL             = https://<your-domain-or-ip>
  NEXT_PUBLIC_WORKOS_REDIRECT_URI  = https://<your-domain-or-ip>/callback
and set that same callback URL in the WorkOS dashboard.

Start it:
  pnpm run dev            # or  pnpm run dev:local   if you chose local Convex

Agent mode (optional) also needs a Trigger.dev project and a third process:
  pnpm dev:trigger

Full walkthrough, the "which key goes where" map, keep-alive options, and the
cost/license reality: see selfhost/README.md and selfhost/ENV_CHECKLIST.md.
────────────────────────────────────────────────────────────────────
NEXT
