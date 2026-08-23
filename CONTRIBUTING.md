# Contributing

## Deviating From These Rules

These guidelines are binding. A pull request that knowingly does not meet one of
them must say so **explicitly in its description**, naming the rule it departs
from and the reason. An undeclared deviation is not a discussion point — the
pull request is rejected.

A declared deviation is the reviewer's call: they may accept it or refuse it at
their own discretion. Declaring one is not the same as being granted one.

## Review

Reviewers follow [REVIEW.md](REVIEW.md). A standard review starts with whether
this file was applied fully and correctly.

## Build & Test

Use `npm start` for a one-command local start. It starts a loopback HTTP stub and then this process; setting `BACKEND_URL` uses that upstream HTTP backend without starting the stub. This convenience command does not replace the test suite, which remains the four bash commands documented below.

The 100% coverage gate applies to production JavaScript. The `scripts/` directory contains local start helpers and is not copied into the Docker image, so c8 excludes `scripts/**`. Production `server.js` must not be excluded, and production code must not be listed in `--exclude`.

The complete c8 exclude list is:

```text
--exclude='test/**' --exclude='coverage/**' --exclude='node_modules/**' --exclude='scripts/**'
```

The required suite is the GitHub Actions job `test`. It runs `npm ci`, then
`bash test/test-server.sh` (behaviour pins **and** the 100% coverage gate),
`bash test/test-offered-routes.sh` (usage catalog vs the served-path
allowlist), `bash test/test-main-from-develop.sh`, and
`bash test/test-auto-release-pr.sh`. Employees are not required to run it
locally; those four commands are the local equivalent (`npm ci` first if `c8`
is missing). Draft pull requests still run `test`. This repository does not
skip CI on drafts and has no `ci:full` label.

```bash
bash test/test-server.sh
bash test/test-offered-routes.sh
bash test/test-main-from-develop.sh
bash test/test-auto-release-pr.sh
```

Every production JavaScript file must stay at **100% statement, branch,
function and line coverage**. CI enforces this with `c8 --check-coverage`
(see `.c8rc.json`: `--all --include='**/*.js' --exclude='test/**' --exclude='coverage/**' --exclude='node_modules/**' --exclude='scripts/**'`,
and 100 on all four metrics). A result below 100% on any metric turns the
`test` job red. `--all` plus that include/exclude pulls every new `*.js` file
outside `test/` and `scripts/` into the report at 0% until tests exist.
Production code must not be listed in `--exclude`; `scripts/` remains the
documented exception exclude.

## Git & PRs

- Branch from `develop`. Never commit directly to `develop` or `main`.
- Feature branch names are short and unique. An 8-character work prefix plus a
  topic is fine. `feat/` and `fix/` prefixes are not required.
- Commit subjects: imperative mood, no trailing period.
- Commits must be GitHub-verified (signed with the author's GitHub-mapped
  identity). Do not rewrite already-pushed commits to re-sign.
- Open feature pull requests as drafts against `develop`.
- Squash-and-merge when merging to `develop` — the squash keeps only the PR
  title.
- Release PRs (`develop` → `main`) are created automatically — never open them
  manually.
- CI rejects a pull request into `main` unless its head is this repository's
  `develop` branch (check name `Main only from develop`). The check also rejects
  forks even if the branch is named `develop`.
- Merging into `main` publishes the production image tag; that merge is a human
  decision.
- A pull request lands complete or it does not land. Findings raised in review
  on your own pull request are fixed in that pull request — never deferred to a
  follow-up unless the reviewer grants that in writing on the pull request.
- A defect in code a pull request touches is reported with the same evidence
  whether the change introduced it or it was already there. Fixing versus
  deferring a pre-existing bug is a separate reviewer grant.

## PR description form

The visible summary is an EN/DE block, at most four sentences per language. The
rest goes in `<details>`. Labels stand alone on their line; leave a blank line
between the languages; leave a blank line after `</summary>` so GitHub renders
Markdown inside the details.

```
EN:
English text

DE:
Deutscher Text

<details>
<summary>Details</summary>

Full explanation.

</details>
```

This is a public repository: English in commit messages, code comments, and the
details body. The `DE:` block is the German summary only.

## PR Completeness

When applicable, every pull request must include:

1. **Environment / image / workflow updates** when boot or the image is
   affected (`BACKEND_URL`, `SQL_*`, `CACHE_*`,
   `REQUEST_TIMEOUT_MS`, `FRONT_API_EXIT_AFTER_BOOT`, `PORT`, `BIND`,
   Dockerfile, `.github/workflows`).
2. **A pin** in `test/test-server.sh` (`server.js` behaviour),
   `test/test-main-from-develop.sh` (the main-source gate), and/or
   `test/test-auto-release-pr.sh` (the automatic release-PR body) for every
   behaviour the pull request changes.
3. **Swagger allowlist** update when the set of paths this process answers
   itself changes (`isServedPath`, `CACHE_PREFIXES`).
4. **`offered-routes.json`** update for every path this process answers
   itself: a `usedIn` pointer (public consumer repo + file, or
   `unidentified: true` with a note) and an `e2e` pointer
   (frontend-inclusive E2E in a public repo + file, or `unidentified: true`
   with a note). CI checks the catalog is complete and the fields are
   present. CI does **not** run foreign E2E suites — reviewers do, per
   [REVIEW.md](REVIEW.md). The E2E need not live on that other repository's
   default branch. An `unidentified` row is catalog-complete for CI and is
   **not** a grant to change that path. Private repositories are not named.
5. **A note in the PR body** when the outward behaviour of this layer changes
   (cache, 503 bodies, `x-front-api`, which paths are answered here versus
   forwarded). Do not name private repositories. Do not name unknown routes.
   Public consumer paths belong in `offered-routes.json`.

Missing any applicable item = changes requested.

## Before Merge

- Remove merge markers, commented-out code, and stale comments.
- Resolve TODO comments if possible.
- No `console.log` on the production path. `console.error` and boot logs are
  allowed (this process has no separate logger).
- Code comments in English.

## General Principles

- **Clarity over cleverness** — readable code beats short but obscure
  expressions.
- **Consistency** — same patterns everywhere.
- **Minimal changes** — do not rebuild what already works.
- **No over-engineering** — do not add layers this process does not need.

## This process

- This process answers a **fixed** set of routes itself from local state
  (version, swagger snapshot, fresh GET cache, optional Postgres). Those
  **known** routes must finish within **100ms**. It is **forbidden** to
  satisfy them by waiting on `BACKEND_URL` or any other system that cannot
  guarantee 100ms. A cache miss on a known GET is `503` `not served`
  immediately — never a live backend fetch on that request.
- Every other request (routes this process does **not** know) is forwarded
  to `BACKEND_URL`. Forwarded requests have **no** 100ms rule. Unknown
  routes are **never named** in this repository: they are only the
  complement of the known allowlist.
- The backend is contacted on the request path only for unknown routes.
  Swagger snapshot and GET-cache refresh stay **off** the request path and
  exist only to serve known GETs from local state.
- The swagger snapshot is an **allowlist** of paths this process serves, not a
  denylist.
- Authenticated requests are never answered from the GET cache. `GET /version`
  and swagger remain local even with `Authorization`.
- Never serve an expired cache body.
- Every **known** HTTP response from this process must complete within
  **100ms**. That bound is technical and always enforced, not a target. The
  process must cut a known request so the client never waits longer (`503`
  `response deadline exceeded`) and must emit an `ERROR` log. It is
  **forbidden** to add code on a known route that cannot finish in that
  budget: forwarding to the backend, unbounded awaits, blocking work,
  uncapped outbound waits, sleeps, or any other path that would let a ping
  of a known route exceed 100ms. `REQUEST_TIMEOUT_MS` may only lower
  background outbound waits for cache/swagger refresh, never raise them
  above 100ms. Do not attach that budget to forwarded unknown requests.
- Do not expose internals in responses (SQL credentials, backend hosts, or
  other secrets).

## Naming & code style

- camelCase, American English, methods are verbs, positive boolean names.
- Always `===`. Use `??`, not `||`. Guard clauses and early returns. Split
  nested ternaries into named intermediates.
- Trailing commas in multi-line literals.
- No magic booleans. Configuration via environment variables, not hardcoded
  values.

## Public repository hygiene

Never name private or internal repositories, internal hostnames, or
infrastructure internals in code, comments, docs, commit messages, PR titles,
PR bodies, or PR comments. Phrase generically ("the deployment environment",
"the infrastructure config"). Functional workflow values such as `runs-on`
labels are allowed; descriptive hostnames are not.

## Testing

Pin tests live under `test/`. A failure mode is tested at the lowest layer that
can express it (here: the Node helper and/or grep pins, not a production HTTP
round-trip). A behaviour change without a new or updated pin is incomplete even
if CI is green.

There is no production JavaScript in this repository that may ship below 100%
coverage. The coverage gate is the CI job, not a review courtesy.

There is no **known** HTTP response this process may take longer than 100ms
to finish. Unknown requests are forwarded and are not in that budget.
`test/test-server.sh` pins `MAX_RESPONSE_MS = 100`, the inbound deadline on
known routes, that known routes are not forwarded, that unknown routes are
forwarded, the `ERROR` log, and the background outbound cap. The Node suite
rejects any **known-route** helper round-trip over 100ms. A miss is a red
`test` job, not a review note.

Every path this process answers itself also needs **frontend E2E** coverage:
a real UI flow that hits that function, listed in `offered-routes.json`.
Those tests usually live in the consumer repository (for example
`DFXswiss/services` `e2e-stack/specs/buy.spec.ts`). This repository's CI
enforces the catalog, not the foreign suite. A mocked API intercept that
never reaches this process is not E2E of this layer. Reviewers must not
merge a change to an offered function until that E2E exists (any branch of
the named public repo).
