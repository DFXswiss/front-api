#!/usr/bin/env bash
# local one-command start (stub + process)          local_start
# Pin test + 100% coverage gate for production JS (c8).
#
# Arms:
#   local one-command start (stub + process)          local_start
#   swagger snapshot empty → 503 local body          swagger_empty
#   a path outside the allowlist is forwarded        unknown_forward
#   expired GET /v1/asset after TTL → 503            ttl_expire
#   default CACHE_TTL_MS is 5 minutes                cache_ttl_default
#   attachRequestTimeout on background refresh only  refresh_timeout
#   no in-memory special-case book / stale cache     quotes_gone
#   known GET ≤ 100ms; unknown is forwarded          max_response_100
#   known miss is 503 not served                     known_local
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
grep -q 'function isServedPath' "$server_js" || fail "isServedPath missing"
grep -q 'if (!isServedPath(p)) continue' "$server_js" || fail "swagger snapshot must allowlist served paths"
if grep -q 'low.includes' "$server_js"; then
  fail "swagger snapshot must not denylist unserved routes"
fi
for banned in quoteBook refreshQuoteBook QUOTE_BOOK_REFRESH RAM_GET_PATHS scaleQuote isQuoteFresh pairKey rememberQuote EXACT_PUT_PATHS QUOTE_TTL_MS; do
  if grep -q "$banned" "$server_js"; then
    fail "server.js must not contain $banned"
  fi
done
if grep -qE "x-front-api': 'stale'|\"x-front-api\": \"stale\"" "$server_js"; then
  fail "server.js must not serve stale cache"
fi
grep -q 'unknown_forward' "$test_js" || fail "unknown_forward: pin missing"
grep -Fq 'never named' "$repo_root/CONTRIBUTING.md" || fail "unknown_forward: CONTRIBUTING must forbid naming unknown routes"
grep -Fq 'maxMs === undefined ? 100 : maxMs' "$test_js" || fail "known_local: helper 100ms cap is known routes only"
grep -q 'ttl_expire' "$test_js" || fail "ttl_expire: pin missing"
grep -Fq "CACHE_TTL_MS = '2000'" "$test_js" || fail "ttl_expire: CACHE_TTL_MS pin missing"
grep -Fq 'orFallback(process.env.CACHE_TTL_MS, 300000)' "$server_js" || fail "cache_ttl_default: 5 minutes missing"

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
grep -Fq 'MAX_RESPONSE_MS = 100' "$server_js" || fail "max_response_100: constant missing"
grep -q 'response deadline exceeded' "$server_js" || fail "max_response_100: deadline 503 missing"
grep -Fq 'REQUEST_TIMEOUT_MS = outboundTimeoutMs(' "$server_js" || fail "max_response_100: REQUEST_TIMEOUT_MS must cap at MAX_RESPONSE_MS"
grep -Fq 'if (!Number.isFinite(n) || n <= 0)' "$server_js" || fail "max_response_100: outbound timeout 0/NaN must not disable the cap"
grep -q 'connectionTimeoutMillis: 90' "$server_js" || fail "max_response_100: pool acquire must not outlive the deadline"
grep -Fq 'orFallback(process.env.REQUEST_TIMEOUT_MS, MAX_RESPONSE_MS)' "$server_js" || fail "REQUEST_TIMEOUT_MS default cap"
grep -q 'attachResponseBudget(req, res)' "$server_js" || fail "max_response_100: inbound budget missing on known routes"
grep -q 'function isKnownLocalRequest' "$server_js" || fail "known_local: must distinguish known GET routes from unknown"
if ! grep -q 'function proxy' "$server_js"; then
  fail "unknown_forward: unknown requests must be forwarded"
fi
grep -q 'req.pipe' "$server_js" || fail "unknown_forward: must pipe unknown requests outbound"
grep -q 'net.connect' "$server_js" || fail "unknown_forward: upgrades must be tunnelled"
grep -Fq 'ERROR response exceeded' "$server_js" || fail "max_response_100: production must ERROR-log a deadline miss"
grep -q "SET statement_timeout TO 90" "$server_js" || fail "max_response_100: pool queries must not outlive the deadline"
grep -q 'limit - 10' "$server_js" || fail "max_response_100: fire before 100ms so the 503 still finishes in budget"
grep -Fq 'if (!canWrite(res)) return;' "$server_js" || fail "max_response_100: writers must refuse after the deadline"
grep -Fq 'if (!res.destroyed) req.destroy();' "$server_js" || fail "max_response_100: deadline must cut an unfinished drain"
grep -Fq "connection: 'close'" "$server_js" || fail "max_response_100: deadline 503 must close the connection"
grep -q 'function rejectUnserved' "$server_js" || fail "known_local: uncached known GETs must 503 not served"
grep -q 'refreshCache' "$server_js" || fail "known_local: GET cache must fill off the request path"
grep -Fq "['/', ...CACHE_PREFIXES]" "$server_js" || fail "known_local: background refresh must include GET /"
grep -q 'function cacheRefreshPaths' "$server_js" || fail "known_local: GET cache refresh set must include roots and listed swagger paths"
grep -Fq "req.method !== 'GET' && req.method !== 'HEAD'" "$server_js" || fail "known_local: GET and HEAD must be listed and cacheable"
grep -Fq "startsWith(prefix + '/')" "$server_js" || fail "known_local: CACHE_PREFIXES must list nested paths"
if grep -Fq 'return isCacheable(req)' "$server_js"; then
  fail "known_local: Authorization must not make a listed request unknown"
fi
grep -Fq "(req.url ?? '/')" "$server_js" || fail "known_local: request path fallback must use ??"
grep -Fq "if (!isKnownLocalRequest(req))" "$server_js" || fail "known_local: budget must not wrap forwarded requests"
grep -Fq "forbidden** to" "$repo_root/CONTRIBUTING.md" || fail "known_local: CONTRIBUTING must forbid waiting on the backend for known routes"
grep -Fq "no** 100ms" "$repo_root/CONTRIBUTING.md" || fail "unknown_forward: CONTRIBUTING must say forwarded requests have no 100ms rule"
grep -Fq 'never forwarded' "$repo_root/README.md" || fail "known_local: README must say listed routes are never forwarded"
grep -Fq 'must **never wait** on `BACKEND_URL`' "$repo_root/CONTRIBUTING.md" || fail "known_local: listed requests must never wait on BACKEND_URL"
grep -Fq 'Forwarding a listed route is a hard fail' "$repo_root/REVIEW.md" || fail "known_local: REVIEW must fail listed forwarding"
grep -q 'Unknown routes' "$repo_root/REVIEW.md" || fail "unknown_forward: REVIEW must require forwarding unknown routes"
grep -q 'forbidden' "$repo_root/CONTRIBUTING.md" || fail "max_response_100: CONTRIBUTING must forbid code that cannot meet 100ms on known routes"
grep -q 'ERROR' "$repo_root/CONTRIBUTING.md" || fail "max_response_100: CONTRIBUTING must require an ERROR log on a deadline miss"
grep -q 'FRONT_API_EXIT_AFTER_BOOT=1' "$repo_root/test/run-main-coverage.sh" || fail "coverage_100: require.main collection missing"
grep -q 'coverage:report' "$pkg" || fail "coverage_100: coverage:report script missing"
grep -q -- '--check-coverage' "$pkg" || fail "coverage_100: check-coverage missing from package.json"

grep -Fq '"start": "node scripts/start-local.js"' "$repo_root/package.json" || fail "local_start: package.json must define npm start"
test -f "$repo_root/scripts/start-local.js" || fail "local_start: scripts/start-local.js missing"
test -f "$repo_root/scripts/local-backend.js" || fail "local_start: scripts/local-backend.js missing"
grep -Fq '"scripts/**"' "$repo_root/.c8rc.json" || fail "local_start: scripts must be excluded from production coverage"
if grep -q 'server.js' "$repo_root/.c8rc.json"; then fail "coverage_all: production server.js must not be excluded"; fi
if grep -q scripts "$repo_root/Dockerfile"; then fail "local_start: Dockerfile must not copy scripts/"; fi
grep -Fq 'npm start' "$repo_root/README.md" || fail "local_start: README must document npm start"
grep -Fq 'npm start' "$repo_root/CONTRIBUTING.md" || fail "local_start: CONTRIBUTING must document npm start"
grep -Fq 'scripts/**' "$repo_root/CONTRIBUTING.md" || fail "local_start: CONTRIBUTING must document scripts coverage"
if grep -Eq 'createLocalBackend|shouldStartLocalBackend|applyLocalDefaults' "$repo_root/server.js"; then
  fail "local_start: stub helpers must not be added to production server.js"
fi
test -f "$repo_root/test/local-start.test.js" || fail "local_start: test/local-start.test.js missing"

cd "$repo_root"
if [ ! -d node_modules/c8 ]; then
  npm ci
fi

npx c8 --reporter=text --reporter=text-summary node test/server.test.js || fail "server tests failed"

bash "$repo_root/test/run-main-coverage.sh" || fail "require.main coverage run failed"

npm run coverage:report || fail "coverage 100% gate failed"

node "$repo_root/test/local-start.test.js" || fail "local_start: node test/local-start.test.js failed"

echo "ok front-api server.js"
