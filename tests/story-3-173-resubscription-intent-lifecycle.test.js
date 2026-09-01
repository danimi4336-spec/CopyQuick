const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const {
  acquireSubscriptionCheckoutIntent,
  canReplaceCompletedCheckoutIntent,
  clearSubscriptionCheckoutIntents
} = require('../lib/subscriptionCheckoutIntent');

const db = new Database(':memory:');
try {
  runMigrationEngine(db, { logger: () => {} });
  db.prepare("INSERT INTO users(id,email,name) VALUES (173,'resubscribe@example.com','Resubscribe')").run();
  const now = new Date('2026-09-01T00:00:00.000Z');
  acquireSubscriptionCheckoutIntent(db, { userId: 173, planTier: 'pro', priceId: 'price_pro', now, randomUUID: () => 'intent-pro' });
  acquireSubscriptionCheckoutIntent(db, { userId: 173, planTier: 'unlimited', priceId: 'price_unlimited', now, randomUUID: () => 'intent-unlimited' });

  assert.strictEqual(clearSubscriptionCheckoutIntents(db, { userId: 173, planTier: 'pro' }), 1);
  assert.deepStrictEqual(db.prepare('SELECT plan_tier FROM subscription_checkout_intents ORDER BY plan_tier').all(), [{ plan_tier: 'unlimited' }]);
  assert.strictEqual(clearSubscriptionCheckoutIntents(db, { userId: 173, planTier: 'pro' }), 0, 'cleanup is idempotent');
  assert.strictEqual(clearSubscriptionCheckoutIntents(db, { userId: 173 }), 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM subscription_checkout_intents').get().count, 0);
  assert.throws(() => clearSubscriptionCheckoutIntents(db, { userId: 173, planTier: 'free' }), /invalid/);

  for (const [status, replaceable] of [
    ['active', false], ['trialing', false], ['past_due', false], ['unpaid', false],
    ['paused', false], ['canceled', true], ['incomplete_expired', true]
  ]) {
    db.prepare('DELETE FROM subscriptions WHERE user_id = 173').run();
    db.prepare(`
      INSERT INTO subscriptions(
        user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
        price_id, current_period_start, current_period_end
      ) VALUES (173, 'cus_resubscribe', 'sub_resubscribe', ?, 'pro', 'price_pro', ?, ?)
    `).run(status, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    assert.strictEqual(canReplaceCompletedCheckoutIntent(db, {
      userId: 173, stripeSubscriptionId: 'sub_resubscribe'
    }), replaceable, status);
  }
  assert.strictEqual(canReplaceCompletedCheckoutIntent(db, { userId: 173, stripeSubscriptionId: 'sub_other' }), false);
  assert.strictEqual(canReplaceCompletedCheckoutIntent(db, { userId: 999, stripeSubscriptionId: 'sub_resubscribe' }), false);

  console.log('Story 3.173 Resubscription Checkout Intent Lifecycle tests passed');
} finally {
  db.close();
}
