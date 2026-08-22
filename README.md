# front-api

Public HTTP layer in front of the DFX backend. This process answers a fixed set of routes itself (`/version`, a filtered swagger snapshot, short-TTL GET cache, optional Postgres reads for country/language, optional in-memory quotes). Every other request is forwarded to `BACKEND_URL` without this repository listing those routes.

## Run

`BACKEND_URL` is required.

```bash
BACKEND_URL=http://127.0.0.1:3000 node server.js
```

Optional: `PORT` (3000), `BIND` (`0.0.0.0`), `CACHE_TTL_MS`, `CACHE_MAX`, `SQL_HOST` / `SQL_PORT` / `SQL_DB` / `SQL_USERNAME` / `SQL_PASSWORD` / `SQL_SSL`, `QUOTE_BOOK_REFRESH` (`1` to enable the quote poller; off by default).

## Images

Push to `develop` publishes `dfxswiss/front-api:beta` and the git SHA. Push to `main` publishes `dfxswiss/front-api:latest` and the git SHA. After a successful push the workflow notifies the configured infrastructure repo (`DISPATCH_TOKEN` + `DISPATCH_REPO`). If those secrets are unset, the image is still published.

This repository does not describe a particular deployment environment.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Reviewers follow [REVIEW.md](REVIEW.md).
