'use strict';

const DEFAULT_FRONT_PORT = '3000';
const DEFAULT_FRONT_BIND = '127.0.0.1';
const DEFAULT_BACKEND_PORT = 3004;

function orFallback(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

function shouldStartLocalBackend(env) {
  return env.BACKEND_URL === undefined || env.BACKEND_URL === null || env.BACKEND_URL === '';
}

function applyLocalDefaults(env) {
  env.BIND = orFallback(env.BIND, DEFAULT_FRONT_BIND);
  env.PORT = orFallback(env.PORT, DEFAULT_FRONT_PORT);
  return env;
}

if (require.main === module) {
  applyLocalDefaults(process.env);

  let localBackend;

  function startFrontApi() {
    // Load production code only after BACKEND_URL is available.
    const server = require('../server.js');

    function shutdown() {
      server.server.close(() => {
        if (localBackend === undefined) {
          process.exit(0);
          return;
        }
        localBackend.close(() => process.exit(0));
      });
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Match the ordering used by the server.js main entry point.
    if (process.env.FRONT_API_EXIT_AFTER_BOOT === '1') server.maybeExitAfterBoot();
    server.boot();
  }

  if (!shouldStartLocalBackend(process.env)) {
    startFrontApi();
  } else {
    const { createLocalBackend } = require('./local-backend.js');
    const configuredPort = orFallback(process.env.LOCAL_BACKEND_PORT, DEFAULT_BACKEND_PORT);
    const port = Number(configuredPort);
    localBackend = createLocalBackend();

    localBackend.on('error', (error) => {
      console.error(error);
      process.exit(1);
    });
    localBackend.listen(port, '127.0.0.1', () => {
      const boundPort = localBackend.address().port;
      process.env.BACKEND_URL = `http://127.0.0.1:${boundPort}`;
      console.log(`local backend http://127.0.0.1:${boundPort}`);
      startFrontApi();
    });
  }
}

module.exports = {
  DEFAULT_FRONT_PORT,
  DEFAULT_FRONT_BIND,
  DEFAULT_BACKEND_PORT,
  shouldStartLocalBackend,
  applyLocalDefaults,
};
