# front-api

Public HTTP layer in front of the DFX backend. Listed routes (`GET`/`HEAD /` 302 to swagger, `/version`, a filtered swagger snapshot, GET/HEAD cache, optional Postgres reads for country/language) are completed locally within 100ms, never forwarded, and never wait on `BACKEND_URL` for that client request. Background cache and swagger refresh may ping the upstream HTTP backend. Unlisted traffic is forwarded to the upstream HTTP backend and is **not** an endpoint of this process.

## Run

After cloning the repository, start the front API and its loopback-only HTTP stub with one command:

```bash
npm start
```

The default path needs no dependency installation: the start helpers use only the Node.js standard library, and `server.js` loads `pg` only when `SQL_HOST` is set. Run `npm ci` when you want to use the test suite.

By default, the front API listens on `http://127.0.0.1:3000` and the stub listens on `http://127.0.0.1:3004`. Set `BACKEND_URL` to use an upstream HTTP backend and skip the local stub:

```bash
BACKEND_URL=http://127.0.0.1:4000 npm start
```

Local start settings:

- `PORT` sets the front API port and defaults to `3000`.
- `BIND` sets the front API bind address and defaults to `127.0.0.1` for `npm start`.
- `LOCAL_BACKEND_PORT` sets the stub port and defaults to `3004`.

Direct production start does not create a stub and remains available with an explicit upstream HTTP backend:

```bash
BACKEND_URL=http://127.0.0.1:4000 node server.js
```

Direct `node server.js` continues to default `BIND` to `0.0.0.0`; the loopback bind default applies only to `npm start`.

Optional: `PORT` (3000), `BIND` (`0.0.0.0`), `CACHE_TTL_MS` (default 300000), `CACHE_MAX`, `REQUEST_TIMEOUT_MS` (capped at 100; default 100), `SQL_HOST` / `SQL_PORT` / `SQL_DB` / `SQL_USERNAME` / `SQL_PASSWORD` / `SQL_SSL`. `FRONT_API_EXIT_AFTER_BOOT=1` is for the coverage collection run only: the process exits shortly after listen.

## Local answers

- `GET`/`HEAD /` — answered locally with 302 `Location: swagger`; HEAD has an empty body
- `GET`/`HEAD /version` — answered locally (JSON, or HTML when `Accept` includes `text/html`); HEAD has an empty body
- `GET`/`HEAD /swagger`, `/swagger/`, `/swagger-ui`, `/swagger-ui/`, `/swagger-json`, `/swagger-json/` — filtered swagger snapshot from the upstream HTTP backend; an empty snapshot returns 503 locally
- GET/HEAD cache (default 5 minutes) for the public prefixes `/v1/asset`, `/v1/fiat`, `/v1/country`, `/v1/language`, `/v1/statistic`, `/v1/coin`, `/v1/setting`, `/v1/bank`, `/v1/app` (no `Authorization`). Nested paths under these prefixes are listed. HEAD follows the same local rules as GET and has an empty body.
- Optional Postgres reads for `GET`/`HEAD /v1/country` and `GET`/`HEAD /v1/language` when `SQL_HOST` is set
- An authenticated listed GET/HEAD never reads the unauthenticated GET cache. Without another local source it returns `503` `not served`; it is never forwarded.

Only fresh cache hits are served for known GETs. The cache is filled in the
background, not during a client request. After the TTL the next known GET
is `503` `not served` until a background refresh succeeds — never an
expired cache body, never a live backend wait on that request.

Everything this process does not list is forwarded to `BACKEND_URL` with
no 100ms rule. Those routes belong to the upstream HTTP backend, not to this process.
This repository does not name them.

Every **known** HTTP response must finish within 100ms. Forwarding a known
route is forbidden because that cannot guarantee 100ms. A slower known
response is a hard bug: the process answers `503` `response deadline
exceeded`, emits an `ERROR` log, and CI fails.

## Images

Push to `develop` publishes `dfxswiss/front-api:beta` and the git SHA. Push to `main` publishes `dfxswiss/front-api:latest` and the git SHA. After a successful push the workflow notifies the configured infrastructure repo (`DISPATCH_TOKEN` + `DISPATCH_REPO`). If those secrets are unset, the image is still published.

This repository does not describe a particular deployment environment.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Reviewers follow [REVIEW.md](REVIEW.md).
Every path this process answers itself is listed in [offered-routes.json](offered-routes.json)
with a public usage pointer and a frontend E2E pointer, or `unidentified: true`
plus a note when none is named.
