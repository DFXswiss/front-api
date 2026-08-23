'use strict';

const http = require('http');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

process.env.BACKEND_URL = 'http://127.0.0.1:9';

const server = require('../server.js');
const { PREFIXES, createLocalBackend } = require('../scripts/local-backend.js');
const {
  shouldStartLocalBackend,
  applyLocalDefaults,
} = require('../scripts/start-local.js');

function assert(condition, message) {
  if (!condition) fail(message);
}

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: body === undefined ? {} : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: responseBody,
          duration: Date.now() - startedAt,
        });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function close(serverToClose) {
  return new Promise((resolve, reject) => {
    serverToClose.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  assert(
    JSON.stringify(PREFIXES) === JSON.stringify(server.CACHE_PREFIXES),
    'PREFIXES must match server.CACHE_PREFIXES',
  );

  assert(shouldStartLocalBackend({}) === true, 'missing BACKEND_URL must start stub');
  assert(shouldStartLocalBackend({ BACKEND_URL: undefined }) === true, 'undefined BACKEND_URL must start stub');
  assert(shouldStartLocalBackend({ BACKEND_URL: null }) === true, 'null BACKEND_URL must start stub');
  assert(shouldStartLocalBackend({ BACKEND_URL: '' }) === true, 'empty BACKEND_URL must start stub');
  assert(
    shouldStartLocalBackend({ BACKEND_URL: 'http://127.0.0.1:9' }) === false,
    'configured BACKEND_URL must skip stub',
  );

  const defaults = applyLocalDefaults({});
  assert(defaults.PORT === '3000', 'default PORT must be 3000');
  assert(defaults.BIND === '127.0.0.1', 'default BIND must be loopback');
  assert(Object.keys(defaults).length === 2, 'local defaults must not add extra keys');

  const configured = applyLocalDefaults({ PORT: '4100', BIND: '0.0.0.0' });
  assert(configured.PORT === '4100', 'configured PORT must be preserved');
  assert(configured.BIND === '0.0.0.0', 'configured BIND must be preserved');

  const complete = {
    PORT: '4200',
    BIND: '127.0.0.2',
    BACKEND_URL: 'http://127.0.0.1:9',
  };
  applyLocalDefaults(complete);
  assert(complete.PORT === '4200', 'complete PORT must be preserved');
  assert(complete.BIND === '127.0.0.2', 'complete BIND must be preserved');
  assert(complete.BACKEND_URL === 'http://127.0.0.1:9', 'BACKEND_URL must be preserved');
  assert(Object.keys(complete).length === 3, 'complete environment must not gain keys');

  const nullEnv = applyLocalDefaults({ PORT: null, BIND: null });
  assert(nullEnv.PORT === '3000', 'null PORT must fall back to 3000');
  assert(nullEnv.BIND === '127.0.0.1', 'null BIND must fall back to loopback');

  const emptyEnv = applyLocalDefaults({ PORT: '', BIND: '' });
  assert(emptyEnv.PORT === '3000', 'empty PORT must fall back to 3000');
  assert(emptyEnv.BIND === '127.0.0.1', 'empty BIND must fall back to loopback');

  const localBackend = createLocalBackend();
  await new Promise((resolve, reject) => {
    localBackend.once('error', reject);
    localBackend.listen(0, '127.0.0.1', resolve);
  });

  try {
    const port = localBackend.address().port;
    const asset = await request(port, 'GET', '/v1/asset');
    const assetExtra = await request(port, 'GET', '/v1/asset/extra');
    const swagger = await request(port, 'GET', '/swagger-json');
    const quote = await request(port, 'PUT', '/v1/buy/quote', '{"amount":1}');
    const country = await request(port, 'GET', '/v1/country');
    const language = await request(port, 'GET', '/v1/language');

    for (const response of [asset, assetExtra, swagger, quote, country, language]) {
      assert(response.statusCode === 200, 'stub response status must be 200');
      assert(response.duration <= 100, `stub response exceeded 100ms: ${response.duration}ms`);
      try {
        response.json = JSON.parse(response.body);
      } catch (error) {
        fail(`stub response must contain JSON: ${error.message}`);
      }
    }

    assert(Array.isArray(asset.json), 'asset fixture must be an array');
    assert(asset.json[0].name === 'BTC', 'asset fixture must contain BTC');
    assert(Array.isArray(assetExtra.json), 'asset prefix fixture must be an array');
    assert(assetExtra.json[0].name === 'BTC', 'asset prefix fixture must contain BTC');

    assert(Array.isArray(country.json), 'country fixture must be an array');
    const countryFixture = country.json[0];
    assert(countryFixture.symbol === 'CH', 'country symbol must be CH');
    assert(countryFixture.name === 'Switzerland', 'country name must be Switzerland');
    for (const field of [
      'locationAllowed',
      'ibanAllowed',
      'kycAllowed',
      'kycOrganizationAllowed',
      'nationalityAllowed',
      'bankAllowed',
      'cardAllowed',
      'cryptoAllowed',
    ]) {
      assert(countryFixture[field] === true, `country ${field} must be true`);
    }

    assert(Array.isArray(language.json), 'language fixture must be an array');
    assert(language.json[0].symbol === 'EN', 'language fixture symbol must be EN');

    assert(quote.json.price === 1, 'quote price must be 1');
    assert(quote.json.from.amount === 1, 'quote from amount must be 1');
    assert(quote.json.to.amount === 1, 'quote to amount must be 1');

    assert(swagger.json.info.title, 'swagger info.title must be present');
    assert(swagger.json.paths['/v1/asset'] !== undefined, 'swagger must contain /v1/asset');
    assert(swagger.json.paths['/v1/user'] === undefined, 'swagger must not contain /v1/user');
    assert(swagger.json.paths['/version'] !== undefined, 'swagger must contain /version');
    for (const prefix of PREFIXES) {
      assert(swagger.json.paths[prefix] !== undefined, `swagger must contain ${prefix}`);
    }
  } finally {
    await close(localBackend);
  }

  console.log('ok local-start');
}

main().catch((error) => {
  if (error.stack !== undefined) {
    fail(error.stack);
    return;
  }
  fail(String(error.message));
});
