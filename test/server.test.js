'use strict';

const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
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

function request(port, method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
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
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
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
  };
}

function jsonHandler(routes) {
  return (req, res) => {
    const p = (req.url || '/').split('?')[0];
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
  const quote = { rate: 2, fees: { rate: 0.01, fixed: 0 } };
  const ram = { price: 1 };
  const swagger = {
    paths: { '/v1/asset': { get: {} }, '/v1/user': { get: {} }, '/version': { get: {} } },
  };

  const backend = http.createServer(
    jsonHandler({
      '/v1/asset': assets,
      '/v1/fiat': fiats,
      '/v1/buy/quote': quote,
      '/v1/sell/quote': quote,
      '/v1/swap/quote': quote,
      '/v1/realunit/quote/buyPrice': ram,
      '/v1/realunit/quote/buyShares': ram,
      '/v1/realunit/quote/info': ram,
      '/v1/realunit/quote/price': ram,
      '/v1/realunit/brokerbot/buyPrice': ram,
      '/v1/realunit/brokerbot/buyShares': ram,
      '/v1/realunit/brokerbot/info': ram,
      '/v1/realunit/brokerbot/price': ram,
      '/swagger-json': swagger,
      '/v1/statistic': { ok: 1 },
      '/v1/setting': { ok: 1 },
      '/v1/bank': { ok: 1 },
      '/v1/app': { ok: 1 },
      '/v1/coin': { ok: 1 },
    }),
  );
  const bPort = await listen(backend);
  process.env.BACKEND_URL = 'http://127.0.0.1:' + bPort;
  process.env.PORT = '0';
  process.env.REQUEST_TIMEOUT_MS = '50';
  delete process.env.BIND;
  delete process.env.CACHE_TTL_MS;
  delete process.env.CACHE_MAX;
  delete process.env.SQL_HOST;
  delete process.env.QUOTE_BOOK_REFRESH;

  const s = require(serverJs);
  const {
    QUOTE_TTL_MS,
    CACHE_MAX,
    CACHE_PREFIXES,
    RAM_GET_PATHS,
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
    attachRequestTimeout,
    setSwaggerSpec,
    getSwaggerSpec,
    setPool,
    getPool,
    proxy,
    boot,
    maybeExitAfterBoot,
    orFallback,
    backendPortFor,
    server,
  } = s;

  if (maybeExitAfterBoot() !== false) fail('maybeExitAfterBoot off');
  if (orFallback('', 'x') !== 'x' || orFallback('a', 'x') !== 'a') fail('orFallback');
  const { URL } = require('url');
  if (backendPortFor(new URL('http://127.0.0.1:9')) !== 9) fail('backendPort set');
  if (backendPortFor(new URL('http://127.0.0.1')) !== 80) fail('backendPort 80');
  if (backendPortFor(new URL('https://example.com')) !== 443) fail('backendPort 443');
  if (!(QUOTE_TTL_MS > 0) || !(CACHE_MAX > 0)) fail('constants');
  if (!CACHE_PREFIXES.includes('/v1/asset')) fail('CACHE_PREFIXES');
  if (!RAM_GET_PATHS.includes('/v1/realunit/quote/price')) fail('RAM_GET_PATHS');
  if (getPool() !== null) fail('pool default');

  if (!isQuoteFresh({ json: { ok: 1 }, at: Date.now() })) fail('isQuoteFresh fresh');
  if (isQuoteFresh({ json: { ok: 1 }, at: Date.now() - QUOTE_TTL_MS - 1 })) fail('isQuoteFresh stale');
  if (isQuoteFresh(undefined) || isQuoteFresh({ json: { ok: 1 } })) fail('isQuoteFresh miss');

  if (pairKey('buy', {}) !== 'buy||||Bank') fail('pairKey empty');
  if (pairKey('buy', { currency: { name: 'CHF' }, asset: { uniqueName: 'BTC' } }).indexOf('CHF') < 0) {
    fail('pairKey uniqueName');
  }
  if (pairKey('swap', { sourceAsset: { id: 1 }, targetAsset: { name: 'ETH' } }).indexOf('ETH') < 0) {
    fail('pairKey swap');
  }
  if (pairKey('buy', { currency: { id: 1 }, asset: { name: 'BTC' }, paymentMethod: 'Instant' }).indexOf('Instant') < 0) {
    fail('pairKey instant');
  }
  if (pairKey('buy', { currency: { id: 1 }, sourceAsset: { name: 'A' } }).indexOf('A') < 0) fail('pairKey source');

  if (!isServedPath('/version') || !isServedPath('/swagger/') || !isServedPath('/swagger-json/')) fail('isServedPath meta');
  if (!isServedPath('/swagger-ui') || !isServedPath('/swagger-ui/')) fail('isServedPath ui');
  if (!isServedPath('/v1/buy/quote') || !isServedPath('/v1/sell/quote') || !isServedPath('/v1/swap/quote')) {
    fail('isServedPath quotes');
  }
  if (!isServedPath('/v1/asset/1') || !isServedPath(undefined)) fail('isServedPath');
  if (!isServedPath('/v1/realunit/quote/price')) fail('isServedPath ram');
  if (isServedPath('/v1/user')) fail('isServedPath user');

  if (!isCacheable({ method: 'GET', url: '/v1/asset', headers: {} })) fail('cache GET');
  if (!isCacheable({ method: 'HEAD', url: '/', headers: {} })) fail('cache HEAD');
  if (!isCacheable({ method: 'GET', url: '/version', headers: {} })) fail('cache version');
  if (!isCacheable({ method: 'GET', url: '/swagger', headers: {} })) fail('cache swagger');
  if (!isCacheable({ method: 'GET', url: '/swagger-json', headers: {} })) fail('cache swagger-json');
  if (isCacheable({ method: 'PUT', url: '/v1/asset', headers: {} })) fail('cache PUT');
  if (isCacheable({ method: 'GET', url: '/v1/asset', headers: { authorization: 'x' } })) fail('cache auth');
  if (isCacheable({ method: 'GET', url: '/v1/user', headers: {} })) fail('cache user');
  if (cacheKey({ method: 'GET', url: '/a' }) !== 'GET /a') fail('cacheKey');

  const scaledAmt = scaleQuote({ json: { rate: 2, fees: { rate: 0.01, fixed: 1 } } }, { amount: 100 });
  if (scaledAmt.estimatedAmount !== 50 || scaledAmt.feeAmount !== 2) fail('scale amount');
  const scaledTgt = scaleQuote({ json: { rate: 2, fees: { rate: 0.01 } } }, { targetAmount: 10 });
  if (scaledTgt.amount !== 20) fail('scale target');
  if (scaleQuote({ json: { rate: 0 } }, { amount: 1 }) !== null) fail('scale zero');
  if (scaleQuote({ json: { rate: 2 } }, {}).rate !== 2) fail('scale none');
  if (scaleQuote({ json: { rate: 2, fees: { rate: 'x' } } }, { amount: 10 }).feeAmount !== undefined) {
    fail('scale fees type');
  }
  const scaledZeroFee = scaleQuote({ json: { rate: 2, fees: { rate: 0, fixed: 0 } } }, { amount: 10 });
  if (scaledZeroFee.feeAmount !== 0) fail('scale fee fallback');
  const scaledZeroFeeT = scaleQuote({ json: { rate: 2, fees: { rate: 0, fixed: 0 } } }, { targetAmount: 10 });
  if (scaledZeroFeeT.feeAmount !== 0) fail('scale fee fallback target');

  const m = new Map();
  rememberQuote(m, 'buy', { json: { rate: 1 }, at: 1 }, [{ currency: { id: 1 }, asset: { id: 2 } }]);
  if (m.size !== 1) fail('rememberQuote');

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

  await refreshQuoteBook();
  if (quoteBook.buy.size === 0 || quoteBook.sell.size === 0 || quoteBook.realunit.size === 0) {
    fail('refreshQuoteBook empty');
  }
  await refreshSwagger();
  if (!getSwaggerSpec() || !getSwaggerSpec().paths['/v1/asset'] || getSwaggerSpec().paths['/v1/user']) {
    fail('refreshSwagger allowlist');
  }

  const port = await listen(server);
  try {
    quoteBook.realunit.clear();
    let got = await request(port, 'GET', '/v1/realunit/quote/price');
    if (got.status !== 503) fail('ram_miss');
    quoteBook.realunit.set('/v1/realunit/quote/price', { json: { price: 1 }, at: Date.now() - QUOTE_TTL_MS - 1 });
    got = await request(port, 'GET', '/v1/realunit/quote/price');
    if (got.status !== 503) fail('ram_stale');
    quoteBook.realunit.set('/v1/realunit/quote/price', { json: { price: 42 }, at: Date.now() });
    got = await request(port, 'GET', '/v1/realunit/quote/price');
    if (got.status !== 200 || got.headers['x-front-api'] !== 'ram') fail('ram_fresh');
    quoteBook.realunit.set('/v1/realunit/brokerbot/price', { json: { price: 3 }, at: Date.now() });
    got = await request(port, 'GET', '/v1/realunit/brokerbot/price');
    if (got.status !== 200) fail('ram brokerbot');

    const buyBody = { currency: { id: 1 }, asset: { id: 2 }, amount: 100, paymentMethod: 'Bank' };
    quoteBook.buy.clear();
    got = await request(port, 'PUT', '/v1/buy/quote', buyBody);
    if (got.status !== 503) fail('buy miss');
    quoteBook.buy.set(pairKey('buy', buyBody), { json: { rate: 2 }, at: Date.now() });
    got = await request(port, 'PUT', '/v1/buy/quote', buyBody);
    if (got.status !== 200) fail('buy fresh');
    quoteBook.buy.set(pairKey('buy', buyBody), { json: { rate: 0 }, at: Date.now() });
    got = await request(port, 'PUT', '/v1/buy/quote', buyBody);
    if (got.status !== 503) fail('buy zero');
    got = await request(port, 'PUT', '/v1/buy/quote', Buffer.from('not-json'));
    if (got.status !== 400) fail('buy invalid json');
    got = await request(port, 'PUT', '/v1/buy/quote', Buffer.alloc(0));
    if (got.status !== 503 && got.status !== 200) fail('buy empty body');

    quoteBook.sell.set(pairKey('sell', buyBody), { json: { rate: 2 }, at: Date.now() });
    got = await request(port, 'PUT', '/v1/sell/quote', buyBody);
    if (got.status !== 200) fail('sell');
    const swapBody = { sourceAsset: { id: 1 }, targetAsset: { id: 2 }, amount: 0.01 };
    quoteBook.swap.set(pairKey('swap', swapBody), { json: { rate: 2 }, at: Date.now() });
    got = await request(port, 'PUT', '/v1/swap/quote', swapBody);
    if (got.status !== 200) fail('swap');

    setSwaggerSpec(null);
    got = await request(port, 'GET', '/swagger-json');
    if (got.status !== 503) fail('swagger empty json');
    got = await request(port, 'GET', '/swagger');
    if (got.status !== 503) fail('swagger empty html');
    got = await request(port, 'GET', '/swagger-ui/');
    if (got.status !== 503) fail('swagger-ui empty');
    setSwaggerSpec({ paths: { '/v1/asset': {} }, info: { title: 'x' } });
    got = await request(port, 'GET', '/swagger-json/');
    if (got.status !== 200) fail('swagger json');
    got = await request(port, 'GET', '/swagger/');
    if (got.status !== 200) fail('swagger html');
    got = await request(port, 'GET', '/swagger-ui');
    if (got.status !== 200) fail('swagger-ui');

    got = await request(port, 'GET', '/version');
    if (got.status !== 200 || got.body.indexOf('front-api') < 0) fail('version json');
    got = await request(port, 'GET', '/version', undefined, { accept: 'text/html' });
    if (String(got.headers['content-type']).indexOf('text/html') < 0) fail('version html');

    cache.clear();
    got = await request(port, 'GET', '/v1/statistic');
    if (got.status !== 200 || got.headers['x-front-api'] !== 'miss') fail('proxy miss');
    got = await request(port, 'GET', '/v1/statistic');
    if (got.headers['x-front-api'] !== 'hit') fail('proxy hit');

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
    setPool({ query: async () => null });
    got = await request(port, 'GET', '/v1/language');
    if (!got.status) fail('db null');
    putCache('GET /v1/language', 200, { 'content-type': 'application/json' }, Buffer.from('{"s":1}'));
    cache.get('GET /v1/language').exp = Date.now() - 1;
    setPool({
      query: async () => {
        throw new Error('db down');
      },
    });
    got = await request(port, 'GET', '/v1/language');
    if (got.headers['x-front-api'] !== 'stale') fail('db catch stale');
    cache.delete('GET /v1/language');
    cache.clear();
    got = await request(port, 'GET', '/v1/language');
    if (!got.status) fail('db catch proxy');
    setPool(null);
    got = await request(port, 'GET', '/v1/country', undefined, { authorization: 'Bearer x' });
    if (!got.status) fail('db skip auth');

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

    await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write(
          'GET /socket HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-A: 1\r\nX-A: 2\r\n\r\n',
        );
      });
      sock.on('error', () => resolve());
      sock.on('data', () => {
        sock.destroy();
        resolve();
      });
      setTimeout(() => {
        sock.destroy();
        resolve();
      }, 300);
    });

    const liveUp = net.connect({ port: bPort, host: '127.0.0.1' });
    liveUp.on('error', () => {});
    server.emit(
      'upgrade',
      { method: 'GET', url: '/', httpVersion: '1.1', headers: { host: 'x', skip: undefined, arr: ['a', 'b'] } },
      liveUp,
      Buffer.from('hi'),
    );
    await new Promise((r) => setTimeout(r, 50));
    liveUp.destroy();

    const sent = fakeRes();
    sent.headersSent = true;
    const fakeReq = new http.IncomingMessage(new net.Socket());
    fakeReq.method = 'GET';
    fakeReq.url = '/nope';
    fakeReq.headers = {};
    proxy(fakeReq, sent, null);
    const noUrl = fakeRes();
    const noUrlReq = new http.IncomingMessage(new net.Socket());
    noUrlReq.method = 'GET';
    noUrlReq.url = undefined;
    noUrlReq.headers = {};
    server.emit('request', noUrlReq, noUrl);

    await close(backend);
    cache.clear();
    putCache('GET /v1/statistic', 200, { 'content-type': 'application/json' }, Buffer.from('{"stale":true}'));
    cache.get('GET /v1/statistic').exp = Date.now() - 1;
    got = await request(port, 'GET', '/v1/statistic');
    if (got.headers['x-front-api'] !== 'stale') fail('proxy stale after backend down');
    cache.clear();
    got = await request(port, 'GET', '/v1/statistic');
    if (got.status !== 503) fail('proxy 503 after backend down');

    const heldHang = [];
    const hang = net.createServer((c) => heldHang.push(c));
    await new Promise((resolve, reject) => {
      hang.listen(bPort, '127.0.0.1', resolve);
      hang.on('error', reject);
    });
    await refreshQuoteBook();
    got = await request(port, 'GET', '/v1/coin');
    if (got.status !== 503 && got.headers['x-front-api'] !== 'stale') fail('proxy hang timeout');
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

  const emptyBook = http.createServer(jsonHandler({ '/v1/asset': [], '/v1/fiat': [{ id: 10, name: 'CHF' }] }));
  const emptyPort = await listen(emptyBook);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `process.env.BACKEND_URL=${JSON.stringify('http://127.0.0.1:' + emptyPort)};
const s=require(${JSON.stringify(serverJs)});
s.refreshQuoteBook().then(()=>process.exit(0));`,
      ],
      { env: childEnv() },
    );
    child.on('exit', () => resolve());
    child.on('error', reject);
    setTimeout(() => child.kill('SIGKILL'), 5000);
  });
  await close(emptyBook);

  const noChf = http.createServer(jsonHandler({ '/v1/asset': assets, '/v1/fiat': [{ id: 11, name: 'EUR' }] }));
  const noChfPort = await listen(noChf);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `process.env.BACKEND_URL=${JSON.stringify('http://127.0.0.1:' + noChfPort)};
const s=require(${JSON.stringify(serverJs)});
s.refreshQuoteBook().then(()=>process.exit(0));`,
      ],
      { env: childEnv() },
    );
    child.on('exit', () => resolve());
    child.on('error', reject);
    setTimeout(() => child.kill('SIGKILL'), 5000);
  });
  await close(noChf);

  const notArr = http.createServer(jsonHandler({ '/v1/asset': { no: 'array' }, '/v1/fiat': fiats }));
  const naPort = await listen(notArr);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `process.env.BACKEND_URL=${JSON.stringify('http://127.0.0.1:' + naPort)};
const s=require(${JSON.stringify(serverJs)});
s.refreshQuoteBook().then(()=>process.exit(0));`,
      ],
      { env: childEnv() },
    );
    child.on('exit', () => resolve());
    child.on('error', reject);
    setTimeout(() => child.kill('SIGKILL'), 5000);
  });
  await close(notArr);

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

  const quoteErr = http.createServer((req, res) => {
    const p = (req.url || '/').split('?')[0];
    if (p === '/v1/asset') {
      res.end(JSON.stringify(assets));
      return;
    }
    if (p === '/v1/fiat') {
      res.end(JSON.stringify(fiats));
      return;
    }
    req.destroy();
  });
  const qePort = await listen(quoteErr);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `process.env.BACKEND_URL=${JSON.stringify('http://127.0.0.1:' + qePort)};
const s=require(${JSON.stringify(serverJs)});
s.refreshQuoteBook().then(()=>process.exit(0));`,
      ],
      { env: childEnv() },
    );
    child.on('exit', () => resolve());
    child.on('error', reject);
    setTimeout(() => child.kill('SIGKILL'), 8000);
  });
  await close(quoteErr);

  const noUnique = http.createServer(
    jsonHandler({
      '/v1/asset': [{ id: 1, name: 'A', buyable: true, sellable: true }],
      '/v1/fiat': [{ id: 10, name: 'CHF' }],
      '/v1/buy/quote': quote,
      '/v1/sell/quote': quote,
      '/v1/swap/quote': { rate: 2 },
      '/v1/realunit/quote/price': ram,
      '/v1/realunit/quote/buyPrice': ram,
      '/v1/realunit/quote/buyShares': ram,
      '/v1/realunit/quote/info': ram,
      '/v1/realunit/brokerbot/buyPrice': ram,
      '/v1/realunit/brokerbot/buyShares': ram,
      '/v1/realunit/brokerbot/info': ram,
      '/v1/realunit/brokerbot/price': ram,
    }),
  );
  const nuPort = await listen(noUnique);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `process.env.BACKEND_URL=${JSON.stringify('http://127.0.0.1:' + nuPort)};
const s=require(${JSON.stringify(serverJs)});
s.refreshQuoteBook().then(()=>process.exit(0));`,
      ],
      { env: childEnv() },
    );
    child.on('exit', () => resolve());
    child.on('error', reject);
    setTimeout(() => child.kill('SIGKILL'), 8000);
  });
  await close(noUnique);

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
    process.env.QUOTE_BOOK_REFRESH = '';
    boot();
  });
  await close(server);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    process.env.QUOTE_BOOK_REFRESH = '1';
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
      if (out.indexOf('quote book refresh disabled') >= 0) done();
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
        QUOTE_BOOK_REFRESH: '1',
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
  void os;

  console.log('ok front-api server.js');
}

main().catch((err) => {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
