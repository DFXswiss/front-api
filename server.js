'use strict';

const http = require('http');
const net = require('net');
const { URL } = require('url');

function orFallback(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

function backendPortFor(target) {
  return +(orFallback(target.port, target.protocol === 'https:' ? '443' : '80'));
}

if (!process.env.BACKEND_URL) {
  console.error('BACKEND_URL required');
  process.exit(1);
}
const PORT = +(orFallback(process.env.PORT, 3000));
const BIND = orFallback(process.env.BIND, '0.0.0.0');
const BACKEND = process.env.BACKEND_URL;
const TTL_MS = +(orFallback(process.env.CACHE_TTL_MS, 15000));
const QUOTE_TTL_MS = 300000;
const CACHE_MAX = +(orFallback(process.env.CACHE_MAX, 500));
const REQUEST_TIMEOUT_MS = +(orFallback(process.env.REQUEST_TIMEOUT_MS, 20000));
const STARTED = new Date().toISOString();

// Public GET prefixes this layer may answer from cache. Authenticated
// requests are never cached — they always go to the backend.
const CACHE_PREFIXES = [
  '/v1/asset',
  '/v1/fiat',
  '/v1/country',
  '/v1/language',
  '/v1/statistic',
  '/v1/coin',
  '/v1/setting',
  '/v1/bank',
  '/v1/app',
];

const cache = new Map();
const quoteBook = { buy: new Map(), sell: new Map(), swap: new Map(), realunit: new Map(), filledAt: 0 };
let swaggerSpec = null;
let pool = null;

try {
  if (process.env.SQL_HOST) {
    if (!process.env.SQL_PORT || !process.env.SQL_DB || !process.env.SQL_USERNAME || process.env.SQL_PASSWORD === undefined) {
      console.error('SQL_HOST set but SQL_PORT/SQL_DB/SQL_USERNAME/SQL_PASSWORD missing');
      process.exit(1);
    }
    const { Pool } = require('pg');
    const sslOn = String(process.env.SQL_SSL || '') === 'true';
    pool = new Pool({
      host: process.env.SQL_HOST,
      port: +process.env.SQL_PORT,
      user: process.env.SQL_USERNAME,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB,
      ssl: sslOn ? { rejectUnauthorized: false } : false,
      max: 4,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => console.error('pg pool', err.message));
  }
} catch (err) {
  console.error('pg init failed:', err.message);
  process.exit(1);
}

function cacheKey(req) {
  return req.method + ' ' + req.url;
}

function isCacheable(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (req.headers.authorization) return false;
  const path = (req.url || '/').split('?')[0];
  if (path === '/' || path === '/version' || path === '/swagger' || path === '/swagger-json') return true;
  return CACHE_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

function getCached(key) {
  return cache.get(key) || null;
}

function putCache(key, status, headers, body) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { status, headers, body, exp: Date.now() + TTL_MS });
}

function localVersion() {
  return { commit: 'front-api', startedAt: STARTED };
}

function attachRequestTimeout(req, ms, onTimeout) {
  req.setTimeout(ms, onTimeout);
}

function httpJson(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(BACKEND);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: target.hostname,
        port: backendPortFor(target),
        path: urlPath,
        method,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': payload.length }
          : {},
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: resp.statusCode, json: JSON.parse(raw) });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    attachRequestTimeout(req, REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function pairKey(kind, body) {
  const cur = (body && body.currency && (body.currency.id || body.currency.name)) || '';
  const src =
    (body && body.sourceAsset && (body.sourceAsset.id || body.sourceAsset.name)) ||
    (body && body.asset && (body.asset.id || body.asset.uniqueName || body.asset.name)) ||
    '';
  const target = (body && body.targetAsset && (body.targetAsset.id || body.targetAsset.name)) || '';
  const pm = (body && body.paymentMethod) || 'Bank';
  return [kind, cur, src, target, pm].join('|');
}

function rememberQuote(map, kind, rec, variants) {
  for (const body of variants) map.set(pairKey(kind, body), rec);
}

const RAM_GET_PATHS = [
  '/v1/realunit/quote/buyPrice',
  '/v1/realunit/quote/buyShares',
  '/v1/realunit/quote/info',
  '/v1/realunit/quote/price',
  '/v1/realunit/brokerbot/buyPrice',
  '/v1/realunit/brokerbot/buyShares',
  '/v1/realunit/brokerbot/info',
  '/v1/realunit/brokerbot/price',
];

const EXACT_GET_PATHS = [
  '/',
  '/version',
  '/swagger',
  '/swagger/',
  '/swagger-json',
  '/swagger-json/',
  '/swagger-ui',
  '/swagger-ui/',
];

const EXACT_PUT_PATHS = ['/v1/buy/quote', '/v1/sell/quote', '/v1/swap/quote'];

function isServedPath(path) {
  const p = (path || '/').split('?')[0];
  if (EXACT_GET_PATHS.includes(p) || EXACT_PUT_PATHS.includes(p) || RAM_GET_PATHS.includes(p)) return true;
  return CACHE_PREFIXES.some((pref) => p === pref || p.startsWith(pref + '/'));
}

function scaleQuote(stored, body) {
  const out = JSON.parse(JSON.stringify(stored.json));
  const rate = Number(out.rate);
  const wantsScale = body.amount != null || body.targetAmount != null;
  if (wantsScale && !(rate > 0)) return null;
  if (body.amount != null) {
    out.amount = body.amount;
    out.estimatedAmount = body.amount / rate;
    if (out.fees && typeof out.fees.rate === 'number') {
      out.feeAmount = body.amount * (out.fees.rate || 0) + (out.fees.fixed || 0);
    }
  } else if (body.targetAmount != null) {
    out.estimatedAmount = body.targetAmount;
    out.amount = body.targetAmount * rate;
    if (out.fees && typeof out.fees.rate === 'number') {
      out.feeAmount = out.amount * (out.fees.rate || 0) + (out.fees.fixed || 0);
    }
  }
  return out;
}

function isQuoteFresh(stored) {
  return !!(stored && stored.json && typeof stored.at === 'number' && Date.now() - stored.at <= QUOTE_TTL_MS);
}

async function refreshQuoteBook() {
  try {
    const assets = (await httpJson('GET', '/v1/asset')).json;
    const fiats = (await httpJson('GET', '/v1/fiat')).json;
    if (!Array.isArray(assets) || !Array.isArray(fiats)) return;
    const named = ['CHF', 'EUR', 'USD']
      .map((n) => fiats.find((f) => f.name === n))
      .filter((f) => f && f.id);
    if (!named.find((f) => f.name === 'CHF')) {
      console.error('quote book refresh: no CHF, book unchanged');
      return;
    }
    const buy = new Map();
    const sell = new Map();
    const swap = new Map();
    const realunit = new Map();
    const buyable = assets.filter((a) => a.buyable).slice(0, 12);
    const sellable = assets.filter((a) => a.sellable).slice(0, 8);
    for (const fiat of named) {
      const methods = fiat.name === 'CHF' ? ['Bank', 'Instant'] : ['Bank'];
      for (const pm of methods) {
        for (const asset of buyable) {
          const body = { currency: { id: fiat.id }, asset: { id: asset.id }, amount: 100, paymentMethod: pm };
          try {
            const got = await httpJson('PUT', '/v1/buy/quote', body);
            if (got.status === 200 && got.json) {
              const rec = { json: got.json, at: Date.now() };
              rememberQuote(buy, 'buy', rec, [
                body,
                { currency: { name: fiat.name }, asset: { id: asset.id }, paymentMethod: pm },
                { currency: { id: fiat.id }, asset: { name: asset.name }, paymentMethod: pm },
                { currency: { name: fiat.name }, asset: { name: asset.name }, paymentMethod: pm },
                ...(asset.uniqueName
                  ? [
                      { currency: { id: fiat.id }, asset: { uniqueName: asset.uniqueName }, paymentMethod: pm },
                      { currency: { name: fiat.name }, asset: { uniqueName: asset.uniqueName }, paymentMethod: pm },
                    ]
                  : []),
              ]);
            }
          } catch (err) {
            console.error('quote refresh buy', fiat.name, asset.id, pm, err.message);
          }
        }
        for (const asset of sellable) {
          const body = { currency: { id: fiat.id }, asset: { id: asset.id }, amount: 0.01, paymentMethod: pm };
          try {
            const got = await httpJson('PUT', '/v1/sell/quote', body);
            if (got.status === 200 && got.json) {
              const rec = { json: got.json, at: Date.now() };
              rememberQuote(sell, 'sell', rec, [
                body,
                { currency: { name: fiat.name }, asset: { id: asset.id }, paymentMethod: pm },
                { currency: { id: fiat.id }, asset: { name: asset.name }, paymentMethod: pm },
                { currency: { name: fiat.name }, asset: { name: asset.name }, paymentMethod: pm },
                ...(asset.uniqueName
                  ? [
                      { currency: { id: fiat.id }, asset: { uniqueName: asset.uniqueName }, paymentMethod: pm },
                      { currency: { name: fiat.name }, asset: { uniqueName: asset.uniqueName }, paymentMethod: pm },
                    ]
                  : []),
              ]);
            }
          } catch (err) {
            console.error('quote refresh sell', fiat.name, asset.id, pm, err.message);
          }
        }
      }
    }
    const swapSrc = buyable[0];
    const swapDst = buyable.find((a) => a.id !== (swapSrc && swapSrc.id));
    if (swapSrc && swapDst) {
      const body = { sourceAsset: { id: swapSrc.id }, targetAsset: { id: swapDst.id }, amount: 0.01 };
      try {
        const got = await httpJson('PUT', '/v1/swap/quote', body);
        if (got.status === 200 && got.json) {
          const rec = { json: got.json, at: Date.now() };
          rememberQuote(swap, 'swap', rec, [
            body,
            { sourceAsset: { name: swapSrc.name }, targetAsset: { id: swapDst.id }, amount: 0.01 },
            { sourceAsset: { id: swapSrc.id }, targetAsset: { name: swapDst.name }, amount: 0.01 },
            { sourceAsset: { name: swapSrc.name }, targetAsset: { name: swapDst.name }, amount: 0.01 },
          ]);
        }
      } catch (err) {
        console.error('quote refresh swap', err.message);
      }
    }
    for (const p of RAM_GET_PATHS) {
      try {
        const got = await httpJson('GET', p);
        if (got.status === 200 && got.json) realunit.set(p, { json: got.json, at: Date.now() });
      } catch (err) {
        console.error('quote refresh realunit', p, err.message);
      }
    }
    if (buy.size === 0 && sell.size === 0) {
      console.error('quote book refresh: empty book, keeping previous');
      return;
    }
    if (buy.size > 0) quoteBook.buy = buy;
    if (sell.size > 0) quoteBook.sell = sell;
    if (swap.size > 0) quoteBook.swap = swap;
    if (realunit.size > 0) quoteBook.realunit = realunit;
    quoteBook.filledAt = Date.now();
    console.log('quote book buy', quoteBook.buy.size, 'sell', quoteBook.sell.size, 'ru', quoteBook.realunit.size);
  } catch (err) {
    console.error('quote book refresh', err.message);
  }
}

async function refreshSwagger() {
  try {
    const got = await httpJson('GET', '/swagger-json');
    if (!got.json || !got.json.paths) return;
    const paths = {};
    for (const [p, ops] of Object.entries(got.json.paths)) {
      if (!isServedPath(p)) continue;
      paths[p] = ops;
    }
    swaggerSpec = { ...got.json, paths, info: { ...(got.json.info || {}), title: 'DFX API' } };
    console.log('swagger snapshot paths', Object.keys(paths).length);
  } catch (err) {
    console.error('swagger refresh', err.message);
  }
}

function swaggerHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>DFX API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
window.ui = SwaggerUIBundle({ url: '/swagger-json', dom_id: '#swagger-ui' });
</script>
</body></html>
`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body, via) {
  let buf;
  if (Buffer.isBuffer(body)) {
    try {
      buf = Buffer.from(JSON.stringify(JSON.parse(body.toString('utf8')), null, 2) + '\n');
    } catch {
      buf = body;
    }
  } else {
    buf = Buffer.from(JSON.stringify(body, null, 2) + '\n');
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'x-content-type-options': 'nosniff',
    'x-front-api': via,
    'access-control-allow-origin': '*',
  });
  res.end(buf);
}

function highlightJson(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"(?:\\.|[^"\\])*"(?=\s*:)/g, '<span class="k">$&</span>')
    .replace(/: ("(?:\\.|[^"\\])*")/g, ': <span class="s">$1</span>');
}

function sendVersion(req, res, obj, via) {
  if (String(req.headers.accept || '').includes('text/html')) {
    const html = Buffer.from(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title></title>' +
        '<style>' +
        'html,body{margin:0;min-height:100%;background:#1e1e1e;color:#d4d4d4}' +
        'pre{margin:0;padding:16px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}' +
        '.k{color:#9cdcfe}.s{color:#ce9178}' +
        '</style></head><body><pre>' +
        highlightJson(obj) +
        '</pre></body></html>\n',
    );
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': html.length,
      'x-front-api': via,
    });
    res.end(html);
    return;
  }
  sendJson(res, 200, obj, via);
}

function countryDto(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    foreignName: row.foreignName,
    locationAllowed: !!row.ipEnable,
    ibanAllowed: !!row.fatfEnable,
    kycAllowed: !!row.dfxEnable,
    kycOrganizationAllowed: !!row.dfxOrganizationEnable,
    nationalityAllowed: !!row.nationalityStepEnable,
    bankAllowed: !!(row.bankEnable && row.dfxEnable),
    cardAllowed: !!(row.checkoutEnable && row.fatfEnable),
    cryptoAllowed: !!row.cryptoEnable,
  };
}

function languageDto(row) {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    foreignName: row.foreignName,
    enable: !!row.enable,
  };
}

const DB_READ = {
  '/v1/country': {
    sql:
      'SELECT id, symbol, name, "foreignName", "ipEnable", "fatfEnable", "dfxEnable", ' +
      '"dfxOrganizationEnable", "nationalityStepEnable", "bankEnable", "checkoutEnable", "cryptoEnable" ' +
      'FROM country ORDER BY id',
    map: (rows) => rows.map(countryDto),
  },
  '/v1/language': {
    sql: 'SELECT id, name, symbol, "foreignName", enable FROM language ORDER BY id',
    map: (rows) => rows.map(languageDto),
  },
};

async function tryDbRead(path) {
  if (!pool) return null;
  const spec = DB_READ[path];
  if (!spec) return null;
  const result = await pool.query(spec.sql);
  if (!result || !result.rows) return null;
  return Buffer.from(JSON.stringify(spec.map(result.rows)));
}

function proxy(req, res, stale) {
  const target = new URL(BACKEND);
  const opts = {
    hostname: target.hostname,
    port: backendPortFor(target),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };
  const p = http.request(opts, (up) => {
    const chunks = [];
    up.on('data', (c) => chunks.push(c));
    up.on('end', () => {
      const body = Buffer.concat(chunks);
      const headers = { ...up.headers };
      delete headers['transfer-encoding'];
      if (isCacheable(req) && up.statusCode === 200) {
        putCache(cacheKey(req), up.statusCode, headers, body);
        headers['x-front-api'] = 'miss';
      }
      res.writeHead(up.statusCode, headers);
      res.end(body);
    });
  });
  p.on('error', (err) => {
    console.error('proxy error', err.message);
    if (stale && !res.headersSent) {
      const headers = { ...stale.headers, 'x-front-api': 'stale' };
      res.writeHead(stale.status, headers);
      res.end(stale.body);
      return;
    }
    if (!res.headersSent) {
      res.writeHead(503, {
        'content-type': 'application/json',
        'retry-after': '30',
        'access-control-allow-origin': '*',
      });
    }
    res.end(JSON.stringify({ statusCode: 503, message: 'backend-api unavailable', retryAfter: 30 }));
  });
  attachRequestTimeout(p, REQUEST_TIMEOUT_MS, () => {
    p.destroy();
  });
  req.pipe(p);
}

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/version' && req.method === 'GET') {
    sendVersion(req, res, localVersion(), 'local');
    return;
  }

  if ((path === '/swagger' || path === '/swagger/' || path === '/swagger-ui' || path === '/swagger-ui/') && req.method === 'GET') {
    if (!swaggerSpec) {
      sendJson(res, 503, { statusCode: 503, message: 'swagger snapshot empty' }, 'local');
      return;
    }
    const html = Buffer.from(swaggerHtml());
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length, 'x-front-api': 'local' });
    res.end(html);
    return;
  }

  if ((path === '/swagger-json' || path === '/swagger-json/') && req.method === 'GET') {
    if (!swaggerSpec) {
      sendJson(res, 503, { statusCode: 503, message: 'swagger snapshot empty' }, 'local');
      return;
    }
    sendJson(res, 200, swaggerSpec, 'local');
    return;
  }

  const quoteKind =
    path === '/v1/buy/quote' ? 'buy' : path === '/v1/sell/quote' ? 'sell' : path === '/v1/swap/quote' ? 'swap' : null;
  if (quoteKind && req.method === 'PUT') {
    readBody(req)
      .then((body) => {
        const stored = quoteBook[quoteKind].get(pairKey(quoteKind, body));
        if (!isQuoteFresh(stored)) {
          sendJson(res, 503, { statusCode: 503, message: 'quote unavailable', retryAfter: 30 }, 'local');
          return;
        }
        const scaled = scaleQuote(stored, body);
        if (!scaled) {
          sendJson(res, 503, { statusCode: 503, message: 'quote unavailable', retryAfter: 30 }, 'local');
          return;
        }
        sendJson(res, 200, scaled, 'ram');
      })
      .catch(() => sendJson(res, 400, { statusCode: 400, message: 'invalid json' }, 'local'));
    return;
  }

  if (req.method === 'GET' && RAM_GET_PATHS.includes(path)) {
    const hitRu = quoteBook.realunit.get(path);
    if (!isQuoteFresh(hitRu)) {
      sendJson(res, 503, { statusCode: 503, message: 'quote unavailable', retryAfter: 30 }, 'local');
      return;
    }
    sendJson(res, 200, hitRu.json, 'ram');
    return;
  }

  const key = cacheKey(req);
  const hit = isCacheable(req) ? getCached(key) : null;
  const fresh = hit && Date.now() <= hit.exp ? hit : null;
  if (fresh) {
    const headers = { ...fresh.headers, 'x-front-api': 'hit' };
    res.writeHead(fresh.status, headers);
    res.end(fresh.body);
    return;
  }

  const stale = hit && Date.now() > hit.exp ? hit : null;

  if (pool && req.method === 'GET' && !req.headers.authorization && DB_READ[path]) {
    tryDbRead(path)
      .then((body) => {
        if (!body) {
          proxy(req, res, stale);
          return;
        }
        putCache(key, 200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body);
        sendJson(res, 200, body, 'db');
      })
      .catch((err) => {
        console.error('db-read', path, err.message);
        if (stale) {
          const headers = { ...stale.headers, 'x-front-api': 'stale' };
          res.writeHead(stale.status, headers);
          res.end(stale.body);
          return;
        }
        proxy(req, res, stale);
      });
    return;
  }

  proxy(req, res, stale);
});

server.on('upgrade', (req, socket, head) => {
  const target = new URL(BACKEND);
  const port = backendPortFor(target);
  const up = net.connect(port, target.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    const headers = { ...req.headers, host: target.host };
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) lines.push(`${k}: ${item}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

function boot() {
  server.listen(PORT, BIND, () => {
    console.log(`front-api listening on ${BIND}:${PORT}` + (pool ? ' db-read on' : ''));
    refreshSwagger();
    setInterval(refreshSwagger, 10 * 60 * 1000).unref();
    if (process.env.QUOTE_BOOK_REFRESH === '1') {
      refreshQuoteBook();
      setInterval(refreshQuoteBook, 60 * 1000).unref();
    } else {
      console.log('quote book refresh disabled (QUOTE_BOOK_REFRESH=1 to enable)');
    }
  });
}

function maybeExitAfterBoot() {
  if (process.env.FRONT_API_EXIT_AFTER_BOOT !== '1') return false;
  server.once('listening', () => {
    setTimeout(() => process.exit(0), 200);
  });
  server.once('error', () => process.exit(1));
  return true;
}

if (require.main === module) {
  maybeExitAfterBoot();
  boot();
}

function setSwaggerSpec(value) {
  swaggerSpec = value;
}

function getSwaggerSpec() {
  return swaggerSpec;
}

function setPool(value) {
  pool = value;
}

function getPool() {
  return pool;
}

module.exports = {
  orFallback,
  backendPortFor,
  QUOTE_TTL_MS,
  CACHE_MAX,
  CACHE_PREFIXES,
  RAM_GET_PATHS,
  EXACT_GET_PATHS,
  EXACT_PUT_PATHS,
  quoteBook,
  cache,
  pairKey,
  isQuoteFresh,
  isServedPath,
  isCacheable,
  cacheKey,
  scaleQuote,
  rememberQuote,
  refreshQuoteBook,
  refreshSwagger,
  swaggerHtml,
  countryDto,
  languageDto,
  tryDbRead,
  putCache,
  getCached,
  highlightJson,
  localVersion,
  sendJson,
  sendVersion,
  readBody,
  proxy,
  attachRequestTimeout,
  setSwaggerSpec,
  getSwaggerSpec,
  setPool,
  getPool,
  boot,
  maybeExitAfterBoot,
  REQUEST_TIMEOUT_MS,
  server,
};
