# front-api

Public HTTP layer in front of the DFX backend. This process answers a fixed set of routes itself (`/version`, a filtered swagger snapshot, GET cache, optional Postgres reads for country/language). Every other request is forwarded to `BACKEND_URL` without this repository listing those routes.

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

- `GET /version` — answered locally (JSON, or HTML when `Accept` includes `text/html`)
- `GET /swagger`, `/swagger/`, `/swagger-ui`, `/swagger-ui/`, `/swagger-json` — filtered swagger snapshot from the backend; empty snapshot returns 503
- GET/HEAD cache (default 5 minutes) for `/` and the public list prefixes `/v1/asset`, `/v1/fiat`, `/v1/country`, `/v1/language`, `/v1/statistic`, `/v1/coin`, `/v1/setting`, `/v1/bank`, `/v1/app` (no `Authorization`)
- Optional Postgres reads for `GET /v1/country` and `GET /v1/language` when `SQL_HOST` is set

Only fresh cache hits are served. After the TTL the next request fetches again. If that fetch cannot reach the backend, the response is 503 — never an expired cache body. A still-fresh cache hit is served without calling the backend.

Everything else, including quotes, is reverse-proxied to `BACKEND_URL`. WebSocket upgrades are tunnelled the same way.

Every HTTP response must finish within 100ms, including the WebSocket
upgrade handshake. A slower response is a hard bug: the process answers
`503` `response deadline exceeded` (or cuts the upgrade socket), emits an
`ERROR` log, and CI fails. Code that cannot meet that bound is forbidden.

## Images

Push to `develop` publishes `dfxswiss/front-api:beta` and the git SHA. Push to `main` publishes `dfxswiss/front-api:latest` and the git SHA. After a successful push the workflow notifies the configured infrastructure repo (`DISPATCH_TOKEN` + `DISPATCH_REPO`). If those secrets are unset, the image is still published.

This repository does not describe a particular deployment environment.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Reviewers follow [REVIEW.md](REVIEW.md).
Every path this process answers itself is listed in [offered-routes.json](offered-routes.json)
with a public usage pointer and a frontend E2E pointer, or `unidentified: true`
plus a note when none is named.
