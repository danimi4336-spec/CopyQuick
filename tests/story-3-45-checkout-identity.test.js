const assert = require('assert');
const { parseUserReference, resolveCheckoutUser } = require('../lib/checkoutIdentity');

const users = new Map([
  [45, { id: 45, email: 'bound@example.com' }],
  [46, { id: 46, email: 'legacy@example.com' }]
]);
const checkoutIntents = new Set(['46:cs_legacy_46']);
const db = {
  prepare(sql) {
    return {
      get(...values) {
        if (/subscription_checkout_intents/.test(sql)) {
          return checkoutIntents.has(`${values[0]}:${values[1]}`) ? { 1: 1 } : undefined;
        }
        const value = values[0];
        if (/WHERE id/.test(sql)) return users.get(value);
        return Array.from(users.values()).find(user => user.email === value);
      }
    };
  }
};

assert.strictEqual(parseUserReference('45'), 45);
for (const invalid of [45, '0', '-1', '01', 'abc', String(Number.MAX_SAFE_INTEGER + 1)]) {
  assert.strictEqual(parseUserReference(invalid), null);
}

let resolved = resolveCheckoutUser(db, {
  client_reference_id: '45',
  metadata: { copyquick_user_id: '45' },
  customer_email: 'legacy@example.com'
});
assert.strictEqual(resolved.valid, true);
assert.strictEqual(resolved.legacy, false);
assert.strictEqual(resolved.user.id, 45, 'bound user identity must win over mutable email');

resolved = resolveCheckoutUser(db, {
  client_reference_id: '45',
  metadata: { copyquick_user_id: '46' },
  customer_email: 'bound@example.com'
});
assert.strictEqual(resolved.valid, false);
assert.strictEqual(resolved.user, null);

resolved = resolveCheckoutUser(db, {
  id: 'cs_legacy_46',
  customer_email: ' LEGACY@EXAMPLE.COM '
});
assert.strictEqual(resolved.valid, true);
assert.strictEqual(resolved.legacy, true);
assert.strictEqual(resolved.user.id, 46);

for (const session of [
  { id: 'cs_unrecorded_46', customer_email: 'legacy@example.com' },
  { customer_email: 'legacy@example.com' },
  { id: 'cs_legacy_46', customer_email: 'unknown@example.com' }
]) {
  resolved = resolveCheckoutUser(db, session);
  assert.strictEqual(resolved.valid, false,
    'legacy email identity must be bound to an exact durable Checkout intent');
  assert.strictEqual(resolved.user, null);
}

const stripeSource = require('fs').readFileSync(require.resolve('../lib/stripe'), 'utf8');
assert.match(stripeSource, /client_reference_id: userReference/);
assert.match(stripeSource, /subscription_data: \{ metadata: \{ copyquick_user_id: userReference \} \}/);
console.log('Story 3.45 checkout identity tests passed');
