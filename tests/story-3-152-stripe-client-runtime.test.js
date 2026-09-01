const assert = require('assert');

process.env.STRIPE_KEY = '';
const {
  DEFAULT_STRIPE_NETWORK_RETRIES,
  DEFAULT_STRIPE_TIMEOUT_MS,
  MAX_STRIPE_NETWORK_RETRIES,
  MAX_STRIPE_TIMEOUT_MS,
  createStripeClient,
  resolveStripeClientConfig
} = require('../lib/stripe');

const defaults = resolveStripeClientConfig({});
assert.deepStrictEqual(defaults, {
  timeout: DEFAULT_STRIPE_TIMEOUT_MS,
  maxNetworkRetries: DEFAULT_STRIPE_NETWORK_RETRIES
});
assert.deepStrictEqual(resolveStripeClientConfig({
  STRIPE_API_TIMEOUT_MS: String(MAX_STRIPE_TIMEOUT_MS),
  STRIPE_API_MAX_NETWORK_RETRIES: String(MAX_STRIPE_NETWORK_RETRIES)
}), {
  timeout: MAX_STRIPE_TIMEOUT_MS,
  maxNetworkRetries: MAX_STRIPE_NETWORK_RETRIES
});
assert.deepStrictEqual(resolveStripeClientConfig({
  STRIPE_API_TIMEOUT_MS: String(MAX_STRIPE_TIMEOUT_MS + 1),
  STRIPE_API_MAX_NETWORK_RETRIES: String(MAX_STRIPE_NETWORK_RETRIES + 1)
}), defaults);
assert.strictEqual(resolveStripeClientConfig({ STRIPE_API_TIMEOUT_MS: '999' }).timeout, DEFAULT_STRIPE_TIMEOUT_MS);
assert.strictEqual(resolveStripeClientConfig({ STRIPE_API_MAX_NETWORK_RETRIES: '0' }).maxNetworkRetries, 0);

let constructorCall;
const client = createStripeClient('sk_test_local_only', {
  env: { STRIPE_API_TIMEOUT_MS: '25000', STRIPE_API_MAX_NETWORK_RETRIES: '2' },
  StripeApi(key, config) {
    constructorCall = { key, config };
    return { local: true };
  }
});
assert.deepStrictEqual(client, { local: true });
assert.deepStrictEqual(constructorCall, {
  key: 'sk_test_local_only',
  config: { timeout: 25000, maxNetworkRetries: 2 }
});
assert.strictEqual(createStripeClient('', { StripeApi() { throw new Error('must not initialize'); } }), null);

console.log('Story 3.152 Stripe Client Runtime tests passed');
