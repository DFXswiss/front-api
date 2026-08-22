#!/usr/bin/env bash
# Pin test for .github/workflows/auto-release-pr.yaml PR body form
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
wf="$repo_root/.github/workflows/auto-release-pr.yaml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$wf" ] || fail "missing: $wf"
grep -q '^            "EN:" \\$' "$wf" || fail "EN: label missing"
grep -q '^            "DE:" \\$' "$wf" || fail "DE: label missing"
grep -q '<details>' "$wf" || fail "details missing"
grep -q '<summary>Details</summary>' "$wf" || fail "summary missing"
grep -q '^            "" \\$' "$wf" || fail "blank line for details rendering missing"
grep -q 'gh pr create' "$wf" || fail "gh pr create missing"
grep -q -- '--draft' "$wf" || fail "draft flag missing"
grep -q -- '--base main' "$wf" || fail "base main missing"
grep -q -- '--head develop' "$wf" || fail "head develop missing"

echo "ok front-api auto-release-pr"
