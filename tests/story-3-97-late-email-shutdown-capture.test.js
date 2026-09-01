const assert = require('assert');

const { createEmailDeliveryTracker } = require('../lib/emailDeliveryTracker');
const { closeApplicationServices } = require('../lib/httpShutdown');

async function run() {
  const sequence = [];
  let finishRequest;
  let finishEmail;
  const tracker = createEmailDeliveryTracker({ timeoutMs: 1000, logger: () => {} });
  const server = {
    close(callback) { finishRequest = callback; sequence.push('admission_closed'); },
    closeIdleConnections() {}, closeAllConnections() {}
  };
  const shutdown = closeApplicationServices({
    server,
    operations: { worker: Promise.resolve() },
    afterHttpOperations: () => {
      sequence.push('email_drain_started');
      return { transactional_email: tracker.drain() };
    },
    httpOptions: { timeoutMs: 1000 }
  });

  // Simulate an in-flight request enqueueing email after shutdown begins but
  // before the HTTP server reports that all active requests are complete.
  const delivery = new Promise(resolve => { finishEmail = resolve; });
  tracker.track('password_reset', delivery);
  assert.strictEqual(sequence.includes('email_drain_started'), false);
  finishRequest();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(sequence.includes('email_drain_started'), true);
  let shutdownFinished = false;
  shutdown.then(() => { shutdownFinished = true; });
  await Promise.resolve();
  assert.strictEqual(shutdownFinished, false, 'late email must keep shutdown draining');
  finishEmail();
  const result = await shutdown;
  assert.strictEqual(result.afterHttp.drained, true);
  assert.strictEqual(tracker.activeCount(), 0);

  console.log('Story 3.97 Late Email Shutdown Capture tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
