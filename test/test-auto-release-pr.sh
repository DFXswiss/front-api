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
en_block=$(grep -A3 '^            "EN:" \\$' "$wf" || true)
echo "$en_block" | grep -q '^            "" \\$' || fail "blank line between EN and DE missing"
echo "$en_block" | grep -q '^            "DE:" \\$' || fail "DE: not in the EN block"
grep -q '<details>' "$wf" || fail "details missing"
grep -q '<summary>Details</summary>' "$wf" || fail "summary missing"
grep -q '</details>' "$wf" || fail "closing details missing"
grep -A1 '<summary>Details</summary>' "$wf" | grep -q '^            "" \\$' || fail "blank line after </summary> missing"
grep -q 'gh pr create' "$wf" || fail "gh pr create missing"
grep -q -- '--draft' "$wf" || fail "draft flag missing"
grep -q -- '--base main' "$wf" || fail "base main missing"
grep -q -- '--head develop' "$wf" || fail "head develop missing"

echo "ok front-api auto-release-pr"
