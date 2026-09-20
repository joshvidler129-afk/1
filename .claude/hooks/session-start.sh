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
