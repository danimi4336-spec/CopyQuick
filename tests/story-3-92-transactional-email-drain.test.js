const assert = require('assert');

const { createEmailDeliveryTracker } = require('../lib/emailDeliveryTracker');

async function run() {
  const events = [];
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const tracker = createEmailDeliveryTracker({ timeoutMs: 100, logger: event => events.push(event) });
  const delivery = tracker.track('password_reset', pending);
  assert.strictEqual(tracker.activeCount(), 1);
  const draining = tracker.drain();
  complete({ delivered: true });
  assert.deepStrictEqual(await draining, { drained: true, pendingCount: 0 });
  await delivery;
  assert.strictEqual(tracker.activeCount(), 0);
  assert(events.some(event => event.event === 'transactional_email_queued' && event.operation === 'password_reset'));
  assert(events.some(event => event.event === 'transactional_email_drain_completed' && event.drained === true));
  assert.doesNotMatch(JSON.stringify(events), /@|reset-password\?token|api[_-]?key/i);

  const blocked = createEmailDeliveryTracker({ timeoutMs: 5, logger: () => {} });
  blocked.track('password_reset', new Promise(() => {}));
  assert.deepStrictEqual(await blocked.drain(), { drained: false, pendingCount: 1 });

  const rejected = createEmailDeliveryTracker({ timeoutMs: 100, logger: () => {} });
  await assert.rejects(rejected.track('password_reset', Promise.reject(new Error('provider unavailable'))));
  assert.strictEqual(rejected.activeCount(), 0);

  console.log('Story 3.92 Transactional Email Drain tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
