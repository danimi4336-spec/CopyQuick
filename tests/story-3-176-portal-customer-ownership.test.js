const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { resolveOwnedPortalCustomerId } = require('../lib/billingPortalAccess');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrationEngine(db, { logger: () => {} });
db.prepare("INSERT INTO users(id,email,name,plan_tier,monthly_limit,stripe_customer_id) VALUES (176,'portal@example.com','Portal','pro',200,'cus_story_3176')").run();
const user = db.prepare('SELECT * FROM users WHERE id=176').get();

assert.strictEqual(resolveOwnedPortalCustomerId(db, user), null, 'a cached customer ID alone must not grant portal access');
db.prepare(`
  INSERT INTO subscriptions(
    user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
    price_id, current_period_start, current_period_end
  ) VALUES (176, 'cus_story_3176', 'sub_story_3176', 'active', 'pro', 'price_pro', ?, ?)
`).run('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
assert.strictEqual(resolveOwnedPortalCustomerId(db, user), 'cus_story_3176');
assert.strictEqual(resolveOwnedPortalCustomerId(db, { ...user, stripe_customer_id: 'cus_other_3176' }), null);
assert.strictEqual(resolveOwnedPortalCustomerId(db, { ...user, stripe_customer_id: 'invalid' }), null);
assert.strictEqual(resolveOwnedPortalCustomerId(db, { ...user, id: 177 }), null);

db.prepare(`
  INSERT INTO subscriptions(
    user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
    price_id, current_period_start, current_period_end
  ) VALUES (176, 'cus_conflict_3176', 'sub_conflict_3176', 'canceled', 'free', 'price_pro', ?, ?)
`).run('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
assert.strictEqual(resolveOwnedPortalCustomerId(db, user), null, 'conflicting local customer relationships must fail closed');

db.close();
console.log('Story 3.176 Portal Customer Ownership tests passed');
