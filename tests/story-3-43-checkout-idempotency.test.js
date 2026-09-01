const assert = require('assert');
const { issueCheckoutKeys, validateCheckoutKey } = require('../lib/checkoutIdempotency');
const session = {};
let index = 0;
const uuids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const keys = issueCheckoutKeys(session, { now: 1000, randomUUID: () => uuids[index++] });
assert.strictEqual(validateCheckoutKey(session, keys.pro, 'pro', { now: 1001 }), true);
assert.strictEqual(validateCheckoutKey(session, keys.pro, 'unlimited', { now: 1001 }), false);
assert.strictEqual(validateCheckoutKey(session, 'not-a-uuid', 'pro', { now: 1001 }), false);
assert.strictEqual(validateCheckoutKey(session, keys.pro, 'pro', { now: 3601001 }), false);

let nextUuid = 3;
issueCheckoutKeys(session, {
  now: 2000,
  randomUUID: () => `${String(nextUuid++).padStart(8, '0')}-0000-4000-8000-000000000000`
});
assert.strictEqual(validateCheckoutKey(session, keys.pro, 'pro', { now: 2001 }), true, 'opening another pricing tab must not invalidate an active checkout form');
for (let run = 0; run < 10; run += 1) {
  issueCheckoutKeys(session, {
    now: 3000 + run,
    randomUUID: () => `${String(nextUuid++).padStart(8, '0')}-0000-4000-8000-000000000000`
  });
}
assert(session.checkoutKeys.length <= 10, 'session checkout-key retention must remain bounded');
const pricing = require('fs').readFileSync(require.resolve('../views/pricing.ejs'), 'utf8');
const stripe = require('fs').readFileSync(require.resolve('../lib/stripe'), 'utf8');
assert.match(pricing, /name="checkoutKey"/);
assert.match(stripe, /\}, \{ idempotencyKey \}\)/);
console.log('Story 3.43 checkout idempotency tests passed');
