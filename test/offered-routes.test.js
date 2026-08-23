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
const { CACHE_PREFIXES, EXACT_GET_PATHS, isServedPath } = require('../server.js');

const PUBLIC_REPOS = new Set([
  'DFXswiss/services',
  'DFXswiss/packages',
  'DFXswiss/dfx-wallet',
  'RealUnitCH/app',
]);
const METHODS = new Set(['GET']);

function namesOf(row) {
  return [row.path].concat(Array.isArray(row.aliases) ? row.aliases : []);
}

function rowFor(method, urlPath, match) {
  return catalog.routes.find((row) => row.method === method && row.path === urlPath && row.match === match);
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
  for (const alias of row.aliases ?? []) {
    if (!isServedPath(alias)) fail('catalog alias is not served: ' + alias);
  }

  if (!Array.isArray(row.usedIn) || row.usedIn.length === 0) fail('usedIn missing: ' + key);
  if (!Array.isArray(row.e2e) || row.e2e.length === 0) fail('e2e missing: ' + key);

  for (const ref of row.usedIn.concat(row.e2e)) {
    if (!ref || typeof ref !== 'object') fail('bad pointer on ' + key);
    if (ref.unidentified === true) {
      if (typeof ref.note !== 'string' || !ref.note) fail('unidentified pointer needs note: ' + key);
      if (ref.repo !== undefined || ref.path !== undefined) fail('unidentified pointer must not set repo or path: ' + key);
      continue;
    }
    if (typeof ref.repo !== 'string' || !PUBLIC_REPOS.has(ref.repo)) {
      fail('repo must be a listed public consumer: ' + key + ': ' + (ref && ref.repo));
    }
    if (typeof ref.path !== 'string' || !ref.path) fail('bad pointer path on ' + key);
  }
}

const exactGetNames = new Set();
for (const row of catalog.routes) {
  if (row.method === 'GET' && row.match === 'exact') {
    for (const n of namesOf(row)) exactGetNames.add(n);
  }
}
for (const p of EXACT_GET_PATHS) {
  if (!exactGetNames.has(p)) fail('served GET path missing from exact catalog names: ' + p);
}
for (const p of CACHE_PREFIXES) {
  const row = rowFor('GET', p, 'exact');
  if (!row) fail('CACHE_PREFIX missing as exact row: ' + p);
  if (catalogCovers('GET', p + '/x')) fail('CACHE_PREFIX subpath must not be catalogued as served: ' + p + '/x');
}

const expectedKeys = new Set();
for (const p of CACHE_PREFIXES) expectedKeys.add('GET ' + p);
for (const p of ['/', '/version', '/swagger', '/swagger-json', '/v1/setting/infoBanner']) expectedKeys.add('GET ' + p);
for (const key of seen) {
  if (!expectedKeys.has(key)) fail('unexpected catalog row: ' + key);
}

if (isServedPath('/v1/user')) fail('isServedPath unexpectedly true for /v1/user');
if (catalogCovers('GET', '/v1/user')) fail('unserved /v1/user must not be in the catalog');

console.log('ok offered-routes.json', catalog.routes.length, 'rows');
