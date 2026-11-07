'use strict';

const Module = require('module');
const orig = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'pg') throw new Error('pg missing');
  return orig.call(this, request, parent, isMain);
};
