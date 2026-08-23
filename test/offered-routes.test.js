'use strict';

const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const catalogPath = path.join(repoRoot, 'offered-routes.json');
if (!fs.existsSync(catalogPath)) fail('missing offered-routes.json');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (!Array.isArray(catalog.routes) || catalog.routes.length === 0) fail('catalog.routes must be a non-empty array');

process.env.BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:9';
const { CACHE_PREFIXES, RAM_GET_PATHS, isServedPath } = require('../server.js');

const PRIVATE_NAME = /DFXswiss\/backend|DFXswiss\/api\b|DFXswiss\/intern|DFXServer\/|TaprootFreak|m5me|m5Air|dfxserve/i;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const METHODS = new Set(['GET', 'PUT', 'POST', 'HEAD', 'DELETE']);

function namesOf(row) {
  return [row.path].concat(Array.isArray(row.aliases) ? row.aliases : []);
}

function catalogCovers(method, urlPath) {
  return catalog.routes.some((row) => {
    if (row.method !== method) return false;
    const names = namesOf(row);
    if (row.match === 'prefix') {
      return names.some((n) => urlPath === n || urlPath.startsWith(n + '/'));
    }
    return names.includes(urlPath);
  });
}

const seen = new Set();
for (const row of catalog.routes) {
  if (!METHODS.has(row.method)) fail('bad method: ' + row.method);
  if (typeof row.path !== 'string' || !row.path.startsWith('/')) fail('bad path: ' + row.path);
  if (row.match !== 'exact' && row.match !== 'prefix') fail('bad match for ' + row.path);
  const key = row.method + ' ' + row.path;
  if (seen.has(key)) fail('duplicate catalog row: ' + key);
  seen.add(key);

  if (!isServedPath(row.path)) fail('catalog path is not served: ' + row.path);
  for (const alias of row.aliases || []) {
    if (!isServedPath(alias)) fail('catalog alias is not served: ' + alias);
  }

  if (!Array.isArray(row.usedIn) || row.usedIn.length === 0) fail('usedIn missing: ' + key);
  if (!Array.isArray(row.e2e) || row.e2e.length === 0) fail('e2e missing: ' + key);

  for (const ref of row.usedIn.concat(row.e2e)) {
    if (!ref || typeof ref.repo !== 'string' || !REPO.test(ref.repo)) fail('bad repo on ' + key + ': ' + (ref && ref.repo));
    if (typeof ref.path !== 'string' || !ref.path) fail('bad pointer path on ' + key);
    const blob = JSON.stringify(ref);
    if (PRIVATE_NAME.test(blob) || PRIVATE_NAME.test(ref.repo) || PRIVATE_NAME.test(ref.path)) {
      fail('private or internal name in catalog pointer: ' + key);
    }
  }
}

const exactGet = [
  '/',
  '/version',
  '/swagger',
  '/swagger/',
  '/swagger-json',
  '/swagger-json/',
  '/swagger-ui',
  '/swagger-ui/',
];
const exactPut = ['/v1/buy/quote', '/v1/sell/quote', '/v1/swap/quote'];

for (const p of exactGet) {
  if (!catalogCovers('GET', p)) fail('served GET path missing from catalog: ' + p);
}
for (const p of exactPut) {
  if (!catalogCovers('PUT', p)) fail('served PUT path missing from catalog: ' + p);
}
for (const p of RAM_GET_PATHS) {
  if (!catalogCovers('GET', p)) fail('RAM GET path missing from catalog: ' + p);
}
for (const p of CACHE_PREFIXES) {
  if (!catalogCovers('GET', p)) fail('CACHE_PREFIX missing from catalog: ' + p);
  if (!catalogCovers('GET', p + '/x')) fail('CACHE_PREFIX subpath missing from catalog: ' + p + '/x');
}

if (isServedPath('/v1/user')) fail('isServedPath unexpectedly true for /v1/user');
if (catalogCovers('GET', '/v1/user')) fail('proxied /v1/user must not be in the catalog');

const catalogText = fs.readFileSync(catalogPath, 'utf8');
if (PRIVATE_NAME.test(catalogText)) fail('private or internal name in offered-routes.json');

console.log('ok offered-routes.json', catalog.routes.length, 'rows');
