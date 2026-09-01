const assert = require('assert');
const { getTrustedStripeRedirect } = require('../lib/stripeRedirect');

assert.strictEqual(
  getTrustedStripeRedirect('https://checkout.stripe.com/c/pay/test?prefilled=true', 'checkout'),
  'https://checkout.stripe.com/c/pay/test?prefilled=true'
);
assert.strictEqual(
  getTrustedStripeRedirect('https://billing.stripe.com/p/session/test', 'portal'),
  'https://billing.stripe.com/p/session/test'
);

for (const unsafe of [
  '/relative',
  'http://checkout.stripe.com/c/pay/test',
  'https://checkout.stripe.com.evil.example/test',
  'https://evil.example/test',
  'javascript:alert(1)',
  'https://user:secret@checkout.stripe.com/test',
  'https://checkout.stripe.com:444/test'
]) {
  assert.strictEqual(getTrustedStripeRedirect(unsafe, 'checkout'), null);
}
assert.strictEqual(getTrustedStripeRedirect('https://checkout.stripe.com/test', 'portal'), null);
assert.strictEqual(getTrustedStripeRedirect('https://billing.stripe.com/test', 'checkout'), null);
console.log('Story 3.46 trusted Stripe redirect tests passed');
