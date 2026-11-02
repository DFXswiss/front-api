#!/usr/bin/env bash
# Pin test for the A38 guard workflow and its repository configuration.
#
# Arms:
#   guard workflow exists and is named dfx pr guard     workflow_name
#   action pin is a 40-hex SHA and matches the guide   action_pin
#   no checkout and no run step                         no_checkout_no_run
#   documented events and permissions                   events_permissions
#   runner ubuntu-latest and job id guard              runner_job
#   manifest classifies test and excludes the guard    manifest
#   pr-guard enforces develop and leaves draft         pr_guard
#   contributing pointer names the config files        contributing
#   the standard document is not copied into this repo no_copy
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
wf="$repo_root/.github/workflows/a38-guard.yml"
test_wf="$repo_root/.github/workflows/test.yml"
manifest="$repo_root/.github/a38.json"
guard_cfg="$repo_root/.github/pr-guard.json"
contrib="$repo_root/CONTRIBUTING.md"
review="$repo_root/REVIEW.md"
pkg="$repo_root/package.json"
sha="b421c4a7c957738187aa620a44e2f115dd939bd1"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$wf" ] || fail "workflow_name: missing a38-guard.yml"
grep -Fq 'name: dfx pr guard' "$wf" || fail "workflow_name: dfx pr guard missing"
grep -Fq "uses: DFXswiss/agent/.github/actions/a38-guard@${sha}" "$wf" || fail "action_pin: pinned action missing"
grep -Eq 'a38-guard@[0-9a-f]{40}$' "$wf" || fail "action_pin: uses ref is not a 40-hex SHA"
if grep -q 'actions/checkout' "$wf"; then
  fail "no_checkout_no_run: the guard must not check out the pull request"
fi
if grep -E '^[[:space:]]+run:' "$wf"; then
  fail "no_checkout_no_run: the guard must not have a run step"
fi
if grep -E '^[[:space:]]+if:' "$wf"; then
  fail "no_checkout_no_run: a YAML if: key would skip the guard"
fi
grep -Fq 'pull_request_target:' "$wf" || fail "events_permissions: pull_request_target missing"
if grep -E '^  pull_request:$' "$wf"; then
  fail "events_permissions: pull_request would run this file from the pull request"
fi
grep -Fq 'types: [opened, reopened, synchronize, edited, ready_for_review]' "$wf" || fail "events_permissions: pull_request_target types missing"
grep -Fq 'issue_comment:' "$wf" || fail "events_permissions: issue_comment missing"
grep -Fq 'types: [created, edited, deleted]' "$wf" || fail "events_permissions: issue_comment types missing"
grep -Fq "cron: '17,47 * * * *'" "$wf" || fail "events_permissions: schedule missing"
grep -Fq 'workflow_dispatch:' "$wf" || fail "events_permissions: workflow_dispatch missing"
grep -Fq 'workflows: ["test"]' "$wf" || fail "events_permissions: workflow_run must name the test workflow"
grep -Fq 'types: [completed]' "$wf" || fail "events_permissions: workflow_run completed missing"
grep -Fq 'contents: write' "$wf" || fail "events_permissions: contents write missing"
grep -Fq 'issues: write' "$wf" || fail "events_permissions: issues write missing"
grep -Fq 'pull-requests: write' "$wf" || fail "events_permissions: pull-requests write missing"
grep -Fq 'statuses: write' "$wf" || fail "events_permissions: statuses write missing"
grep -Fq 'actions: write' "$wf" || fail "events_permissions: actions write missing"
grep -Fq 'checks: read' "$wf" || fail "events_permissions: checks read missing"
grep -Fq 'runs-on: ubuntu-latest' "$wf" || fail "runner_job: ubuntu-latest missing"
grep -Fq '  guard:' "$wf" || fail "runner_job: job id guard missing"
grep -Fq 'token: ${{ secrets.GITHUB_TOKEN }}' "$wf" || fail "runner_job: token must be GITHUB_TOKEN"

grep -Fq '"schema": "a38/v1"' "$manifest" || fail "manifest: schema missing"
grep -Fq '"mode": "enforce"' "$manifest" || fail "manifest: mode enforce missing"
grep -Fq '"documentation": "docs/a38.md"' "$manifest" || fail "manifest: documentation token missing"
grep -Fq '"workflow": ".github/workflows/test.yml"' "$manifest" || fail "manifest: test workflow missing"
grep -Fq '"job": "test"' "$manifest" || fail "manifest: test job missing"
grep -Fq 'bash test/test-server.sh' "$manifest" || fail "manifest: test-server.sh missing from the command"
grep -Fq 'bash test/test-offered-routes.sh' "$manifest" || fail "manifest: test-offered-routes.sh missing from the command"
grep -Fq 'bash test/test-main-from-develop.sh' "$manifest" || fail "manifest: test-main-from-develop.sh missing from the command"
grep -Fq 'bash test/test-auto-release-pr.sh' "$manifest" || fail "manifest: test-auto-release-pr.sh missing from the command"
grep -Fq 'bash test/test-a38-guard.sh' "$manifest" || fail "manifest: test-a38-guard.sh missing from the command"
grep -Fq '"workflow": ".github/workflows/a38-guard.yml"' "$manifest" || fail "manifest: guard exclusion missing"
grep -Fq '"job": "guard"' "$manifest" || fail "manifest: guard job exclusion missing"
grep -Fq '"workflow": ".github/workflows/auto-release-pr.yaml"' "$manifest" || fail "manifest: auto-release exclusion missing"
grep -Fq '"job": "create-release-pr"' "$manifest" || fail "manifest: create-release-pr exclusion missing"
grep -Fq '"workflow": ".github/workflows/front-api-dev.yaml"' "$manifest" || fail "manifest: dev image exclusion missing"
grep -Fq '"workflow": ".github/workflows/front-api-prd.yaml"' "$manifest" || fail "manifest: prd image exclusion missing"
grep -Fq '"job": "build-and-push"' "$manifest" || fail "manifest: build-and-push exclusion missing"
grep -Fq '"workflow": ".github/workflows/main-from-develop.yml"' "$manifest" || fail "manifest: main-from-develop exclusion missing"
grep -Fq '"job": "only-develop"' "$manifest" || fail "manifest: only-develop exclusion missing"

grep -Fq '"schema": "pr-guard/v1"' "$guard_cfg" || fail "pr_guard: schema missing"
grep -Fq '"enforce": [' "$guard_cfg" || fail "pr_guard: enforce missing"
grep -Fq '"develop"' "$guard_cfg" || fail "pr_guard: develop missing"
grep -Fq '"exclude": [' "$guard_cfg" || fail "pr_guard: exclude missing"
grep -Fq '"main"' "$guard_cfg" || fail "pr_guard: main missing"
grep -Fq '"default": "enforce"' "$guard_cfg" || fail "pr_guard: default enforce missing"
grep -Fq '"auto_ready": true' "$guard_cfg" || fail "pr_guard: auto_ready missing"
grep -Fq '"enabled": true' "$guard_cfg" || fail "pr_guard: enabled missing"
grep -Fq '".github/workflows/test.yml"' "$guard_cfg" || fail "pr_guard: test workflow missing"
grep -Fq '".github/workflows/a38-guard.yml"' "$guard_cfg" || fail "pr_guard: guard workflow missing"
grep -Fq '"test"' "$guard_cfg" || fail "pr_guard: required check test missing"
for login in davidleomay TaprootFreak TaprootFreakAI Danswar davidleomayAI Daniel-DFX; do
  grep -Fq "\"${login}\"" "$guard_cfg" || fail "pr_guard: ${login} missing from one_review_authors"
done

grep -Fq 'Pull requests in this repository follow the A38 process.' "$contrib" || fail "contributing: process sentence missing"
grep -Fq "The process is pinned at commit ${sha}." "$contrib" || fail "contributing: pin sentence missing"
grep -Fq 'The configuration is `.github/a38.json` and `.github/pr-guard.json`.' "$contrib" || fail "contributing: configuration sentence missing"
grep -Fq 'This page is a pointer to that process, not a copy of it.' "$contrib" || fail "contributing: pointer sentence missing"
grep -Fq 'The guard workflow leaves draft after the review record is valid and the required checks are green.' "$contrib" || fail "contributing: leave-draft sentence missing"
grep -Fq 'bash test/test-a38-guard.sh' "$contrib" || fail "contributing: suite must name this script"
grep -Fq 'the five bash commands documented below.' "$contrib" || fail "contributing: five bash commands missing"
grep -Fq 'test/test-a38-guard.sh' "$test_wf" || fail "contributing: test.yml must run this script"
grep -Fq 'test/test-a38-guard.sh' "$pkg" || fail "contributing: package.json test must run this script"
grep -Fq 'A38 guard workflow changes have a pin in `test/test-a38-guard.sh`.' "$review" || fail "contributing: REVIEW.md pin sentence missing"

if [ -e "$repo_root/docs/a38.md" ] || [ -e "$repo_root/docs/a38-guard.md" ]; then
  fail "no_copy: do not copy the A38 standard into this repository"
fi

echo "ok front-api a38-guard"
