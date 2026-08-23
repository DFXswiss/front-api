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
const TTL_MS = +(orFallback(process.env.CACHE_TTL_MS, 300000));
const CACHE_MAX = +(orFallback(process.env.CACHE_MAX, 500));
const MAX_RESPONSE_MS = 100;
function outboundTimeoutMs(raw) {
  const n = +raw;
  if (!Number.isFinite(n) || n <= 0) return MAX_RESPONSE_MS;
  return Math.min(MAX_RESPONSE_MS, n);
}
const REQUEST_TIMEOUT_MS = outboundTimeoutMs(orFallback(process.env.REQUEST_TIMEOUT_MS, MAX_RESPONSE_MS));
const STARTED = new Date().toISOString();

// Public GET list roots this layer may answer from cache. Authenticated
// requests are never cached.
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
      connectionTimeoutMillis: 90,
    });
    pool.on('error', (err) => console.error('pg pool', err.message));
    attachPoolGuards(pool);
  }
} catch (err) {
  console.error('pg init failed:', err.message);
  process.exit(1);
}

function cacheKey(req) {
  return req.method + ' ' + (req.url ?? '/').split('?')[0];
}

function isCacheable(req) {
  if (req.method !== 'GET') return false;
  if (req.headers.authorization) return false;
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/' || path === '/version' || path === '/swagger' || path === '/swagger-json') return true;
  return CACHE_PREFIXES.includes(path);
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

function canWrite(res) {
  return !res.headersSent && !res.writableEnded && !res.destroyed;
}

function logDeadlineError(req) {
  console.error('ERROR response exceeded ' + MAX_RESPONSE_MS + 'ms', req.method, req.url);
}

function attachResponseBudget(req, res, budgetMs) {
  const asked = budgetMs === undefined ? MAX_RESPONSE_MS : budgetMs;
  const limit = Math.min(MAX_RESPONSE_MS, asked);
  const fireAt = Math.max(1, limit - 10);
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
  };
  const timer = setTimeout(() => {
    if (settled) return;
    logDeadlineError(req);
    if (!res.headersSent) {
      sendJson(res, 503, { statusCode: 503, message: 'response deadline exceeded', retryAfter: 1 }, 'local', {
        connection: 'close',
        'retry-after': '1',
      });
      return;
    }
    if (!res.destroyed) req.destroy();
  }, fireAt);
  const hard = setTimeout(() => {
    if (settled) return;
    logDeadlineError(req);
    if (!res.destroyed) req.destroy();
    finish();
  }, limit);
  timer.unref();
  hard.unref();
  res.on('finish', finish);
  res.on('close', finish);
  return true;
}

function onPoolConnect(client) {
  return client.query('SET statement_timeout TO 90');
}

function attachPoolGuards(p) {
  p.on('connect', (client) => {
    Promise.resolve(onPoolConnect(client)).catch((err) => {
      console.error('pg statement_timeout', err.message);
      if (typeof client.release === 'function') client.release(true);
      else if (typeof client.end === 'function') client.end();
    });
  });
  return p;
}

function getBackendJson(urlPath) {
  return new Promise((resolve, reject) => {
    const target = new URL(BACKEND);
    const req = http.request(
      {
        hostname: target.hostname,
        port: backendPortFor(target),
        path: urlPath,
        method: 'GET',
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
    req.end();
  });
}

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

function isServedPath(path) {
  const p = (path ?? '/').split('?')[0];
  if (EXACT_GET_PATHS.includes(p)) return true;
  return CACHE_PREFIXES.includes(p);
}

function isKnownLocalRequest(req) {
  if (req.method !== 'GET') return false;
  const path = (req.url ?? '/').split('?')[0];
  if (
    path === '/version' ||
    path === '/swagger' ||
    path === '/swagger/' ||
    path === '/swagger-ui' ||
    path === '/swagger-ui/' ||
    path === '/swagger-json' ||
    path === '/swagger-json/'
  ) {
    return true;
  }
  return isCacheable(req);
}

async function refreshSwagger() {
  try {
    const got = await getBackendJson('/swagger-json');
    if (!got.json || !got.json.paths) return;
    const paths = {};
    for (const [p, ops] of Object.entries(got.json.paths)) {
      if (!isServedPath(p)) continue;
      paths[p] = ops;
    }
    swaggerSpec = { ...got.json, paths, info: { ...(got.json.info || {}), title: 'DFX API' } };
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

function sendJson(res, status, body, via, extraHeaders) {
  if (!canWrite(res)) return;
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
  res.writeHead(status, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'x-content-type-options': 'nosniff',
    'x-front-api': via,
    'access-control-allow-origin': '*',
  }, extraHeaders ?? {}));
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
  if (!canWrite(res)) return;
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

function rejectUnserved(res) {
  sendJson(res, 503, { statusCode: 503, message: 'not served', retryAfter: 1 }, 'local', {
    connection: 'close',
    'retry-after': '1',
  });
}

function proxy(req, res) {
  if (!canWrite(res)) return;
  const target = new URL(BACKEND);
  const opts = {
    hostname: target.hostname,
    port: backendPortFor(target),
    path: req.url ?? '/',
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };
  const p = http.request(opts, (up) => {
    const chunks = [];
    up.on('data', (c) => chunks.push(c));
    up.on('end', () => {
      if (!canWrite(res)) return;
      const body = Buffer.concat(chunks);
      const headers = { ...up.headers };
      delete headers['transfer-encoding'];
      res.writeHead(up.statusCode, headers);
      res.end(body);
    });
  });
  p.on('error', (err) => {
    console.error('proxy error', err.message);
    if (!canWrite(res)) return;
    res.writeHead(503, {
      'content-type': 'application/json',
      'retry-after': '30',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ statusCode: 503, message: 'backend-api unavailable', retryAfter: 30 }));
  });
  res.on('finish', () => p.destroy());
  res.on('close', () => p.destroy());
  req.on('aborted', () => p.destroy());
  req.pipe(p);
}

function cacheRefreshPaths() {
  return ['/', ...CACHE_PREFIXES];
}

async function refreshCache() {
  for (const p of cacheRefreshPaths()) {
    try {
      const got = await getBackendJson(p);
      if (got.status !== 200) continue;
      putCache('GET ' + p, 200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, Buffer.from(JSON.stringify(got.json)));
    } catch (err) {
      console.error('cache refresh', p, err.message);
    }
  }
}

const server = http.createServer((req, res) => {
  if (!isKnownLocalRequest(req)) {
    proxy(req, res);
    return;
  }
  attachResponseBudget(req, res);
  const path = (req.url ?? '/').split('?')[0];
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
    if (!canWrite(res)) return;
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

  const key = cacheKey(req);
  const hit = getCached(key);
  if (hit && Date.now() <= hit.exp) {
    if (!canWrite(res)) return;
    const headers = { ...hit.headers, 'x-front-api': 'hit' };
    res.writeHead(hit.status, headers);
    res.end(hit.body);
    return;
  }

  if (pool && req.method === 'GET' && !req.headers.authorization && DB_READ[path]) {
    tryDbRead(path)
      .then((body) => {
        if (!body) {
          rejectUnserved(res);
          return;
        }
        putCache(key, 200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body);
        sendJson(res, 200, body, 'db');
      })
      .catch((err) => {
        console.error('db-read', path, err.message);
        rejectUnserved(res);
      });
    return;
  }

  rejectUnserved(res);
});

server.on('upgrade', (req, socket, head) => {
  const target = new URL(BACKEND);
  const port = backendPortFor(target);
  const up = net.connect(port, target.hostname, () => {
    if (socket.destroyed) {
      up.destroy();
      return;
    }
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
  socket.once('close', () => up.destroy());
  up.once('close', () => socket.destroy());
});

function boot() {
  server.listen(PORT, BIND, () => {
    console.log(`front-api listening on ${BIND}:${PORT}` + (pool ? ' db-read on' : ''));
    refreshSwagger().then(() => refreshCache());
    setInterval(refreshSwagger, 10 * 60 * 1000).unref();
    setInterval(refreshCache, 60 * 1000).unref();
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
  CACHE_MAX,
  CACHE_PREFIXES,
  EXACT_GET_PATHS,
  cache,
  isServedPath,
  isKnownLocalRequest,
  isCacheable,
  cacheKey,
  refreshSwagger,
  refreshCache,
  cacheRefreshPaths,
  rejectUnserved,
  proxy,
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
  attachRequestTimeout,
  attachResponseBudget,
  attachPoolGuards,
  onPoolConnect,
  canWrite,
  logDeadlineError,
  MAX_RESPONSE_MS,
  outboundTimeoutMs,
  setSwaggerSpec,
  getSwaggerSpec,
  setPool,
  getPool,
  boot,
  maybeExitAfterBoot,
  REQUEST_TIMEOUT_MS,
  server,
};
