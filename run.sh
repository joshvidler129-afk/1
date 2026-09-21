#!/usr/bin/env bash
# One-command launcher: installs the pinned hackerai into ./node_modules on
# first run, then starts it. Log in inside the app with /login (HackerAI
# account) or /addkey (Groq, Gemini, ...).
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

exec node node_modules/hackerai/index.js "$@"
