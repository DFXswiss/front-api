#!/usr/bin/env bash
# Pin test + 100% coverage gate for production JS (c8).
#
# Arms:
#   RAM miss → 503                                   ram_miss
#   RAM stale (older than QUOTE_TTL_MS) → 503        ram_stale
#   RAM fresh → 200                                  ram_fresh
#   swagger snapshot empty → 503 local body          swagger_empty
#   attachRequestTimeout → callback + destroy        proxy_timeout
#   poller default off (QUOTE_BOOK_REFRESH!==1)      poller_off
#   c8 100% lines/functions/branches/statements      coverage_100
#   c8 --all includes every new production .js file  coverage_all
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
server_js="$repo_root/server.js"
test_js="$repo_root/test/server.test.js"
wf="$repo_root/.github/workflows/test.yml"
pkg="$repo_root/package.json"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$server_js" ] || fail "missing: $server_js"
[ -f "$test_js" ] || fail "missing: $test_js"
grep -q "QUOTE_BOOK_REFRESH === '1'" "$server_js" || fail "poller_off: gate missing"
grep -q 'refreshQuoteBook();' "$server_js" || fail "poller_off: refresh helper missing"
grep -q 'function isServedPath' "$server_js" || fail "isServedPath missing"
grep -q 'if (!isServedPath(p)) continue' "$server_js" || fail "swagger snapshot must allowlist served paths"
if grep -q 'low.includes' "$server_js"; then
  fail "swagger snapshot must not denylist unserved routes"
fi

grep -q '"c8"' "$pkg" || fail "coverage_100: c8 missing from package.json"
grep -q -- '--check-coverage' "$repo_root/test/test-server.sh" || fail "coverage_100: check-coverage missing"
grep -q -- '--lines=100' "$repo_root/test/test-server.sh" || fail "coverage_100: lines 100 missing"
grep -q -- '--functions=100' "$repo_root/test/test-server.sh" || fail "coverage_100: functions 100 missing"
grep -q -- '--branches=100' "$repo_root/test/test-server.sh" || fail "coverage_100: branches 100 missing"
grep -q -- '--statements=100' "$repo_root/test/test-server.sh" || fail "coverage_100: statements 100 missing"
grep -q -- '--all' "$repo_root/test/test-server.sh" || fail "coverage_all: --all missing"
grep -Fq -- "--include='**/*.js'" "$repo_root/test/test-server.sh" || fail "coverage_all: include **/*.js missing"
grep -Fq -- "--exclude='test/**'" "$repo_root/test/test-server.sh" || fail "coverage_all: test exclude missing"
grep -Fq -- "--exclude='coverage/**'" "$repo_root/test/test-server.sh" || fail "coverage_all: coverage exclude missing"
grep -Fq -- "--exclude='node_modules/**'" "$repo_root/test/test-server.sh" || fail "coverage_all: node_modules exclude missing"
if grep -E -- '--exclude=.*server\.js' "$repo_root/test/test-server.sh"; then
  fail "coverage_all: production server.js must not be excluded"
fi
grep -q 'npm ci' "$wf" || grep -q 'npm install' "$wf" || fail "coverage_100: CI must install c8"
grep -q 'FRONT_API_EXIT_AFTER_BOOT=1' "$repo_root/test/test-server.sh" || fail "coverage_100: require.main collection missing"
grep -q 'require.main === module' "$server_js" || fail "boot only when main"

cd "$repo_root"
if [ ! -d node_modules/c8 ]; then
  npm install
fi

c8_common=(
  --temp-directory=coverage/tmp
  --all
  --include='**/*.js'
  --exclude='test/**'
  --exclude='coverage/**'
  --exclude='node_modules/**'
)

npx c8 "${c8_common[@]}" \
  --reporter=text \
  --reporter=text-summary \
  node test/server.test.js || fail "server tests failed"

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:9}" \
  PORT=0 \
  BIND=127.0.0.1 \
  REQUEST_TIMEOUT_MS=50 \
  FRONT_API_EXIT_AFTER_BOOT=1 \
  npx c8 --clean=false "${c8_common[@]}" --reporter=none node server.js || fail "require.main coverage run failed"

npx c8 "${c8_common[@]}" \
  --check-coverage \
  --lines=100 \
  --functions=100 \
  --branches=100 \
  --statements=100 \
  report || fail "coverage 100% gate failed"

echo "ok front-api server.js"
