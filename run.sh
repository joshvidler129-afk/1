#!/usr/bin/env bash
# One-command launcher: installs the pinned hackerai into ./node_modules on
# first run, then starts it against the endpoint in .env (created on first
# run if missing).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. On Termux: pkg install nodejs" >&2
  exit 1
fi

if [ ! -d node_modules/hackerai ]; then
  echo "Installing hackerai (first run only)..."
  npm install --no-audit --no-fund --loglevel=error
fi

exec node hackerai-proxy.js "$@"
