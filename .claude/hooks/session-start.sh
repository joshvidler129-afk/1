#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install shellcheck for linting shell scripts
if ! command -v shellcheck &>/dev/null; then
  apt-get install -y shellcheck 2>/dev/null || true
fi

# Ensure the setup script is executable
chmod +x "$CLAUDE_PROJECT_DIR/setup-claude-endpoint.sh"

# Install the pinned hackerai that run.sh launches
if [ -f "$CLAUDE_PROJECT_DIR/package.json" ] && [ ! -d "$CLAUDE_PROJECT_DIR/node_modules/hackerai" ]; then
  (cd "$CLAUDE_PROJECT_DIR" && npm install --no-audit --no-fund --loglevel=error) || true
fi
