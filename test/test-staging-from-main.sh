#!/usr/bin/env bash
# Pin test for .github/workflows/staging-from-main.yml and .github/workflows/front-api-stg.yaml
#
# Arms:
#   staging workflow name                            ff_name
#   main push trigger and no pull_request            ff_trigger
#   top-level and job permissions                    ff_permissions
#   staging concurrency lock                         ff_concurrency
#   fast-forward job and runner                      ff_job
#   full history fetched                             ff_history
#   staging existence check and creation             ff_create
#   fast-forward only, no divergence                 ff_only
#   no force push                                    ff_no_force
#   staging ref push                                 ff_push
#   older head skips dispatch                        ff_older_head
#   older-head path requires staging on main         ff_staging_on_main
#   dispatch STG workflow from staging               ff_dispatch
#   every run block uses strict mode                 ff_strict
#   STG workflow name                                stg_name
#   staging push and manual triggers                 stg_trigger
#   STG image and tag                                stg_tag
#   STG concurrency lock                             stg_concurrency
#   STG job and runner                               stg_job
#   STG publish-branch guard                         stg_ref_guard
#   STG image tags and platform                      stg_tags
#   STG secrets                                      stg_secrets
#   STG infrastructure notification                  stg_notify
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
wf="$repo_root/.github/workflows/staging-from-main.yml"
stg_wf="$repo_root/.github/workflows/front-api-stg.yaml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$wf" ] || fail "ff_name: missing: $wf"
[ -f "$stg_wf" ] || fail "stg_name: missing: $stg_wf"

grep -Fq 'name: Staging from main' "$wf" || fail "ff_name: Staging from main missing"
grep -Fq 'push:' "$wf" || fail "ff_trigger: push trigger missing"
grep -Fq 'branches: [main]' "$wf" || fail "ff_trigger: main branch missing"
if grep -E '^  pull_request' "$wf"; then
  fail "ff_trigger: pull_request trigger must not be present"
fi
grep -Fq '  contents: read' "$wf" || fail "ff_permissions: top-level contents read missing"
grep -Fq '      contents: write' "$wf" || fail "ff_permissions: job contents write missing"
grep -Fq '      actions: write' "$wf" || fail "ff_permissions: job actions write missing"
grep -Fq 'group: staging-from-main' "$wf" || fail "ff_concurrency: staging-from-main group missing"
grep -Fq 'cancel-in-progress: false' "$wf" || fail "ff_concurrency: cancel-in-progress false missing"
grep -Fq '  fast-forward:' "$wf" || fail "ff_job: fast-forward job missing"
grep -Fq 'runs-on: ubuntu-latest' "$wf" || fail "ff_job: ubuntu-latest missing"
grep -Fq 'fetch-depth: 0' "$wf" || fail "ff_history: fetch-depth 0 missing"
grep -Fq 'git ls-remote --exit-code --heads origin staging' "$wf" || fail "ff_create: staging existence check missing"
grep -Fq 'git merge-base --is-ancestor "${STAGING_SHA}" "${SHA}"' "$wf" || fail "ff_only: forward-only ancestor check missing"
grep -Fq 'has diverged from main; refusing to force-push' "$wf" || fail "ff_only: divergence refusal missing"
if grep -Fq -- '--force' "$wf"; then
  fail "ff_no_force: --force must not be present"
fi
if grep -Fq -- '--force-with-lease' "$wf"; then
  fail "ff_no_force: --force-with-lease must not be present"
fi
if grep -Fq 'git push origin "+' "$wf"; then
  fail "ff_no_force: forced push refspec must not be present"
fi
if grep -Fq 'git push origin +' "$wf"; then
  fail "ff_no_force: forced push refspec must not be present"
fi
grep -Fq 'git push origin "${SHA}:refs/heads/staging"' "$wf" || fail "ff_push: staging ref push missing"
grep -Fq 'git merge-base --is-ancestor "${SHA}" "${STAGING_SHA}"' "$wf" || fail "ff_older_head: older-head check missing"
grep -Fq 'skip_dispatch=true' "$wf" || fail "ff_older_head: skip_dispatch output missing"
grep -Fq 'git merge-base --is-ancestor "${STAGING_SHA}" origin/main' "$wf" || fail "ff_staging_on_main: staging-on-main ancestor check missing"
grep -Fq 'contains commits that are not on main; refusing to continue' "$wf" || fail "ff_staging_on_main: non-main commit refusal missing"
grep -Fq "if: steps.fast_forward.outputs.skip_dispatch != 'true'" "$wf" || fail "ff_dispatch: dispatch condition missing"
grep -Fq 'GH_TOKEN: ${{ github.token }}' "$wf" || fail "ff_dispatch: GH_TOKEN missing"
grep -Fq 'gh workflow run front-api-stg.yaml --ref staging' "$wf" || fail "ff_dispatch: STG workflow dispatch missing"
if ! strict_count=$(grep -Fc 'set -euo pipefail' "$wf"); then
  strict_count=0
fi
[ "$strict_count" -ge 3 ] || fail "ff_strict: expected at least 3 strict-mode blocks, got ${strict_count}"

grep -Fq 'name: front-api STG' "$stg_wf" || fail "stg_name: front-api STG missing"
grep -Fq 'branches: [staging]' "$stg_wf" || fail "stg_trigger: staging branch missing"
grep -Fq 'workflow_dispatch:' "$stg_wf" || fail "stg_trigger: workflow_dispatch missing"
if grep -E '^  pull_request' "$stg_wf"; then
  fail "stg_trigger: pull_request trigger must not be present"
fi
grep -Fq 'IMAGE: dfxswiss/front-api' "$stg_wf" || fail "stg_tag: image name missing"
grep -Fq 'TAG: stg' "$stg_wf" || fail "stg_tag: stg tag missing"
grep -Fq 'group: front-api-stg' "$stg_wf" || fail "stg_concurrency: front-api-stg group missing"
grep -Fq 'cancel-in-progress: false' "$stg_wf" || fail "stg_concurrency: cancel-in-progress false missing"
grep -Fq '  build-and-push:' "$stg_wf" || fail "stg_job: build-and-push job missing"
grep -Fq 'name: Build and push Docker image (STG)' "$stg_wf" || fail "stg_job: STG job name missing"
grep -Fq 'runs-on: ubuntu-24.04-arm' "$stg_wf" || fail "stg_job: ubuntu-24.04-arm missing"
grep -Fq 'REF: ${{ github.ref }}' "$stg_wf" || fail "stg_ref_guard: REF env missing"
grep -Fq '"${REF}" != "refs/heads/staging"' "$stg_wf" || fail "stg_ref_guard: staging ref comparison missing"
grep -Fq 'The stg tag publishes only from refs/heads/staging' "$stg_wf" || fail "stg_ref_guard: refusal message missing"
grep -Fq '${{ env.IMAGE }}:${{ env.TAG }}' "$stg_wf" || fail "stg_tags: channel tag missing"
grep -Fq '${{ env.IMAGE }}:${{ github.sha }}' "$stg_wf" || fail "stg_tags: SHA tag missing"
grep -Fq 'platforms: linux/arm64' "$stg_wf" || fail "stg_tags: linux/arm64 missing"
grep -Fq 'secrets.DOCKER_USERNAME' "$stg_wf" || fail "stg_secrets: Docker username secret missing"
grep -Fq 'secrets.DOCKER_PASSWORD' "$stg_wf" || fail "stg_secrets: Docker password secret missing"
grep -Fq 'secrets.DISPATCH_TOKEN' "$stg_wf" || fail "stg_secrets: dispatch token secret missing"
grep -Fq 'secrets.DISPATCH_REPO' "$stg_wf" || fail "stg_secrets: dispatch repo secret missing"
grep -Fq 'event_type=image-published' "$stg_wf" || fail "stg_notify: image-published event missing"
grep -Fq 'client_payload[image]=${IMAGE}' "$stg_wf" || fail "stg_notify: image payload missing"
grep -Fq 'client_payload[tag]=${TAG}' "$stg_wf" || fail "stg_notify: tag payload missing"
grep -Fq 'client_payload[sha]=${GITHUB_SHA}' "$stg_wf" || fail "stg_notify: SHA payload missing"

echo "ok front-api staging-from-main"
