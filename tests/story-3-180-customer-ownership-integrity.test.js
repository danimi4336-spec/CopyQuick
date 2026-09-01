const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { isStripeCustomerExclusivelyOwned } = require('../lib/billingCustomerOwnership');
const { resolveOwnedPortalCustomerId } = require('../lib/billingPortalAccess');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrationEngine(db, { logger: () => {} });
db.prepare("INSERT INTO users(id,email,name,plan_tier,monthly_limit,stripe_customer_id) VALUES (180,'one@example.com','One','pro',200,'cus_shared_180')").run();
db.prepare(`
  INSERT INTO subscriptions(
    user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
    price_id, current_period_start, current_period_end
  ) VALUES (180, 'cus_shared_180', 'sub_one_180', 'active', 'pro', 'price_pro', ?, ?)
`).run('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
const owner = db.prepare('SELECT * FROM users WHERE id=180').get();
assert.strictEqual(isStripeCustomerExclusivelyOwned(db, { userId: 180, customerId: 'cus_shared_180' }), true);
assert.strictEqual(resolveOwnedPortalCustomerId(db, owner), 'cus_shared_180');

db.prepare("INSERT INTO users(id,email,name,stripe_customer_id) VALUES (181,'two@example.com','Two','cus_shared_180')").run();
assert.strictEqual(isStripeCustomerExclusivelyOwned(db, { userId: 180, customerId: 'cus_shared_180' }), false);
assert.strictEqual(isStripeCustomerExclusivelyOwned(db, { userId: 181, customerId: 'cus_shared_180' }), false);
assert.strictEqual(resolveOwnedPortalCustomerId(db, owner), null, 'a globally shared customer must not open either account portal');

db.prepare("UPDATE users SET stripe_customer_id=NULL WHERE id=181").run();
db.prepare(`
  INSERT INTO subscriptions(
    user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
    price_id, current_period_start, current_period_end
  ) VALUES (181, 'cus_shared_180', 'sub_two_180', 'canceled', 'free', 'price_pro', ?, ?)
`).run('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
assert.strictEqual(isStripeCustomerExclusivelyOwned(db, { userId: 180, customerId: 'cus_shared_180' }), false,
  'subscription history owned by another user must also make the customer ambiguous');
assert.strictEqual(isStripeCustomerExclusivelyOwned(db, { userId: 180, customerId: 'invalid' }), false);

db.close();
console.log('Story 3.180 Stripe Customer Ownership Integrity tests passed');
