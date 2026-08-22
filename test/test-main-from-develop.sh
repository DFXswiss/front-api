#!/usr/bin/env bash
# Pin test for .github/workflows/main-from-develop.yml
#
# Arms:
#   job name is Main only from develop               job_name
#   pull_request into main                           trigger_main
#   types include edited (base retarget)             trigger_types
#   HEAD_REF / HEAD_REPO / THIS_REPO from event      env_vars
#   empty metadata refuses to pass                   empty_meta
#   fork identity compared (HEAD_REPO vs THIS_REPO)  fork_check
#   branch compared (HEAD_REF vs develop)            develop_check
#   mismatch exits 1                                 fail_closed
#   runs-on ubuntu-latest                            runner
#   no YAML if: key (skipped required check = pass)  no_skip_if
#   no continue-on-error (failed step still green)   no_continue
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
wf="$repo_root/.github/workflows/main-from-develop.yml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$wf" ] || fail "missing: $wf"
grep -q 'name: Main only from develop' "$wf" || fail "job_name: Main only from develop missing"
grep -q 'pull_request:' "$wf" || fail "trigger_main: pull_request missing"
grep -q '^      - main$' "$wf" || fail "trigger_main: branches main missing"
for t in opened synchronize reopened ready_for_review edited labeled unlabeled; do
  grep -q "^      - ${t}$" "$wf" || fail "trigger_types: ${t} missing"
done
grep -q 'HEAD_REF:' "$wf" || fail "env_vars: HEAD_REF missing"
grep -q 'HEAD_REPO:' "$wf" || fail "env_vars: HEAD_REPO missing"
grep -q 'THIS_REPO:' "$wf" || fail "env_vars: THIS_REPO missing"
grep -q 'github.event.pull_request.head.ref' "$wf" || fail "env_vars: head.ref expression missing"
grep -q 'github.event.pull_request.head.repo.full_name' "$wf" || fail "env_vars: head.repo.full_name missing"
grep -q 'github.repository' "$wf" || fail "env_vars: github.repository missing"
grep -q 'Missing pull_request head metadata' "$wf" || fail "empty_meta: refusal message missing"
grep -q 'z "$HEAD_REF"' "$wf" || fail "empty_meta: HEAD_REF empty check missing"
grep -q 'z "$HEAD_REPO"' "$wf" || fail "empty_meta: HEAD_REPO empty check missing"
grep -q 'z "$THIS_REPO"' "$wf" || fail "empty_meta: THIS_REPO empty check missing"
grep -q 'HEAD_REPO" != "$THIS_REPO"' "$wf" || fail "fork_check: HEAD_REPO vs THIS_REPO missing"
grep -q 'not a fork' "$wf" || fail "fork_check: fork error message missing"
grep -q 'HEAD_REF" != "develop"' "$wf" || fail "develop_check: HEAD_REF vs develop missing"
grep -q "PRs into main must come from develop" "$wf" || fail "develop_check: non-develop error message missing"
exits=$(grep -c 'exit 1' "$wf" || true)
[ "$exits" -ge 3 ] || fail "fail_closed: expected >=3 exit 1 paths, got ${exits}"
grep -q 'runs-on: ubuntu-latest' "$wf" || fail "runner: ubuntu-latest missing"
if grep -E '^[[:space:]]+if:' "$wf"; then
  fail "no_skip_if: YAML if: key would skip a required check"
fi
if grep -E '^[[:space:]]+continue-on-error:' "$wf"; then
  fail "no_continue: continue-on-error would keep a failed gate green"
fi

echo "ok front-api main-from-develop"
