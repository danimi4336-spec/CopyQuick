const assert = require('assert');

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { validateProductionBillingConfig } = require('../lib/stripe');
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;

const valid = {
  NODE_ENV: 'production',
  STRIPE_KEY: 'sk_live_not_a_real_secret',
  STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
  STRIPE_PRO_PRICE: 'price_pro_config',
  STRIPE_UNLIMITED_PRICE: 'price_unlimited_config'
};

assert.deepStrictEqual(validateProductionBillingConfig(valid), { enabled: true });
assert.deepStrictEqual(validateProductionBillingConfig({ NODE_ENV: 'development' }), { enabled: false });
assert.deepStrictEqual(validateProductionBillingConfig({ NODE_ENV: 'development', STRIPE_KEY: 'local' }), { enabled: true });

for (const [override, expected] of [
  [{ STRIPE_KEY: '' }, /STRIPE_KEY/],
  [{ STRIPE_WEBHOOK_SECRET: '' }, /STRIPE_WEBHOOK_SECRET/],
  [{ STRIPE_WEBHOOK_SECRET: 'secret_without_prefix' }, /STRIPE_WEBHOOK_SECRET/],
  [{ STRIPE_PRO_PRICE: '' }, /STRIPE_PRO_PRICE/],
  [{ STRIPE_PRO_PRICE: 'prod_not_a_price' }, /STRIPE_PRO_PRICE/],
  [{ STRIPE_UNLIMITED_PRICE: '' }, /STRIPE_UNLIMITED_PRICE/],
  [{ STRIPE_UNLIMITED_PRICE: 'price bad' }, /STRIPE_UNLIMITED_PRICE/],
  [{ STRIPE_UNLIMITED_PRICE: valid.STRIPE_PRO_PRICE }, /must be distinct/]
]) {
  const env = { ...valid, ...override };
  assert.throws(() => validateProductionBillingConfig(env), error => {
    assert.match(error.message, expected);
    assert.doesNotMatch(error.message, /sk_live_not_a_real_secret|whsec_not_a_real_secret|price_pro_config/);
    return true;
  });
}

console.log('Story 3.168 Stripe Billing Configuration Gate tests passed');
