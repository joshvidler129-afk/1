#!/usr/bin/env bash
# Configure and launch Claude with a custom API endpoint.
# Usage: ./setup-claude-endpoint.sh [base_url] [auth_token]
#   or:  source .env && ./setup-claude-endpoint.sh

set -euo pipefail

BASE_URL="${1:-${ANTHROPIC_BASE_URL:-}}"
AUTH_TOKEN="${2:-${ANTHROPIC_AUTH_TOKEN:-}}"

if [[ -z "$BASE_URL" || -z "$AUTH_TOKEN" ]]; then
  echo "Error: ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN must be set." >&2
  echo "  export ANTHROPIC_BASE_URL=https://your-proxy.example.com" >&2
  echo "  export ANTHROPIC_AUTH_TOKEN=sk-..." >&2
  exit 1
fi

export ANTHROPIC_BASE_URL="$BASE_URL"
export ANTHROPIC_API_KEY="$AUTH_TOKEN"
export ANTHROPIC_AUTH_TOKEN="$AUTH_TOKEN"

exec claude "$@"
