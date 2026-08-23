'use strict';

const http = require('http');

const DEFAULT_BIND = '127.0.0.1';
const DEFAULT_PORT = 3004;
// Do not require server.js here: it exits when BACKEND_URL is missing.
const PREFIXES = [
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

const fixtures = {
  '/v1/asset': [
    {
      id: 1,
      name: 'BTC',
      uniqueName: 'Bitcoin',
      buyable: true,
      sellable: true,
    },
  ],
  '/v1/fiat': [
    {
      id: 1,
      name: 'EUR',
      buyable: true,
      sellable: true,
    },
  ],
  '/v1/country': [
    {
      id: 1,
      symbol: 'CH',
      name: 'Switzerland',
      foreignName: 'Switzerland',
      locationAllowed: true,
      ibanAllowed: true,
      kycAllowed: true,
      kycOrganizationAllowed: true,
      nationalityAllowed: true,
      bankAllowed: true,
      cardAllowed: true,
      cryptoAllowed: true,
    },
  ],
  '/v1/language': [
    {
      id: 1,
      name: 'English',
      symbol: 'EN',
      foreignName: 'English',
      enable: true,
    },
  ],
  '/v1/statistic': { volume: 0 },
  '/v1/coin': [{ id: 1 }],
  '/v1/setting': { infoBanner: null },
  '/v1/bank': [{ id: 1, name: 'Test Bank' }],
  '/v1/app': { version: 'local' },
};

function orFallback(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

function sendJson(res, body, method) {
  const json = JSON.stringify(body);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(method === 'HEAD' ? undefined : json);
}

function swaggerDocument() {
  const paths = {
    '/version': { get: {} },
    '/': { get: {} },
  };

  for (const prefix of PREFIXES) paths[prefix] = { get: {} };
  paths['/v1/buy/quote'] = { put: {} };

  return {
    openapi: '3.0.0',
    info: {
      title: 'DFX API',
      version: 'local',
    },
    paths,
  };
}

function fixtureForPath(path) {
  for (const prefix of PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return fixtures[prefix];
  }
  return undefined;
}

function respondAfterDrain(req, res, body) {
  req.on('data', () => {});
  req.on('end', () => {
    sendJson(res, body, req.method);
  });
}

function createLocalBackend() {
  return http.createServer((req, res) => {
    const method = req.method;
    const path = (req.url || '/').split('?')[0];

    if (method === 'GET' && path === '/swagger-json') {
      sendJson(res, swaggerDocument(), method);
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && path === '/') {
      sendJson(res, { ok: true }, method);
      return;
    }

    if (method === 'GET' || method === 'HEAD') {
      const fixture = fixtureForPath(path);
      if (fixture !== undefined) {
        sendJson(res, fixture, method);
        return;
      }
    }

    if (method === 'PUT' && path === '/v1/buy/quote') {
      respondAfterDrain(req, res, {
        price: 1,
        from: { amount: 1 },
        to: { amount: 1 },
      });
      return;
    }

    const body = {
      proxied: true,
      method,
      path,
    };
    if (method !== 'GET' && method !== 'HEAD') {
      respondAfterDrain(req, res, body);
      return;
    }
    sendJson(res, body, method);
  });
}

if (require.main === module) {
  const port = Number(orFallback(process.env.LOCAL_BACKEND_PORT, DEFAULT_PORT));
  const localBackend = createLocalBackend();

  localBackend.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
  localBackend.listen(port, DEFAULT_BIND);
}

module.exports = {
  DEFAULT_BIND,
  DEFAULT_PORT,
  PREFIXES,
  createLocalBackend,
};
