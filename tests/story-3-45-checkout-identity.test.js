const assert = require('assert');
const { parseUserReference, resolveCheckoutUser } = require('../lib/checkoutIdentity');

const users = new Map([
  [45, { id: 45, email: 'bound@example.com' }],
  [46, { id: 46, email: 'legacy@example.com' }]
]);
const db = {
  prepare(sql) {
    return {
      get(value) {
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

resolved = resolveCheckoutUser(db, { customer_email: ' LEGACY@EXAMPLE.COM ' });
assert.strictEqual(resolved.valid, true);
assert.strictEqual(resolved.legacy, true);
assert.strictEqual(resolved.user.id, 46);

const stripeSource = require('fs').readFileSync(require.resolve('../lib/stripe'), 'utf8');
assert.match(stripeSource, /client_reference_id: userReference/);
assert.match(stripeSource, /subscription_data: \{ metadata: \{ copyquick_user_id: userReference \} \}/);
console.log('Story 3.45 checkout identity tests passed');
