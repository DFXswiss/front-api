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

c8rc="$repo_root/.c8rc.json"
[ -f "$c8rc" ] || fail "coverage_100: missing .c8rc.json"
grep -q '"lines": 100' "$c8rc" || fail "coverage_100: lines 100 missing from .c8rc.json"
grep -q '"functions": 100' "$c8rc" || fail "coverage_100: functions 100 missing from .c8rc.json"
grep -q '"branches": 100' "$c8rc" || fail "coverage_100: branches 100 missing from .c8rc.json"
grep -q '"statements": 100' "$c8rc" || fail "coverage_100: statements 100 missing from .c8rc.json"
grep -q '"all": true' "$c8rc" || fail "coverage_all: all missing from .c8rc.json"
grep -Fq '"**/*.js"' "$c8rc" || fail "coverage_all: include **/*.js missing from .c8rc.json"
grep -Fq '"test/**"' "$c8rc" || fail "coverage_all: test exclude missing from .c8rc.json"
grep -Fq '"coverage/**"' "$c8rc" || fail "coverage_all: coverage exclude missing from .c8rc.json"
grep -Fq '"node_modules/**"' "$c8rc" || fail "coverage_all: node_modules exclude missing from .c8rc.json"
if grep -q 'server.js' "$c8rc"; then
  fail "coverage_all: production server.js must not be excluded"
fi
grep -q '"c8"' "$pkg" || fail "coverage_100: c8 missing from package.json"
grep -q 'npm ci' "$wf" || fail "coverage_100: CI must npm ci"
grep -q 'package-lock.json' "$repo_root/Dockerfile" || fail "coverage_100: image must use lockfile"
grep -q 'npm ci --omit=dev' "$repo_root/Dockerfile" || fail "coverage_100: image must npm ci omit dev"
grep -q 'require.main === module' "$server_js" || fail "boot only when main"
grep -Fq 'orFallback(process.env.REQUEST_TIMEOUT_MS, 20000)' "$server_js" || fail "REQUEST_TIMEOUT_MS default"
grep -q 'FRONT_API_EXIT_AFTER_BOOT=1' "$repo_root/test/run-main-coverage.sh" || fail "coverage_100: require.main collection missing"
grep -q 'coverage:report' "$pkg" || fail "coverage_100: coverage:report script missing"
grep -q -- '--check-coverage' "$pkg" || fail "coverage_100: check-coverage missing from package.json"

cd "$repo_root"
if [ ! -d node_modules/c8 ]; then
  npm ci
fi

npx c8 --reporter=text --reporter=text-summary node test/server.test.js || fail "server tests failed"

bash "$repo_root/test/run-main-coverage.sh" || fail "require.main coverage run failed"

npm run coverage:report || fail "coverage 100% gate failed"

echo "ok front-api server.js"
