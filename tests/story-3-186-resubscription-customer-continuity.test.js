const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const {
  canStartSubscriptionCheckout,
  resolveSubscriptionCheckoutPolicy
} = require('../lib/subscriptionCheckoutPolicy');

function insertSubscription(db, {
  userId,
  customerId,
  subscriptionId,
  status = 'canceled'
}) {
  db.prepare(`
    INSERT INTO subscriptions(
      user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
      price_id, current_period_start, current_period_end
    ) VALUES (?, ?, ?, ?, 'pro', 'price_pro', ?, ?)
  `).run(
    userId,
    customerId,
    subscriptionId,
    status,
    '2026-08-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z'
  );
}

function run() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    runMigrationEngine(db, { logger: () => {} });
    db.prepare(`
      INSERT INTO users(id, email, name, plan_tier, stripe_customer_id)
      VALUES (186, 'returning@example.com', 'Returning', 'free', 'cus_returning_186')
    `).run();
    const user = { id: 186, plan_tier: 'free' };

    assert.deepStrictEqual(resolveSubscriptionCheckoutPolicy(user, db), {
      allowed: true,
      customerId: null
    }, 'a brand-new subscriber should let Stripe create the initial customer');

    insertSubscription(db, {
      userId: 186,
      customerId: 'cus_returning_186',
      subscriptionId: 'sub_canceled_186'
    });
    assert.deepStrictEqual(resolveSubscriptionCheckoutPolicy(user, db), {
      allowed: true,
      customerId: 'cus_returning_186'
    }, 'terminal history should reuse the exclusively owned customer');

    insertSubscription(db, {
      userId: 186,
      customerId: 'cus_returning_186',
      subscriptionId: 'sub_expired_186',
      status: 'incomplete_expired'
    });
    assert.strictEqual(canStartSubscriptionCheckout(user, db), true,
      'multiple terminal subscriptions for one customer remain replaceable');

    db.prepare("UPDATE subscriptions SET status='active' WHERE stripe_subscription_id='sub_expired_186'").run();
    assert.strictEqual(canStartSubscriptionCheckout(user, db), false,
      'any nonterminal subscription must block a new checkout');
    db.prepare("UPDATE subscriptions SET status='incomplete_expired' WHERE stripe_subscription_id='sub_expired_186'").run();

    db.prepare("UPDATE subscriptions SET stripe_customer_id='cus_mismatched_186' WHERE stripe_subscription_id='sub_expired_186'").run();
    assert.strictEqual(canStartSubscriptionCheckout(user, db), false,
      'mixed customer history must not be guessed');
    db.prepare("UPDATE subscriptions SET stripe_customer_id='cus_returning_186' WHERE stripe_subscription_id='sub_expired_186'").run();

    db.prepare("UPDATE users SET stripe_customer_id='cus_different_cached_186' WHERE id=186").run();
    assert.strictEqual(canStartSubscriptionCheckout(user, db), false,
      'subscription history must agree with the cached authoritative customer');
    db.prepare("UPDATE users SET stripe_customer_id='cus_returning_186' WHERE id=186").run();

    db.prepare(`
      INSERT INTO users(id, email, name, plan_tier, stripe_customer_id)
      VALUES (187, 'conflict@example.com', 'Conflict', 'free', 'cus_returning_186')
    `).run();
    assert.strictEqual(canStartSubscriptionCheckout(user, db), false,
      'a customer claimed by another user must not be reused');

    console.log('Story 3.186 Resubscription Customer Continuity tests passed');
  } finally {
    db.close();
  }
}

run();
