#!/usr/bin/env bash
# Collect coverage for `node server.js` as the process entry (require.main).
set -euo pipefail
export BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:9}"
export PORT="${PORT:-0}"
export BIND="${BIND:-127.0.0.1}"
export REQUEST_TIMEOUT_MS="${REQUEST_TIMEOUT_MS:-50}"
export FRONT_API_EXIT_AFTER_BOOT=1
exec npx c8 --clean=false --reporter=none node server.js
