const assert = require('assert');
const { drainShutdownOperations } = require('../lib/httpShutdown');

async function run() {
  const events = [];
  const result = await drainShutdownOperations({
    production_worker: Promise.resolve({ drained: false }),
    scheduler: Promise.resolve({ drained: true }),
    watcher: Promise.resolve(undefined)
  }, event => events.push(event));

  assert.deepStrictEqual(result, {
    drained: false,
    failedComponents: ['production_worker']
  });
  assert.deepStrictEqual(events, [{
    event: 'shutdown_component_failed',
    component: 'production_worker',
    code: 'SHUTDOWN_DRAIN_FAILED'
  }]);

  console.log('Story 3.193 Truthful Component Drain tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
