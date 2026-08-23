# Review

This is the contract for a standard pull-request review in this repository. It
is not a second copy of [CONTRIBUTING.md](CONTRIBUTING.md). Each item is pass
or fail. Any fail keeps the pull request as a draft or on changes requested.

## 1. CONTRIBUTING.md applied fully and correctly

Every applicable rule in CONTRIBUTING.md is checked against the diff. A
declared deviation names the rule and the reason; an undeclared deviation is
fail. Declared is not granted — only the reviewer grants, in writing on the
pull request.

This item includes the EN/DE PR-body form and GitHub-verified commits.

## 2. Required CI green on the head SHA

Job `test` is `success` on **exactly this** SHA. That job includes the 100%
coverage gate (`c8 --check-coverage` on all four metrics) and the offered-route
catalog check (`test/test-offered-routes.sh`). A coverage miss or a catalog
miss is a red job, not a review note.

- `skipped` does not count as green unless this repository documents that skip
  as expected. Today: `test` is not skipped on drafts.
- `cancelled` is not a test failure and also not evidence.
- Image jobs (`front-api DEV` / `front-api PRD`) run on push to a branch, not
  on feature pull requests. They are not a gate for PRs into `develop`.
- For a release PR into `main`: `test` is green, and the development image tag
  was already published from `develop`.
- Job `Main only from develop` must be `success` on PRs into `main`.

## 3. Target branch and release path

Feature pull requests target `develop`. A pull request into `main` is valid
only when the head is this repository's `develop`, and only as the automatic
release PR. A manually opened PR into `main` is fail — that part is a
reviewer check, not CI. Job `Main only from develop` enforces only that the
head is this repository's `develop` (same repository, not a fork). It cannot
tell an automatic release PR from a manual one.

## 4. Mergeable, no conflicts

The pull request merges cleanly against its base.

## 5. Public-repository hygiene

The diff, commit messages, PR title, body, and comments obey the public
repository hygiene rule in CONTRIBUTING.md.

## 6. Tests cover the change

New or changed branches in `server.js` (503 vs 200, cache hit/miss, allowlist,
timeout, poller gate) have a pin in `test/test-server.sh`. Workflow-gate
changes have a pin in `test/test-main-from-develop.sh`. Automatic release-PR
body-form changes have a pin in `test/test-auto-release-pr.sh`. Green CI
without a pin for a behaviour change is fail. Every production `*.js` file
must report 100% statements, branches, functions and lines; a new script
under the coverage include that is untested fails CI.

## 7. Secrets and boot config

No secrets in the repository. A new environment variable read at boot is named
in README.md. If the live value is missing in the deployment environment, that
is a blocker — name no environment.

## 8. Image and workflow changes

Dockerfile, workflows, and tags `:beta` / `:latest` / SHA stay on the existing
pattern (`develop` → `:beta`, `main` → `:latest`, notify via `DISPATCH_TOKEN` /
`DISPATCH_REPO` when set). No silent change of `runs-on`, secret names, or
dispatch payload.

## 9. Scope

Only what the pull request claims. No drive-by cleanup that violates
CONTRIBUTING.md or lands untested.

## 10. Outward behaviour of this layer

If cache, 503 body, `x-front-api`, self-answered paths, or quote source change:
it is said in the PR body, a pin is present, and the swagger allowlist matches.

## 11. Usage catalog and frontend E2E

[offered-routes.json](offered-routes.json) lists every path this process
answers itself. Each row has `usedIn` (public consumer repo + file) and
`e2e` (frontend-inclusive E2E in a public repo + file). CI already fails
when a served path has no row or a row has empty fields. That is not
enough to merge.

- Fail if the pull request adds, removes, or changes how a self-answered
  path answers (status, body, cache, quote source, allowlist) and the named
  E2E does not actually cover that function **including the frontend**.
- The E2E may live in another public repository. It need not be on that
  repository's default branch. This repository's CI does **not** run those
  suites — the reviewer opens the named file (or the named branch / pull
  request) and checks it.
- A test that mocks the API and never reaches this process is fail.
- A unit or widget test without a UI flow through the real endpoint is
  fail for this item (it may still be a valid pin in the consumer).
- Naming a private repository in the catalog, the diff, or the pull
  request is fail (item 5). Private consumers are a generic note, not a
  `repo` field.
- Unchanged catalog rows this pull request does not touch: a weak or
  missing E2E is still reported; deferring it needs a written grant on
  the pull request.

Any fail on this item keeps the pull request as a draft or on changes
requested. There is no "follow-up E2E" for a new or changed offered
function unless the reviewer grants that in writing.
