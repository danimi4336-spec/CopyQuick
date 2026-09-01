const assert = require('assert');

const { drainShutdownOperations } = require('../lib/httpShutdown');

async function run() {
  let completed = 0;
  const events = [];
  const result = await drainShutdownOperations({
    production_worker: Promise.resolve().then(() => { completed += 1; }),
    backup_scheduler: Promise.reject(Object.assign(new Error('secret-bearing failure'), { code: 'PRIVATE_FAILURE' })),
    email_delivery: Promise.resolve().then(() => { completed += 1; })
  }, event => events.push(event));
  assert.strictEqual(completed, 2, 'one failed component must not prevent other drains');
  assert.deepStrictEqual(result, { drained: false, failedComponents: ['backup_scheduler'] });
  assert.strictEqual(events.length, 1);
  assert.deepStrictEqual(events[0], {
    event: 'shutdown_component_failed', component: 'backup_scheduler', code: 'SHUTDOWN_DRAIN_FAILED'
  });
  assert.doesNotMatch(JSON.stringify(events), /secret-bearing|PRIVATE_FAILURE/);

  assert.deepStrictEqual(await drainShutdownOperations({ worker: Promise.resolve() }), {
    drained: true, failedComponents: []
  });
  console.log('Story 3.95 Shutdown Failure Isolation tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
