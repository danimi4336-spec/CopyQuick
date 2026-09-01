const assert = require('assert');
const {
  DEFAULT_EMAIL_ATTEMPT_TIMEOUT_MS,
  DEFAULT_EMAIL_MAX_ATTEMPTS,
  DEFAULT_EMAIL_RETRY_BASE_MS,
  DEFAULT_EMAIL_TOTAL_TIMEOUT_MS,
  EmailDeliveryError,
  MAX_EMAIL_ATTEMPT_TIMEOUT_MS,
  MAX_EMAIL_ATTEMPTS,
  MAX_EMAIL_RETRY_BASE_MS,
  MAX_EMAIL_TOTAL_TIMEOUT_MS,
  boundedPositiveInteger,
  normalizedEmailFailure,
  sendContactFormEmails,
  sendEmailWithRetry
} = require('../lib/email');

function contact() {
  return {
    name: 'Local Test', email: 'local@example.com', subject: 'Delivery test',
    message: 'A safe local test message.', ip: '127.0.0.1', userAgent: 'Test'
  };
}

async function run() {
  assert.strictEqual(boundedPositiveInteger('4', DEFAULT_EMAIL_MAX_ATTEMPTS, MAX_EMAIL_ATTEMPTS), 4);
  assert.strictEqual(boundedPositiveInteger('0', DEFAULT_EMAIL_MAX_ATTEMPTS, MAX_EMAIL_ATTEMPTS), DEFAULT_EMAIL_MAX_ATTEMPTS);
  assert.strictEqual(boundedPositiveInteger('-1', DEFAULT_EMAIL_MAX_ATTEMPTS, MAX_EMAIL_ATTEMPTS), DEFAULT_EMAIL_MAX_ATTEMPTS);
  assert.strictEqual(boundedPositiveInteger('invalid', DEFAULT_EMAIL_MAX_ATTEMPTS, MAX_EMAIL_ATTEMPTS), DEFAULT_EMAIL_MAX_ATTEMPTS);
  assert.strictEqual(boundedPositiveInteger(String(MAX_EMAIL_ATTEMPTS + 1), DEFAULT_EMAIL_MAX_ATTEMPTS, MAX_EMAIL_ATTEMPTS), DEFAULT_EMAIL_MAX_ATTEMPTS);
  assert.strictEqual(
    boundedPositiveInteger(MAX_EMAIL_TOTAL_TIMEOUT_MS + 1, DEFAULT_EMAIL_TOTAL_TIMEOUT_MS, MAX_EMAIL_TOTAL_TIMEOUT_MS),
    DEFAULT_EMAIL_TOTAL_TIMEOUT_MS
  );

  const unavailableLogs = [];
  await assert.rejects(
    () => sendContactFormEmails(contact(), { resendClient: null, logger: event => unavailableLogs.push(event) }),
    error => error instanceof EmailDeliveryError && error.code === 'EMAIL_PROVIDER_UNAVAILABLE'
  );
  assert.deepStrictEqual(unavailableLogs[0], {
    event: 'email_delivery_failed', operation: 'contact_admin', code: 'EMAIL_PROVIDER_UNAVAILABLE'
  });

  const retryCalls = [];
  const delays = [];
  const retryClient = { emails: { send: async (payload, options) => {
    retryCalls.push({ payload, options });
    if (retryCalls.length < 3) return { error: { name: 'rate_limit_exceeded', statusCode: 429 } };
    return { data: { id: 'provider-safe-id' } };
  } } };
  const retried = await sendEmailWithRetry({
    client: retryClient, payload: { subject: 'Safe' }, idempotencyKey: 'same-key', operation: 'contact_admin',
    maxAttempts: 3, retryBaseMs: 10, sleep: async milliseconds => delays.push(milliseconds), logger: () => {}
  });
  assert.strictEqual(retried.delivered, true);
  assert.strictEqual(retried.attemptCount, 3);
  assert.deepStrictEqual(retryCalls.map(call => call.options.idempotencyKey), ['same-key', 'same-key', 'same-key']);
  assert.deepStrictEqual(delays, [10, 20]);

  let permanentCalls = 0;
  await assert.rejects(() => sendEmailWithRetry({
    client: { emails: { send: async () => { permanentCalls += 1; return { error: { statusCode: 400, name: 'validation_error' } }; } } },
    payload: {}, idempotencyKey: 'permanent-key', operation: 'contact_admin', sleep: async () => {}, logger: () => {}
  }), error => error.code === 'EMAIL_PROVIDER_REJECTED');
  assert.strictEqual(permanentCalls, 1, 'permanent provider rejections must not be retried');

  let ambiguousCalls = 0;
  await assert.rejects(() => sendEmailWithRetry({
    client: { emails: { send: async () => { ambiguousCalls += 1; return undefined; } } },
    payload: {}, idempotencyKey: 'ambiguous-key', operation: 'contact_admin', maxAttempts: 2,
    retryBaseMs: 1, sleep: async () => {}, logger: () => {}
  }), error => error.code === 'EMAIL_PROVIDER_UNAVAILABLE');
  assert.strictEqual(ambiguousCalls, 2, 'an ambiguous provider response must never be treated as accepted delivery');

  const timeoutCalls = [];
  const timeoutDelays = [];
  const timeoutLogs = [];
  await assert.rejects(() => sendEmailWithRetry({
    client: { emails: { send: async (payload, options) => {
      timeoutCalls.push({ payload, options });
      return new Promise(() => {});
    } } },
    payload: { subject: 'Bounded attempt' }, idempotencyKey: 'timeout-key', operation: 'password_reset',
    maxAttempts: 2, retryBaseMs: 1, attemptTimeoutMs: 25,
    sleep: async milliseconds => timeoutDelays.push(milliseconds),
    setTimeoutFn: callback => { callback(); return 1; }, clearTimeoutFn: () => {},
    logger: event => timeoutLogs.push(event)
  }), error => error.code === 'EMAIL_PROVIDER_UNAVAILABLE');
  assert.strictEqual(timeoutCalls.length, 2, 'timed-out attempts should retry only within the configured bound');
  assert.deepStrictEqual(timeoutCalls.map(call => call.options.idempotencyKey), ['timeout-key', 'timeout-key']);
  assert.deepStrictEqual(timeoutDelays, [1]);
  assert.deepStrictEqual(timeoutLogs, [{
    event: 'email_delivery_failed', operation: 'password_reset', code: 'EMAIL_PROVIDER_UNAVAILABLE'
  }]);

  let boundedCalls = 0;
  const boundedDelays = [];
  const boundedTimeouts = [];
  await assert.rejects(() => sendEmailWithRetry({
    client: { emails: { send: async () => {
      boundedCalls += 1;
      return { error: { statusCode: 500, name: 'internal_server_error' } };
    } } },
    payload: {}, idempotencyKey: 'bounded-key', operation: 'password_reset',
    maxAttempts: MAX_EMAIL_ATTEMPTS + 1000,
    retryBaseMs: MAX_EMAIL_RETRY_BASE_MS + 1000,
    attemptTimeoutMs: MAX_EMAIL_ATTEMPT_TIMEOUT_MS + 1000,
    sleep: async milliseconds => boundedDelays.push(milliseconds),
    setTimeoutFn: (callback, milliseconds) => { boundedTimeouts.push(milliseconds); return 1; },
    clearTimeoutFn: () => {}, logger: () => {}
  }), error => error.code === 'EMAIL_PROVIDER_UNAVAILABLE');
  assert.strictEqual(boundedCalls, DEFAULT_EMAIL_MAX_ATTEMPTS, 'excessive attempt overrides must fall back to the safe default');
  assert.deepStrictEqual(boundedDelays, [DEFAULT_EMAIL_RETRY_BASE_MS, DEFAULT_EMAIL_RETRY_BASE_MS * 2]);
  assert.deepStrictEqual(boundedTimeouts, Array(DEFAULT_EMAIL_MAX_ATTEMPTS).fill(DEFAULT_EMAIL_ATTEMPT_TIMEOUT_MS));

  let budgetClock = 0;
  let budgetCalls = 0;
  const budgetDelays = [];
  const budgetTimeouts = [];
  await assert.rejects(() => sendEmailWithRetry({
    client: { emails: { send: async () => {
      budgetCalls += 1;
      budgetClock += 20;
      return { error: { statusCode: 500, name: 'internal_server_error' } };
    } } },
    payload: {}, idempotencyKey: 'total-budget-key', operation: 'password_reset',
    maxAttempts: 5, retryBaseMs: 10, attemptTimeoutMs: 50, totalTimeoutMs: 25,
    sleep: async milliseconds => { budgetDelays.push(milliseconds); budgetClock += milliseconds; },
    setTimeoutFn: (_callback, milliseconds) => { budgetTimeouts.push(milliseconds); return 1; },
    clearTimeoutFn: () => {}, now: () => budgetClock, logger: () => {}
  }), error => error.code === 'EMAIL_PROVIDER_UNAVAILABLE');
  assert.strictEqual(budgetCalls, 1, 'a retry must not begin when its backoff would exceed the total delivery budget');
  assert.deepStrictEqual(budgetDelays, []);
  assert.deepStrictEqual(budgetTimeouts, [25], 'each attempt timeout must be capped by the remaining total budget');

  const sent = [];
  const partialLogs = [];
  const partial = await sendContactFormEmails(contact(), {
    resendClient: { emails: { send: async (payload, options) => {
      sent.push({ payload, options });
      if (sent.length === 1) return { data: { id: 'admin-id' } };
      return { error: { statusCode: 500, name: 'internal_server_error', message: 'private provider detail' } };
    } } },
    operationKeyFactory: () => 'operation-key', maxAttempts: 2, retryBaseMs: 1,
    sleep: async () => {}, logger: event => partialLogs.push(event)
  });
  assert.strictEqual(partial.adminDelivered, true);
  assert.strictEqual(partial.autoReplyDelivered, false);
  assert.deepStrictEqual(sent.map(call => call.options.idempotencyKey), [
    'operation-key:admin', 'operation-key:reply', 'operation-key:reply'
  ]);
  assert(partialLogs.some(event => event.event === 'email_delivery_completed' && event.operation === 'contact_admin'));
  assert(partialLogs.some(event => event.event === 'email_delivery_failed' && event.operation === 'contact_reply'));
  assert(!JSON.stringify(partialLogs).includes('private provider detail'));

  assert.deepStrictEqual(normalizedEmailFailure({ statusCode: 429 }), { code: 'EMAIL_RATE_LIMITED', retryable: true });
  assert.deepStrictEqual(normalizedEmailFailure({ statusCode: 400 }), { code: 'EMAIL_PROVIDER_REJECTED', retryable: false });
  assert.deepStrictEqual(normalizedEmailFailure(new Error('private')), { code: 'EMAIL_PROVIDER_UNAVAILABLE', retryable: true });

  console.log('Story 3.29 Email Delivery Integrity tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
