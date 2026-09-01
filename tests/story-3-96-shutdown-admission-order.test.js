const assert = require('assert');

const { closeApplicationServices } = require('../lib/httpShutdown');

async function run() {
  const sequence = [];
  let completeHttp;
  let completeWorker;
  const server = {
    close(callback) { sequence.push('http_closed_to_new_requests'); completeHttp = callback; },
    closeIdleConnections() {},
    closeAllConnections() { throw new Error('graceful fixture must not force close'); }
  };
  const workerDrain = new Promise(resolve => { completeWorker = () => { sequence.push('worker_drained'); resolve(); }; });
  const shutdown = closeApplicationServices({
    server,
    operations: {
      production_worker: Promise.resolve().then(() => {
        sequence.push('worker_drain_started');
        return workerDrain;
      })
    },
    httpOptions: { timeoutMs: 1000 }
  });
  assert.strictEqual(sequence[0], 'http_closed_to_new_requests');
  await Promise.resolve();
  assert.deepStrictEqual(sequence.slice(0, 2), ['http_closed_to_new_requests', 'worker_drain_started']);
  completeWorker();
  completeHttp();
  assert.deepStrictEqual(await shutdown, {
    http: { drained: true, forced: false },
    components: { drained: true, failedComponents: [] },
    afterHttp: { drained: true, failedComponents: [] }
  });
  assert.deepStrictEqual(sequence, ['http_closed_to_new_requests', 'worker_drain_started', 'worker_drained']);

  console.log('Story 3.96 Shutdown Admission Order tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
