#!/usr/bin/env bash
# Pin: every path this process answers itself is listed in offered-routes.json
# with a public usedIn pointer and a frontend E2E pointer. This job does not
# run foreign E2E suites.
#
# Arms:
#   offered-routes.json exists                         catalog_file
#   CI job test runs this script                       ci_wired
#   npm test runs this script                          npm_test
#   CONTRIBUTING names the catalog and E2E review gate contributing
#   REVIEW.md has the offered-route E2E item           review_item
#   node test/offered-routes.test.js (1:1 + schema)    catalog_1to1
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
catalog="$repo_root/offered-routes.json"
wf="$repo_root/.github/workflows/test.yml"
pkg="$repo_root/package.json"
contrib="$repo_root/CONTRIBUTING.md"
review="$repo_root/REVIEW.md"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$catalog" ] || fail "catalog_file: missing offered-routes.json"
grep -q 'test/test-offered-routes.sh' "$wf" || fail "ci_wired: test.yml must run test-offered-routes.sh"
grep -q 'test/test-offered-routes.sh' "$pkg" || fail "npm_test: package.json test must run test-offered-routes.sh"
grep -q 'offered-routes.json' "$contrib" || fail "contributing: offered-routes.json missing"
grep -q 'frontend E2E' "$contrib" || fail "contributing: frontend E2E missing"
grep -q 'offered-routes.json' "$review" || fail "review_item: offered-routes.json missing"
grep -q 'frontend E2E' "$review" || fail "review_item: frontend E2E missing"

node "$repo_root/test/offered-routes.test.js" || fail "catalog_1to1"

echo "ok offered-routes.json"
