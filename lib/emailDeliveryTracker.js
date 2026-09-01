const { writeOperationalEvent } = require('./operationalLogger');

const DEFAULT_EMAIL_DRAIN_TIMEOUT_MS = 15 * 1000;

function boundedMilliseconds(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 60 * 1000 ? parsed : fallback;
}

function createEmailDeliveryTracker(options = {}) {
  const active = new Set();
  const logger = options.logger || writeOperationalEvent;
  const timeoutMs = boundedMilliseconds(options.timeoutMs, DEFAULT_EMAIL_DRAIN_TIMEOUT_MS);

  function track(operation, delivery) {
    const promise = Promise.resolve(delivery);
    active.add(promise);
    promise.finally(() => active.delete(promise)).catch(() => {});
    logger({ event: 'transactional_email_queued', operation, activeCount: active.size });
    return promise;
  }

  async function drain() {
    const pending = [...active];
    if (!pending.length) return { drained: true, pendingCount: 0 };
    let timeout;
    const settled = Promise.allSettled(pending).then(() => true);
    const expired = new Promise(resolve => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    });
    const drained = await Promise.race([settled, expired]);
    clearTimeout(timeout);
    logger({ event: 'transactional_email_drain_completed', drained, pendingCount: drained ? 0 : active.size });
    return { drained, pendingCount: drained ? 0 : active.size };
  }

  return { drain, track, activeCount: () => active.size };
}

const defaultEmailDeliveryTracker = createEmailDeliveryTracker();

module.exports = {
  DEFAULT_EMAIL_DRAIN_TIMEOUT_MS,
  createEmailDeliveryTracker,
  defaultEmailDeliveryTracker
};
