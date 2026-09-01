const assert = require('assert');

const { DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS, closeHttpServer, shutdownTimeoutMs } = require('../lib/httpShutdown');

async function run() {
  assert.strictEqual(shutdownTimeoutMs('1000'), 1000);
  assert.strictEqual(shutdownTimeoutMs('120000'), 120000);
  assert.strictEqual(shutdownTimeoutMs('999'), DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS);
  assert.strictEqual(shutdownTimeoutMs('invalid'), DEFAULT_HTTP_SHUTDOWN_TIMEOUT_MS);

  let callback;
  let idleClosed = 0;
  const graceful = {
    close(fn) { callback = fn; },
    closeIdleConnections() { idleClosed += 1; },
    closeAllConnections() { throw new Error('must not force a graceful shutdown'); }
  };
  const gracefulClose = closeHttpServer(graceful, { timeoutMs: 1000 });
  callback();
  assert.deepStrictEqual(await gracefulClose, { drained: true, forced: false });
  assert.strictEqual(idleClosed, 1);

  let forced = 0;
  let timeoutCallback;
  const stuck = {
    close() {}, closeIdleConnections() {}, closeAllConnections() { forced += 1; }
  };
  const forcedClose = closeHttpServer(stuck, {
    timeoutMs: 1000,
    setTimeoutFn(fn) { timeoutCallback = fn; return 7; },
    clearTimeoutFn() {}
  });
  timeoutCallback();
  assert.deepStrictEqual(await forcedClose, { drained: false, forced: true });
  assert.strictEqual(forced, 1);
  assert.deepStrictEqual(await closeHttpServer(null), { drained: true, forced: false });

  console.log('Story 3.94 Bounded HTTP Shutdown tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
