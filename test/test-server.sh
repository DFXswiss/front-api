#!/usr/bin/env bash
# Pin test for server.js (RAM TTL + proxy timeout)
#
# Arms:
#   RAM miss → 503                                   ram_miss
#   RAM stale (older than QUOTE_TTL_MS) → 503        ram_stale
#   RAM fresh → 200                                  ram_fresh
#   swagger snapshot empty → 503 local body          swagger_empty
#   attachRequestTimeout → callback + destroy        proxy_timeout
#   poller default off (QUOTE_BOOK_REFRESH!==1)      poller_off
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
server_js="$repo_root/server.js"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$server_js" ] || fail "missing: $server_js"
grep -q "QUOTE_BOOK_REFRESH === '1'" "$server_js" || fail "poller_off: gate missing"
grep -q 'refreshQuoteBook();' "$server_js" || fail "poller_off: refresh helper missing"
grep -q 'function isServedPath' "$server_js" || fail "isServedPath missing"
grep -q 'if (!isServedPath(p)) continue' "$server_js" || fail "swagger snapshot must allowlist served paths"
if grep -q 'low.includes' "$server_js"; then
  fail "swagger snapshot must not denylist unserved routes"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/run-tests.js" <<'JS'
'use strict';

const http = require('http');
const net = require('net');

const serverJs = process.argv[2];
process.env.BACKEND_URL = 'http://127.0.0.1:9';
delete process.env.SQL_HOST;

const {
  QUOTE_TTL_MS,
  quoteBook,
  pairKey,
  isQuoteFresh,
  attachRequestTimeout,
  server,
} = require(serverJs);

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

if (!(QUOTE_TTL_MS > 0)) fail('QUOTE_TTL_MS unset');
if (!isQuoteFresh({ json: { ok: 1 }, at: Date.now() })) fail('isQuoteFresh: fresh should pass');
if (isQuoteFresh({ json: { ok: 1 }, at: Date.now() - QUOTE_TTL_MS - 1 })) fail('isQuoteFresh: stale should fail');
if (isQuoteFresh(undefined)) fail('isQuoteFresh: miss should fail');

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': payload.length }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const port = server.address().port;
  const ruPath = '/v1/realunit/quote/price';

  quoteBook.realunit.clear();
  let got = await request(port, 'GET', ruPath);
  if (got.status !== 503) fail(`ram_miss: expected 503 got ${got.status}`);
  if (!got.body.includes('quote unavailable')) fail('ram_miss: body');

  quoteBook.realunit.set(ruPath, { json: { price: 1 }, at: Date.now() - QUOTE_TTL_MS - 1000 });
  got = await request(port, 'GET', ruPath);
  if (got.status !== 503) fail(`ram_stale: expected 503 got ${got.status}`);

  quoteBook.realunit.set(ruPath, { json: { price: 42 }, at: Date.now() });
  got = await request(port, 'GET', ruPath);
  if (got.status !== 200) fail(`ram_fresh: expected 200 got ${got.status}`);
  if (!got.body.includes('"price": 42') && !got.body.includes('"price":42')) fail('ram_fresh: body');
  if (got.headers['x-front-api'] !== 'ram') fail('ram_fresh: x-front-api');

  const buyBody = { currency: { id: 1 }, asset: { id: 2 }, amount: 100, paymentMethod: 'Bank' };
  const buyKey = pairKey('buy', buyBody);
  quoteBook.buy.clear();
  got = await request(port, 'PUT', '/v1/buy/quote', buyBody);
  if (got.status !== 503) fail(`ram_miss buy: expected 503 got ${got.status}`);

  quoteBook.buy.set(buyKey, {
    json: { rate: 2, amount: 100, estimatedAmount: 50 },
    at: Date.now() - QUOTE_TTL_MS - 1,
  });
  got = await request(port, 'PUT', '/v1/buy/quote', buyBody);
  if (got.status !== 503) fail(`ram_stale buy: expected 503 got ${got.status}`);

  quoteBook.buy.set(buyKey, {
    json: { rate: 2, amount: 100, estimatedAmount: 50 },
    at: Date.now(),
  });
  got = await request(port, 'PUT', '/v1/buy/quote', buyBody);
  if (got.status !== 200) fail(`ram_fresh buy: expected 200 got ${got.status}`);

  got = await request(port, 'GET', '/swagger-json');
  if (got.status !== 503) fail(`swagger_empty json: expected 503 got ${got.status}`);
  if (!got.body.includes('swagger snapshot empty')) fail('swagger_empty json: body');
  if (got.headers['x-front-api'] !== 'local') fail('swagger_empty json: x-front-api');
  got = await request(port, 'GET', '/swagger');
  if (got.status !== 503) fail(`swagger_empty html: expected 503 got ${got.status}`);
  if (!got.body.includes('swagger snapshot empty')) fail('swagger_empty html: body');

  await new Promise((resolve, reject) => {
    const held = [];
    const hanging = net.createServer((s) => {
      held.push(s);
    });
    hanging.listen(0, '127.0.0.1', () => {
      const hPort = hanging.address().port;
      const req = http.request({ hostname: '127.0.0.1', port: hPort, path: '/', method: 'GET' });
      let timedOut = false;
      attachRequestTimeout(req, 50, () => {
        timedOut = true;
        req.destroy();
      });
      req.on('error', () => {
        for (const s of held) s.destroy();
        hanging.close(() => {
          if (!timedOut) reject(new Error('proxy_timeout: destroy without timeout callback'));
          else resolve();
        });
      });
      req.end();
    });
    hanging.on('error', reject);
  });

  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  console.log('ok front-api server.js');
}

main().catch((err) => {
  console.error('FAIL:', err && err.message ? err.message : err);
  process.exit(1);
});
JS

node "$tmp/run-tests.js" "$server_js" || fail "node helper failed"
echo "ok front-api server.js"
