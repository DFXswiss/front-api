# front-api

Public HTTP layer in front of the DFX backend. This process answers a fixed set of routes itself (`/version`, a filtered swagger snapshot, short-TTL GET cache, optional Postgres reads for country/language). Every other request is forwarded to `BACKEND_URL` without this repository listing those routes.

## Run

`BACKEND_URL` is required.

```bash
BACKEND_URL=http://127.0.0.1:3000 node server.js
```

Optional: `PORT` (3000), `BIND` (`0.0.0.0`), `CACHE_TTL_MS` (default 15000), `CACHE_MAX`, `REQUEST_TIMEOUT_MS` (20000), `SQL_HOST` / `SQL_PORT` / `SQL_DB` / `SQL_USERNAME` / `SQL_PASSWORD` / `SQL_SSL`. `FRONT_API_EXIT_AFTER_BOOT=1` is for the coverage collection run only: the process exits shortly after listen.

## Local answers

- `GET /version` — answered locally (JSON, or HTML when `Accept` includes `text/html`)
- `GET /swagger`, `/swagger/`, `/swagger-ui`, `/swagger-ui/`, `/swagger-json` — filtered swagger snapshot from the backend; empty snapshot returns 503
- Short-TTL GET/HEAD cache (default 15s) for public list prefixes: `/v1/asset`, `/v1/fiat`, `/v1/country`, `/v1/language`, `/v1/statistic`, `/v1/coin`, `/v1/setting`, `/v1/bank`, `/v1/app` (no `Authorization`)
- Optional Postgres reads for `GET /v1/country` and `GET /v1/language` when `SQL_HOST` is set

Only fresh cache hits are served. After the TTL a new fetch is made. If the backend is down, the response is always 503 — never an old cached body.

Everything else, including quotes, is reverse-proxied to `BACKEND_URL`. WebSocket upgrades are tunnelled the same way.

## Images

Push to `develop` publishes `dfxswiss/front-api:beta` and the git SHA. Push to `main` publishes `dfxswiss/front-api:latest` and the git SHA. After a successful push the workflow notifies the configured infrastructure repo (`DISPATCH_TOKEN` + `DISPATCH_REPO`). If those secrets are unset, the image is still published.

This repository does not describe a particular deployment environment.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Reviewers follow [REVIEW.md](REVIEW.md).
Every path this process answers itself is listed in [offered-routes.json](offered-routes.json)
with a public usage pointer and a frontend E2E pointer, or `unidentified: true`
plus a note when none is named.
