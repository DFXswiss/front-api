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
(see `.c8rc.json`: `--all --include='**/*.js' --exclude='test/**' --exclude='coverage/**' --exclude='node_modules/**'`,
and 100 on all four metrics). A result below 100% on any metric turns the
`test` job red. `--all` plus that include/exclude pulls every new `*.js` file
outside `test/` into the report at 0% until tests exist: adding a script
without tests fails CI. Production code must not be listed in `--exclude`.

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
   proxied, quote source). Do not name private repositories. Public consumer
   paths belong in `offered-routes.json`.

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

- This process answers a **fixed** set of routes itself. Every other request is
  forwarded to `BACKEND_URL` without this repository listing those routes.
- The swagger snapshot is an **allowlist** of paths this process serves, not a
  denylist.
- Authenticated requests are never answered from the GET cache.
- Quotes are reverse-proxied to `BACKEND_URL`. This process does not keep a quote book.
- A down backend always returns 503. Never serve an expired cache body.
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

Every path this process answers itself also needs **frontend E2E** coverage:
a real UI flow that hits that function, listed in `offered-routes.json`.
Those tests usually live in the consumer repository (for example
`DFXswiss/services` `e2e-stack/specs/buy.spec.ts`). This repository's CI
enforces the catalog, not the foreign suite. A mocked API intercept that
never reaches this process is not E2E of this layer. Reviewers must not
merge a change to an offered function until that E2E exists (any branch of
the named public repo).
