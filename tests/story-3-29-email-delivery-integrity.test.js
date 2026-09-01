const assert = require('assert');
const {
  EmailDeliveryError,
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
