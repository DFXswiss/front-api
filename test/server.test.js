'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const { Readable } = require('stream');
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const serverJs = path.join(repoRoot, 'server.js');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function childEnv(extra) {
  return Object.assign({}, process.env, extra || {});
}

function listen(srv, host) {
  return new Promise((resolve, reject) => {
    srv.listen(0, host || '127.0.0.1', () => resolve(srv.address().port));
    srv.on('error', reject);
  });
}

function close(srv) {
  return new Promise((resolve, reject) => {
    if (!srv.listening) {
      resolve();
      return;
    }
    srv.close((err) => (err ? reject(err) : resolve()));
  });
}

function request(port, method, urlPath, body, headers, maxMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const limit = maxMs === undefined ? 100 : maxMs;
    const payload =
      body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: Object.assign(
          payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
          headers || {},
        ),
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const ms = Date.now() - t0;
          if (limit > 0 && ms > limit) {
            reject(new Error('slow ' + method + ' ' + urlPath + ' ' + ms + 'ms'));
            return;
          }
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
            ms,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function mockReqRes() {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = '/x';
  req.destroy = () => {
    req.destroyed = true;
  };
  const res = new EventEmitter();
  res.headersSent = false;
  res.writeHead = function writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
  };
  res.end = function end(body) {
    this.body = body;
    this.emit('finish');
  };
  return { req, res };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeRes() {
  return {
    headersSent: false,
    status: 0,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      this.body = body;
    },
    on() {},
    emit() {},
  };
}

function jsonHandler(routes, seen) {
  return (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const p = (req.url || '/').split('?')[0];
      if (seen) {
        seen.push({
          method: req.method,
          path: p,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: req.headers['content-type'] ?? '',
        });
      }
      const hit = routes[p];
      if (typeof hit === 'function') {
        hit(req, res);
        return;
      }
      if (hit === undefined) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      const body = Buffer.from(typeof hit === 'string' ? hit : JSON.stringify(hit));
      res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' });
      res.end(body);
    });
  };
}

async function main() {
  const assets = [
    { id: 1, name: 'BTC', uniqueName: 'BTC', buyable: true, sellable: true },
    { id: 2, name: 'ETH', buyable: true, sellable: false },
  ];
  const fiats = [
    { id: 10, name: 'CHF' },
    { id: 11, name: 'EUR' },
    { id: 12, name: 'USD' },
  ];
  const swagger = {
    paths: {
      '/v1/asset': { get: {} },
      '/v1/asset/x': { get: {} },
      '/v1/asset/{id}': { get: {} },
      '/v1/setting/infoBanner': { get: {} },
      '/v1/other': { get: {} },
      '/version': { get: {} },
      '/v1/bank': { post: {} },
    },
  };

  const seen = [];
  const backend = http.createServer(
    jsonHandler({
      '/v1/asset': assets,
      '/v1/fiat': fiats,
      '/': { root: 1 },
      '/swagger-json': swagger,
      '/v1/statistic': { ok: 1 },
      '/v1/setting': { ok: 1 },
      '/v1/setting/infoBanner': { banner: 1 },
      '/v1/bank': { ok: 1 },
      '/v1/app': (req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"ok":false}');
      },
      '/v1/coin': { ok: 1 },
      '/v1/other': { other: 1 },
    }, seen),
  );
  const bPort = await listen(backend);
  process.env.BACKEND_URL = 'http://127.0.0.1:' + bPort;
  process.env.PORT = '0';
  process.env.REQUEST_TIMEOUT_MS = '50';
  process.env.CACHE_TTL_MS = '2000';
  delete process.env.BIND;
  delete process.env.CACHE_MAX;
  delete process.env.SQL_HOST;
  delete process.env.QUOTE_BOOK_REFRESH;

  const s = require(serverJs);
  const {
    CACHE_MAX,
    CACHE_PREFIXES,
    cache,
    isServedPath,
    isKnownLocalRequest,
    isCacheable,
    cacheKey,
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
    attachRequestTimeout,
    attachResponseBudget,
    attachPoolGuards,
    refreshCache,
    cacheRefreshPaths,
    rejectUnserved,
    proxy,
    onPoolConnect,
    canWrite,
    MAX_RESPONSE_MS,
    outboundTimeoutMs,
    setSwaggerSpec,
    getSwaggerSpec,
    setPool,
    getPool,
    boot,
    maybeExitAfterBoot,
    orFallback,
    backendPortFor,
    REQUEST_TIMEOUT_MS,
    server,
  } = s;

  if (maybeExitAfterBoot() !== false) fail('maybeExitAfterBoot off');
  if (MAX_RESPONSE_MS !== 100) fail('MAX_RESPONSE_MS');
  const endedRes = fakeRes();
  endedRes.writableEnded = true;
  if (canWrite(endedRes)) fail('canWrite ended');
  const deadRes = fakeRes();
  deadRes.destroyed = true;
  if (canWrite(deadRes)) fail('canWrite destroyed');
  if (REQUEST_TIMEOUT_MS !== 50) fail('REQUEST_TIMEOUT_MS env');
  if (REQUEST_TIMEOUT_MS > MAX_RESPONSE_MS) fail('REQUEST_TIMEOUT_MS cap');
  if (outboundTimeoutMs(0) !== 100 || outboundTimeoutMs(-1) !== 100 || outboundTimeoutMs('nope') !== 100) {
    fail('outboundTimeoutMs invalid');
  }
  if (outboundTimeoutMs(50) !== 50 || outboundTimeoutMs(20000) !== 100) fail('outboundTimeoutMs cap');

  if (orFallback('', 'x') !== 'x' || orFallback('a', 'x') !== 'a') fail('orFallback');
  if (orFallback(undefined, 'x') !== 'x' || orFallback(null, 'x') !== 'x') fail('orFallback nullish');
  const { URL } = require('url');
  if (backendPortFor(new URL('http://127.0.0.1:9')) !== 9) fail('backendPort set');
  if (backendPortFor(new URL('http://127.0.0.1')) !== 80) fail('backendPort 80');
  if (backendPortFor(new URL('https://example.com')) !== 443) fail('backendPort 443');
  if (!(CACHE_MAX > 0)) fail('constants');
  if (!CACHE_PREFIXES.includes('/v1/asset')) fail('CACHE_PREFIXES');
  if (getPool() !== null) fail('pool default');

  if (!isServedPath('/version') || !isServedPath('/swagger/') || !isServedPath('/swagger-json/')) fail('isServedPath meta');
  if (!isServedPath('/swagger-ui') || !isServedPath('/swagger-ui/')) fail('isServedPath ui');
  if (isServedPath('/v1/other')) fail('isServedPath outside allowlist');
  if (!isServedPath('/v1/asset') || !isServedPath(undefined)) fail('isServedPath');
  if (!isServedPath('/v1/asset/1')) fail('isServedPath nested asset');
  if (!isServedPath('/v1/setting/infoBanner')) fail('isServedPath nested setting');
  if (!isServedPath('/v1/asset/{id}')) fail('isServedPath template');
  if (isServedPath('/v1/assetfoo')) fail('isServedPath prefix boundary');
  if (isServedPath('/v1/other')) fail('isServedPath outside listed prefixes');
  if (!isKnownLocalRequest({ method: 'GET', url: '/v1/asset', headers: {} })) fail('known GET asset');
  if (!isKnownLocalRequest({ method: 'GET', url: '/version', headers: {} })) fail('known version');
  if (isKnownLocalRequest({ method: 'PUT', url: '/v1/other', headers: {} })) fail('unknown method');
  if (isKnownLocalRequest({ method: 'GET', url: '/v1/other', headers: {} })) fail('unknown path');
  if (!isKnownLocalRequest({ method: 'GET', url: '/v1/asset', headers: { authorization: 'x' } })) fail('known auth GET');
  if (!isKnownLocalRequest({ method: 'HEAD', url: '/v1/asset', headers: {} })) fail('known HEAD');
  if (!isKnownLocalRequest({ method: 'GET', url: '/v1/asset/1', headers: {} })) fail('known asset id');
  if (!isKnownLocalRequest({ method: 'GET', url: '/v1/setting/infoBanner', headers: {} })) fail('known infoBanner');
  if (!isKnownLocalRequest({ method: 'GET', url: '/swagger-json', headers: { authorization: 'x' } })) fail('known swagger ignores auth');

  if (!isCacheable({ method: 'GET', url: '/v1/asset', headers: {} })) fail('cache GET');
  if (!isCacheable({ method: 'GET', url: '/v1/asset/1', headers: {} })) fail('cache nested id');
  if (!isCacheable({ method: 'HEAD', url: '/', headers: {} })) fail('cache HEAD root');
  if (!isCacheable({ method: 'HEAD', url: '/v1/asset', headers: {} })) fail('cache HEAD asset');
  if (!isCacheable({ method: 'GET', url: '/version', headers: {} })) fail('cache version');
  if (!isCacheable({ method: 'GET', url: '/swagger', headers: {} })) fail('cache swagger');
  if (!isCacheable({ method: 'GET', url: '/swagger-json', headers: {} })) fail('cache swagger-json');
  if (isCacheable({ method: 'PUT', url: '/v1/asset', headers: {} })) fail('cache PUT');
  if (isCacheable({ method: 'GET', url: '/v1/asset', headers: { authorization: 'x' } })) fail('cache auth');
  if (isCacheable({ method: 'GET', url: '/v1/other', headers: {} })) fail('cache outside allowlist');
  if (cacheKey({ method: 'GET', url: '/a' }) !== 'GET /a') fail('cacheKey');
  if (cacheKey({ method: 'HEAD', url: '/v1/asset' }) !== 'GET /v1/asset') fail('cacheKey HEAD shares GET');
  if (cacheKey({ method: 'GET', url: '/v1/asset?x=1' }) !== 'GET /v1/asset') fail('cacheKey query');
  if (cacheKey({ method: 'GET', url: undefined }) !== 'GET /') fail('cacheKey empty');

  if (swaggerHtml().indexOf('swagger-ui') < 0) fail('swaggerHtml');
  if (localVersion().commit !== 'front-api') fail('localVersion');
  const hi = highlightJson({ a: 'b&<>', k: 'v' });
  if (hi.indexOf('&amp;') < 0 || hi.indexOf('&lt;') < 0 || hi.indexOf('class="k"') < 0) fail('highlightJson');

  const dto = countryDto({
    id: 1,
    symbol: 'CH',
    name: 'Switzerland',
    foreignName: 'Schweiz',
    ipEnable: 1,
    fatfEnable: 1,
    dfxEnable: 1,
    dfxOrganizationEnable: 0,
    nationalityStepEnable: 1,
    bankEnable: 1,
    checkoutEnable: 0,
    cryptoEnable: 1,
  });
  if (!dto.bankAllowed || dto.cardAllowed) fail('countryDto');
  const dtoCard = countryDto({
    id: 2,
    symbol: 'DE',
    name: 'Germany',
    foreignName: 'x',
    ipEnable: 0,
    fatfEnable: 1,
    dfxEnable: 0,
    dfxOrganizationEnable: 1,
    nationalityStepEnable: 0,
    bankEnable: 1,
    checkoutEnable: 1,
    cryptoEnable: 0,
  });
  if (!dtoCard.cardAllowed || dtoCard.bankAllowed) fail('countryDto card');
  if (!languageDto({ id: 1, name: 'English', symbol: 'EN', foreignName: 'x', enable: 1 }).enable) fail('languageDto');

  cache.clear();
  putCache('a', 200, { h: '1' }, Buffer.from('one'));
  if (!getCached('a')) fail('getCached');
  for (let i = 0; i < CACHE_MAX + 2; i++) putCache('k' + i, 200, {}, Buffer.from(String(i)));
  if (cache.size > CACHE_MAX) fail('eviction');

  const resJson = fakeRes();
  sendJson(resJson, 200, { ok: 1 }, 'local');
  if (resJson.status !== 200) fail('sendJson object');
  const resBuf = fakeRes();
  sendJson(resBuf, 200, Buffer.from('{"x":1}'), 'db');
  if (String(resBuf.body).indexOf('"x"') < 0) fail('sendJson buffer');
  const resRaw = fakeRes();
  sendJson(resRaw, 200, Buffer.from('not-json'), 'db');
  if (String(resRaw.body) !== 'not-json') fail('sendJson raw');

  const resVer = fakeRes();
  sendVersion({ headers: {} }, resVer, { commit: 'x' }, 'local');
  if (resVer.status !== 200) fail('sendVersion json');
  const resHtml = fakeRes();
  sendVersion({ headers: { accept: 'text/html' } }, resHtml, { commit: 'x' }, 'local');
  if (String(resHtml.headers['content-type']).indexOf('text/html') < 0) fail('sendVersion html');

  if ((await tryDbRead('/v1/country')) !== null) fail('tryDbRead no pool');
  setPool({ query: async () => ({ rows: [{ id: 1, name: 'X', symbol: 'X', foreignName: 'X', enable: 1 }] }) });
  if (!(await tryDbRead('/v1/language'))) fail('tryDbRead language');
  if ((await tryDbRead('/nope')) !== null) fail('tryDbRead unknown');
  setPool({ query: async () => null });
  if ((await tryDbRead('/v1/country')) !== null) fail('tryDbRead null result');
  setPool(null);

  setSwaggerSpec(null);
  const rootOnlyRefreshPaths = cacheRefreshPaths();
  if (rootOnlyRefreshPaths.includes('/v1/setting/infoBanner')) fail('cacheRefreshPaths null snapshot must use roots only');
  await refreshSwagger();
  if (!isCacheable({ method: 'GET', url: '/v1/setting/infoBanner', headers: {} })) fail('nested swagger GET is cacheable');
  if (!isKnownLocalRequest({ method: 'GET', url: '/v1/setting/infoBanner', headers: {} })) fail('infoBanner is listed');
  if (!getSwaggerSpec() || !getSwaggerSpec().paths['/v1/asset'] || getSwaggerSpec().paths['/v1/other']) {
    fail('refreshSwagger allowlist');
  }
  if (!getSwaggerSpec().paths['/v1/setting/infoBanner'] || !getSwaggerSpec().paths['/v1/asset/{id}']) {
    fail('refreshSwagger must keep listed nested paths and templates');
  }
  const refreshPaths = cacheRefreshPaths();
  if (!refreshPaths.includes('/') || !refreshPaths.includes('/v1/asset')) fail('cacheRefreshPaths roots');
  if (!refreshPaths.includes('/v1/setting/infoBanner')) fail('cacheRefreshPaths nested');
  if (!refreshPaths.includes('/version')) fail('cacheRefreshPaths listed swagger path');

  const port = await listen(server);
  try {
    const blocked = fakeRes();
    blocked.headersSent = true;
    sendVersion({ headers: { accept: 'text/html' } }, blocked, localVersion(), 'local');
    const mkReq = (urlPath) => {
      const r = new http.IncomingMessage(new net.Socket());
      r.method = 'GET';
      r.url = urlPath;
      r.headers = {};
      return r;
    };
    server.emit('request', mkReq('/swagger'), blocked);
    putCache('GET /v1/asset', 200, { 'content-type': 'application/json' }, Buffer.from('[]'));
    server.emit('request', mkReq('/v1/asset'), blocked);
    rejectUnserved(blocked);
    const raceRes = fakeRes();
    rejectUnserved(raceRes);
    proxy(
      new Readable({
        read() {
          this.push(null);
        },
      }),
      raceRes,
    );
    const livePipe = new Readable({
      read() {
        this.push(null);
      },
    });
    livePipe.method = 'GET';
    livePipe.url = '/v1/other';
    livePipe.headers = { host: '127.0.0.1' };
    const liveRes = fakeRes();
    proxy(livePipe, liveRes);
    const noUrlProxy = new Readable({
      read() {
        this.push(null);
      },
    });
    noUrlProxy.method = 'GET';
    noUrlProxy.url = undefined;
    noUrlProxy.headers = { host: '127.0.0.1' };
    const noUrlProxyRes = fakeRes();
    proxy(noUrlProxy, noUrlProxyRes);
    const raced = fakeRes();
    const racedReq = new Readable({
      read() {
        this.push(null);
      },
    });
    racedReq.method = 'GET';
    racedReq.url = '/v1/other';
    racedReq.headers = { host: '127.0.0.1' };
    proxy(racedReq, raced);
    raced.headersSent = true;
    raced.writableEnded = true;
    const closeRes = new EventEmitter();
    closeRes.headersSent = false;
    closeRes.writableEnded = false;
    closeRes.destroyed = false;
    closeRes.writeHead = function writeHead() {
      this.headersSent = true;
    };
    closeRes.end = function end() {
      this.writableEnded = true;
    };
    const closeReq = new Readable({
      read() {
        this.push(null);
      },
    });
    closeReq.method = 'GET';
    closeReq.url = '/v1/other';
    closeReq.headers = { host: '127.0.0.1' };
    proxy(closeReq, closeRes);
    closeRes.emit('finish');
    await sleep(20);
    closeRes.emit('close');
    closeReq.emit('aborted');
    await sleep(50);

    let got = await request(port, 'PUT', '/v1/other', { n: 1 }, undefined, 0);
    if (got.status !== 200 || got.body.indexOf('other') < 0) fail('unknown_forward put body');
    got = await request(port, 'GET', '/v1/other', undefined, undefined, 0);
    if (got.status !== 200 || got.body.indexOf('other') < 0) fail('unknown_forward get body');
    const assetIdBackendRequests = seen.filter((row) => row.method === 'GET' && row.path === '/v1/asset/1').length;
    got = await request(port, 'GET', '/v1/asset/1');
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('parameterized GET must be local miss');
    if (seen.filter((row) => row.method === 'GET' && row.path === '/v1/asset/1').length !== assetIdBackendRequests) {
      fail('parameterized GET must not be forwarded');
    }
    cache.delete('GET /v1/setting/infoBanner');
    const bannerBackendRequests = seen.filter((row) => row.method === 'GET' && row.path === '/v1/setting/infoBanner').length;
    got = await request(port, 'GET', '/v1/setting/infoBanner');
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('nested swagger GET before fill must be local miss');
    if (seen.filter((row) => row.method === 'GET' && row.path === '/v1/setting/infoBanner').length !== bannerBackendRequests) {
      fail('nested swagger GET before fill must not be forwarded');
    }

    if (!seen.some((row) => row.method === 'PUT' && row.path === '/v1/other')) fail('unknown_forward put');
    if (!seen.some((row) => row.method === 'GET' && row.path === '/v1/other')) fail('unknown_forward get');

    setSwaggerSpec(null);
    got = await request(port, 'GET', '/swagger-json');
    if (got.status !== 503) fail('swagger empty json');
    got = await request(port, 'HEAD', '/swagger-json');
    if (got.status !== 503 || got.body !== '' || got.headers['x-front-api'] !== 'local') fail('swagger empty HEAD');
    got = await request(port, 'GET', '/swagger');
    if (got.status !== 503) fail('swagger empty html');
    got = await request(port, 'GET', '/swagger-ui/');
    if (got.status !== 503) fail('swagger-ui empty');
    setSwaggerSpec({ paths: { '/v1/asset': {} }, info: { title: 'x' } });
    got = await request(port, 'GET', '/swagger-json/');
    if (got.status !== 200) fail('swagger json');
    got = await request(port, 'HEAD', '/swagger-json');
    if (got.status !== 200 || got.body !== '' || !(+got.headers['content-length'] > 0)) fail('swagger json HEAD');
    got = await request(port, 'GET', '/swagger/');
    if (got.status !== 200) fail('swagger html');
    got = await request(port, 'HEAD', '/swagger');
    if (got.status !== 200 || got.body !== '' || !(+got.headers['content-length'] > 0)) fail('swagger html HEAD');
    got = await request(port, 'GET', '/swagger-ui');
    if (got.status !== 200) fail('swagger-ui');

    got = await request(port, 'GET', '/version');
    if (got.status !== 200 || got.body.indexOf('front-api') < 0) fail('version json');
    got = await request(port, 'GET', '/version', undefined, { accept: 'text/html' });
    if (String(got.headers['content-type']).indexOf('text/html') < 0) fail('version html');
    got = await request(port, 'HEAD', '/version', undefined, { accept: 'text/html' });
    if (got.status !== 200 || got.body !== '' || !(+got.headers['content-length'] > 0)) fail('version html HEAD');

    cache.clear();
    got = await request(port, 'HEAD', '/v1/asset');
    if (got.status !== 503 || got.body !== '' || got.headers['x-front-api'] !== 'local') fail('HEAD cache miss must be local');
    got = await request(port, 'GET', '/v1/statistic');
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('cache miss must not proxy');
    putCache('GET /v1/statistic', 200, { 'content-type': 'application/json' }, Buffer.from('{"ok":1}'));
    got = await request(port, 'GET', '/v1/statistic');
    if (got.headers['x-front-api'] !== 'hit') fail('cache hit');

    setPool({
      query: async () => ({
        rows: [
          {
            id: 1,
            symbol: 'CH',
            name: 'Switzerland',
            foreignName: 'X',
            ipEnable: 1,
            fatfEnable: 1,
            dfxEnable: 1,
            dfxOrganizationEnable: 0,
            nationalityStepEnable: 1,
            bankEnable: 1,
            checkoutEnable: 0,
            cryptoEnable: 1,
          },
        ],
      }),
    });
    got = await request(port, 'GET', '/v1/country');
    if (got.status !== 200 || got.headers['x-front-api'] !== 'db') fail('db country');
    cache.delete('GET /v1/country');
    got = await request(port, 'GET', '/v1/country', undefined, { authorization: 'Bearer x' });
    if (got.status !== 200 || got.headers['x-front-api'] !== 'db') fail('auth db country');
    if (getCached('GET /v1/country')) fail('auth db country must not fill public cache');
    setPool({ query: async () => null });
    got = await request(port, 'GET', '/v1/language');
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('db null');
    putCache('GET /v1/language', 200, { 'content-type': 'application/json' }, Buffer.from('{"s":1}'));
    cache.get('GET /v1/language').exp = Date.now() - 1;
    setPool({
      query: async () => {
        throw new Error('db down');
      },
    });
    got = await request(port, 'GET', '/v1/language');
    if (got.headers['x-front-api'] === 'stale') fail('db catch must not serve stale');
    if (got.body.includes('{"s":1}')) fail('db catch must not replay expired cache');
    cache.delete('GET /v1/language');
    cache.clear();
    got = await request(port, 'GET', '/v1/language');
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('db catch must not proxy');
    setPool(null);
    const authBackendRequests = seen.filter((row) => row.method === 'GET' && row.path === '/v1/country').length;
    got = await request(port, 'GET', '/v1/country', undefined, { authorization: 'Bearer x' });
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('auth GET must be local miss');
    if (seen.filter((row) => row.method === 'GET' && row.path === '/v1/country').length !== authBackendRequests) {
      fail('auth GET must not be forwarded');
    }
    putCache('GET /v1/asset', 200, { 'content-type': 'application/json' }, Buffer.from('{"public":true}'));
    got = await request(port, 'GET', '/v1/asset', undefined, { authorization: 'Bearer x' });
    if (got.status !== 503 || got.headers['x-front-api'] === 'hit' || got.body.includes('public')) {
      fail('auth GET must not read public cache');
    }

    await new Promise((resolve, reject) => {
      const held = [];
      const hanging = net.createServer((sock) => held.push(sock));
      hanging.listen(0, '127.0.0.1', () => {
        const hPort = hanging.address().port;
        const req = http.request({ hostname: '127.0.0.1', port: hPort, path: '/', method: 'GET' });
        let timedOut = false;
        attachRequestTimeout(req, 50, () => {
          timedOut = true;
          req.destroy();
        });
        req.on('error', () => {
          for (const sock of held) sock.destroy();
          hanging.close(() => (timedOut ? resolve() : reject(new Error('timeout'))));
        });
        req.end();
      });
      hanging.on('error', reject);
    });

    const upClient = new net.Socket();
    server.emit(
      'upgrade',
      {
        method: 'GET',
        url: '/socket',
        httpVersion: '1.1',
        headers: { host: '127.0.0.1', 'x-empty': undefined, 'x-list': ['a', 'b'] },
      },
      upClient,
      Buffer.from('extra'),
    );
    await sleep(50);
    upClient.emit('error', new Error('upgrade client'));
    upClient.emit('close');
    upClient.destroy();
    const deadUp = new net.Socket();
    deadUp.destroy();
    server.emit('upgrade', { method: 'GET', url: '/socket', httpVersion: '1.1', headers: {} }, deadUp, Buffer.alloc(0));
    const alreadyDead = new net.Socket();
    alreadyDead.destroyed = true;
    server.emit('upgrade', { method: 'GET', url: '/socket', httpVersion: '1.1', headers: {} }, alreadyDead, Buffer.alloc(0));
    const upFirst = new net.Socket();
    server.emit('upgrade', { method: 'GET', url: '/socket', httpVersion: '1.1', headers: {} }, upFirst, Buffer.alloc(0));
    await sleep(40);
    const raceSock = new net.Socket();
    server.emit('upgrade', { method: 'GET', url: '/socket', httpVersion: '1.1', headers: {} }, raceSock, Buffer.alloc(0));
    raceSock.destroy();
    await sleep(80);

    const sent = fakeRes();
    sent.headersSent = true;
    rejectUnserved(sent);
    const noUrl = fakeRes();
    const noUrlReq = new http.IncomingMessage(new net.Socket());
    noUrlReq.method = 'GET';
    noUrlReq.url = undefined;
    noUrlReq.headers = {};
    server.emit('request', noUrlReq, noUrl);

    await refreshSwagger();
    await refreshCache();
    if (getCached('GET /v1/app')) fail('refreshCache must skip non-200');
    if (!getCached('GET /')) fail('refreshCache must fill GET /');
    if (!getCached('GET /v1/setting/infoBanner')) fail('refreshCache must fill listed nested swagger GET');
    if (getCached('GET /v1/other')) fail('refreshCache must not fill a path outside the allowlist');
    got = await request(port, 'GET', '/');
    if (got.status !== 200 || got.body.indexOf('root') < 0) fail('GET / from background cache');
    got = await request(port, 'GET', '/v1/setting/infoBanner');
    if (got.status !== 200 || got.body.indexOf('banner') < 0 || got.headers['x-front-api'] !== 'hit') {
      fail('nested swagger GET must use background cache');
    }
    got = await request(port, 'GET', '/v1/asset?x=1');
    if (got.status !== 200 || got.headers['x-front-api'] !== 'hit') fail('query must hit path cache');
    got = await request(port, 'HEAD', '/v1/asset');
    if (got.status !== 200 || got.headers['x-front-api'] !== 'hit') fail('HEAD must share GET cache');
    if (got.body !== '') fail('HEAD cache hit must have empty body');
    got = await request(port, 'GET', '/v1/asset');
    if (got.status !== 200 || got.body.indexOf('BTC') < 0) fail('ttl_expire: prime');
    got = await request(port, 'GET', '/v1/asset');
    if (got.headers['x-front-api'] !== 'hit') fail('ttl_expire: cache hit before expiry');
    await new Promise((r) => setTimeout(r, 2200));
    await close(backend);
    await refreshCache();
    got = await request(port, 'GET', '/v1/asset');
    if (got.status !== 503) fail('ttl_expire: expected 503');
    if (got.body.indexOf('not served') < 0) fail('ttl_expire: expected not served');
    if (got.body.indexOf('BTC') >= 0) fail('ttl_expire: must not replay expired cache body');
    rejectUnserved(fakeRes());
    const blockedProxy = fakeRes();
    blockedProxy.headersSent = true;
    proxy({ method: 'GET', url: '/v1/other', headers: {}, pipe() {} }, blockedProxy);
    got = await request(port, 'PUT', '/v1/other', { n: 1 }, undefined, 0);
    if (got.status !== 503) fail('unknown_forward dead backend');
    if (!got.body.includes('backend-api unavailable')) fail('unknown_forward dead body');
    if (got.body.includes('not served')) fail('unknown dead backend must still be forwarded');
    const late = fakeRes();
    const lateReq = new Readable({
      read() {
        this.push(null);
      },
    });
    lateReq.method = 'GET';
    lateReq.url = '/v1/other';
    lateReq.headers = {};
    proxy(lateReq, late);
    late.headersSent = true;
    late.writableEnded = true;
    await sleep(50);
    cache.clear();
    putCache('GET /v1/statistic', 200, { 'content-type': 'application/json' }, Buffer.from('{"stale":true}'));
    cache.get('GET /v1/statistic').exp = Date.now() - 1;
    got = await request(port, 'GET', '/v1/statistic');
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('expired cache after backend down must be not served');
    if (got.body.includes('{"stale":true}')) fail('must not replay expired cache body');
    cache.clear();
    got = await request(port, 'GET', '/v1/statistic');
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('miss after backend down must be not served');

    const heldHang = [];
    const hang = net.createServer((c) => heldHang.push(c));
    await new Promise((resolve, reject) => {
      hang.listen(bPort, '127.0.0.1', resolve);
      hang.on('error', reject);
    });
    got = await request(port, 'GET', '/v1/coin');
    if (got.status !== 503 || got.body.indexOf('not served') < 0) fail('hanging backend must not be contacted');
    if (heldHang.length !== 0) fail('hanging backend must receive no client request');
    await refreshSwagger();
    for (const c of heldHang) c.destroy();
    await close(hang);

    await new Promise((resolve) => {
      const sock = net.connect(bPort, '127.0.0.1');
      sock.on('error', () => resolve());
      sock.on('connect', () => {
        sock.destroy();
        resolve();
      });
      setTimeout(resolve, 100);
    });
  } finally {
    await close(server);
  }

  const badJson = http.createServer((req, res) => {
    res.end('not-json');
  });
  const bjPort = await listen(badJson);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `process.env.BACKEND_URL=${JSON.stringify('http://127.0.0.1:' + bjPort)};
const s=require(${JSON.stringify(serverJs)});
s.refreshSwagger().then(()=>process.exit(0));`,
      ],
      { env: childEnv() },
    );
    child.on('exit', () => resolve());
    child.on('error', reject);
    setTimeout(() => child.kill('SIGKILL'), 5000);
  });
  await close(badJson);

  const noPaths = http.createServer(jsonHandler({ '/swagger-json': { info: {} } }));
  const npPort = await listen(noPaths);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `process.env.BACKEND_URL=${JSON.stringify('http://127.0.0.1:' + npPort)};
const s=require(${JSON.stringify(serverJs)});
s.refreshSwagger().then(()=>process.exit(0));`,
      ],
      { env: childEnv() },
    );
    child.on('exit', () => resolve());
    child.on('error', reject);
    setTimeout(() => child.kill('SIGKILL'), 5000);
  });
  await close(noPaths);

  await close(backend);

  const missing = spawnSync(process.execPath, [serverJs], {
    env: childEnv({ BACKEND_URL: '' }),
    encoding: 'utf8',
    timeout: 5000,
  });
  if (missing.status === 0) fail('BACKEND_URL required');
  const missing2 = spawnSync(process.execPath, [serverJs], {
    env: childEnv({ BACKEND_URL: undefined }),
    encoding: 'utf8',
    timeout: 5000,
  });
  void missing2;

  const sqlMiss = spawnSync(process.execPath, [serverJs], {
    env: childEnv({ BACKEND_URL: 'http://127.0.0.1:9', SQL_HOST: '127.0.0.1', SQL_PORT: '', SQL_DB: '', SQL_USERNAME: '' }),
    encoding: 'utf8',
    timeout: 5000,
  });
  if (sqlMiss.status === 0) fail('SQL incomplete');

  const sqlSsl = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.BACKEND_URL='http://127.0.0.1:9';
process.env.SQL_HOST='127.0.0.1';
process.env.SQL_PORT='5432';
process.env.SQL_DB='db';
process.env.SQL_USERNAME='u';
process.env.SQL_PASSWORD='';
process.env.SQL_SSL='true';
const s=require(${JSON.stringify(serverJs)});
if(!s.getPool()) process.exit(2);
s.getPool().emit('error', new Error('boom'));
process.exit(0);`,
    ],
    { env: childEnv(), encoding: 'utf8', timeout: 8000 },
  );
  if (sqlSsl.status !== 0) fail('sql ssl ' + (sqlSsl.stderr || sqlSsl.status));

  const sqlPlain = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.BACKEND_URL='http://127.0.0.1:9';
process.env.SQL_HOST='127.0.0.1';
process.env.SQL_PORT='5432';
process.env.SQL_DB='db';
process.env.SQL_USERNAME='u';
process.env.SQL_PASSWORD='p';
delete process.env.SQL_SSL;
const s=require(${JSON.stringify(serverJs)});
if(!s.getPool()) process.exit(2);
process.exit(0);`,
    ],
    { env: childEnv(), encoding: 'utf8', timeout: 8000 },
  );
  if (sqlPlain.status !== 0) fail('sql plain ' + (sqlPlain.stderr || sqlPlain.status));

  const { req: dReq, res: dRes } = mockReqRes();
  attachResponseBudget(dReq, dRes, 15);
  await sleep(40);
  if (dRes.status !== 503) fail('deadline 503');
  if (String(dRes.body).indexOf('response deadline exceeded') < 0) fail('deadline body');
  if (!dRes.headers || dRes.headers.connection !== 'close') fail('deadline 503 connection close');
  if (dReq.destroyed) fail('deadline 503 must not destroy before flush');

  const { req: kReq, res: kRes } = mockReqRes();
  kRes.end = function end(body) {
    this.body = body;
  };
  attachResponseBudget(kReq, kRes, 15);
  await sleep(40);
  if (kRes.status !== 503) fail('hard cut 503');
  if (!kReq.destroyed) fail('hard cut after 503 without finish');

  const { req: hReq, res: hRes } = mockReqRes();
  attachResponseBudget(hReq, hRes, 15);
  hRes.writeHead(200, {});
  await sleep(40);
  if (!hReq.destroyed) fail('deadline after headers');

  const { req: eReq, res: eRes } = mockReqRes();
  eRes.headersSent = true;
  eRes.writableEnded = true;
  attachResponseBudget(eReq, eRes, 15);
  await sleep(40);
  if (!eReq.destroyed) fail('deadline must cut ended-but-unfinished drain');

  const { req: zReq, res: zRes } = mockReqRes();
  zRes.headersSent = true;
  zRes.destroyed = true;
  attachResponseBudget(zReq, zRes, 15);
  await sleep(40);
  if (zReq.destroyed) fail('deadline must not destroy already-destroyed response');

  const loggedPg = [];
  const origPgErr = console.error;
  console.error = function error(...args) {
    loggedPg.push(args.join(' '));
  };
  const fakePool = new EventEmitter();
  attachPoolGuards(fakePool);
  fakePool.emit('connect', { query: () => Promise.resolve() });
  let dropped = false;
  fakePool.emit('connect', {
    query: () => Promise.reject(new Error('no timeout')),
    release(force) {
      dropped = force === true;
    },
  });
  fakePool.emit('connect', {
    query: () => Promise.reject(new Error('no timeout')),
    end() {
      dropped = true;
    },
  });
  await onPoolConnect({ query: () => Promise.resolve('ok') });
  await sleep(20);
  console.error = origPgErr;
  if (!loggedPg.some((line) => line.indexOf('pg statement_timeout') >= 0)) fail('pool statement_timeout error');
  if (!dropped) fail('pool SET fail must drop client');

  const { req: fReq, res: fRes } = mockReqRes();
  attachResponseBudget(fReq, fRes, 20);
  sendJson(fRes, 200, { ok: 1 }, 'local');
  if (fRes.status !== 200) fail('budget fast send');
  await sleep(40);
  sendJson(fRes, 500, { ok: 0 }, 'local');
  if (fRes.status !== 200) fail('sendJson after headers');
  if (canWrite(fRes)) fail('canWrite after send');

  const logged = [];
  const origErr = console.error;
  console.error = function error(...args) {
    logged.push(args.join(' '));
  };
  const { req: sReq, res: sRes } = mockReqRes();
  attachResponseBudget(sReq, sRes);
  await sleep(120);
  console.error = origErr;
  if (sRes.status !== 503) fail('default deadline 503');
  if (!logged.some((line) => line.indexOf('ERROR response exceeded') >= 0)) fail('over budget ERROR log');

  const cap = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.BACKEND_URL='http://127.0.0.1:9';
delete process.env.REQUEST_TIMEOUT_MS;
const s=require(${JSON.stringify(serverJs)});
if(s.MAX_RESPONSE_MS!==100) process.exit(2);
if(s.REQUEST_TIMEOUT_MS!==100) process.exit(3);
process.exit(0);`,
    ],
    { env: childEnv({ REQUEST_TIMEOUT_MS: '' }), encoding: 'utf8', timeout: 3000 },
  );
  if (cap.status !== 0) fail('MAX_RESPONSE_MS cap default: ' + cap.status);

  const capHigh = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.BACKEND_URL='http://127.0.0.1:9';
process.env.REQUEST_TIMEOUT_MS='20000';
const s=require(${JSON.stringify(serverJs)});
if(s.REQUEST_TIMEOUT_MS!==100) process.exit(2);
process.exit(0);`,
    ],
    { env: childEnv({ REQUEST_TIMEOUT_MS: '20000' }), encoding: 'utf8', timeout: 3000 },
  );
  if (capHigh.status !== 0) fail('REQUEST_TIMEOUT_MS must not exceed 100: ' + capHigh.status);

  const capZero = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.BACKEND_URL='http://127.0.0.1:9';
process.env.REQUEST_TIMEOUT_MS='0';
const s=require(${JSON.stringify(serverJs)});
if(s.REQUEST_TIMEOUT_MS!==100) process.exit(2);
process.exit(0);`,
    ],
    { env: childEnv({ REQUEST_TIMEOUT_MS: '0' }), encoding: 'utf8', timeout: 3000 },
  );
  if (capZero.status !== 0) fail('REQUEST_TIMEOUT_MS=0 must not disable timeout: ' + capZero.status);

  const pgThrow = spawnSync(
    process.execPath,
    ['-r', path.join(repoRoot, 'test', 'preload-pg-throw.js'), serverJs],
    {
      env: childEnv({
        BACKEND_URL: 'http://127.0.0.1:9',
        SQL_HOST: '127.0.0.1',
        SQL_PORT: '5432',
        SQL_DB: 'db',
        SQL_USERNAME: 'u',
        SQL_PASSWORD: 'p',
      }),
      encoding: 'utf8',
      timeout: 5000,
    },
  );
  if (pgThrow.status === 0) fail('pg throw');

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    boot();
  });
  await close(server);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    setPool({ query: async () => ({ rows: [] }) });
    boot();
  });
  await close(server);

  const listenOff = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverJs], {
      env: childEnv({ BACKEND_URL: 'http://127.0.0.1:9', PORT: '0', BIND: '127.0.0.1' }),
    });
    let out = '';
    const done = () => {
      child.kill('SIGTERM');
      resolve(out);
    };
    child.stdout.on('data', (d) => {
      out += d;
      if (out.indexOf('listening') >= 0) done();
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('error', reject);
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve(out);
    }, 4000);
  });
  if (listenOff.indexOf('listening') < 0) fail('listen off: ' + listenOff);

  const listenOn = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverJs], {
      env: childEnv({
        BACKEND_URL: 'http://127.0.0.1:9',
        PORT: '0',
        BIND: '127.0.0.1',
        SQL_HOST: '127.0.0.1',
        SQL_PORT: '5432',
        SQL_DB: 'db',
        SQL_USERNAME: 'u',
        SQL_PASSWORD: 'p',
      }),
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      if (out.indexOf('listening') >= 0) child.kill('SIGTERM');
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('exit', () => resolve(out));
    child.on('error', reject);
    setTimeout(() => child.kill('SIGKILL'), 4000);
  });
  if (listenOn.indexOf('db-read on') < 0 && listenOn.indexOf('listening') < 0) fail('listen on: ' + listenOn);

  const httpsChild = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.BACKEND_URL='https://127.0.0.1';
const http=require('http');
const s=require(${JSON.stringify(serverJs)});
s.server.listen(0,'127.0.0.1',()=>{
  http.get({hostname:'127.0.0.1',port:s.server.address().port,path:'/v1/setting'},(res)=>{
    res.resume();
    res.on('end',()=>s.server.close(()=>process.exit(0)));
  }).on('error',()=>s.server.close(()=>process.exit(0)));
});`,
    ],
    { env: childEnv(), encoding: 'utf8', timeout: 8000 },
  );
  void httpsChild;

  const http80 = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.BACKEND_URL='http://127.0.0.1';
const http=require('http');
const s=require(${JSON.stringify(serverJs)});
s.server.listen(0,'127.0.0.1',()=>{
  http.get({hostname:'127.0.0.1',port:s.server.address().port,path:'/v1/bank'},(res)=>{
    res.resume();
    res.on('end',()=>s.server.close(()=>process.exit(0)));
  }).on('error',()=>s.server.close(()=>process.exit(0)));
});`,
    ],
    { env: childEnv(), encoding: 'utf8', timeout: 8000 },
  );
  void http80;
  const bootErr = spawnSync(
    process.execPath,
    [
      '-e',
      `process.env.BACKEND_URL='http://127.0.0.1:9';
process.env.FRONT_API_EXIT_AFTER_BOOT='1';
const s=require(${JSON.stringify(serverJs)});
if(!s.maybeExitAfterBoot()) process.exit(2);
s.server.emit('error', new Error('boot fail'));
setTimeout(()=>process.exit(3), 1000);`,
    ],
    { env: childEnv({ FRONT_API_EXIT_AFTER_BOOT: '1' }), encoding: 'utf8', timeout: 3000 },
  );
  if (bootErr.status !== 1) fail('maybeExitAfterBoot error exit: ' + bootErr.status);

  console.log('ok front-api server.js');
}

main().catch((err) => {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
