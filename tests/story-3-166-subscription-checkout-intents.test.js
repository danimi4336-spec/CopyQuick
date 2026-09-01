const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const {
  CHECKOUT_INTENT_TTL_MS,
  acquireSubscriptionCheckoutIntent,
  recordSubscriptionCheckoutSession
} = require('../lib/subscriptionCheckoutIntent');
const { createCheckoutSessionWithClient } = require('../lib/stripe');

async function run() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  try {
  runMigrationEngine(db, { logger: () => {} });
  db.prepare('INSERT INTO users(id, email, name) VALUES (?, ?, ?)').run(166, 'checkout@example.com', 'Checkout');
  let sequence = 0;
  const randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const startedAt = new Date('2026-09-01T12:00:00.000Z');

  const first = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro', now: startedAt, randomUUID
  });
  const repeated = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro',
    now: new Date(startedAt.getTime() + 60 * 60 * 1000), randomUUID
  });
  assert.strictEqual(first.reused, false);
  assert.strictEqual(repeated.reused, true);
  assert.strictEqual(repeated.idempotencyKey, first.idempotencyKey,
    'separate browser sessions must share one user/plan Stripe operation');
  assert.strictEqual(first.expiresAt.getTime(), startedAt.getTime() + CHECKOUT_INTENT_TTL_MS);
  recordSubscriptionCheckoutSession(db, {
    userId: 166,
    planTier: 'pro',
    idempotencyKey: first.idempotencyKey,
    stripeCheckoutSessionId: 'cs_test_checkout_intent_166'
  });

  const otherPlan = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'unlimited', priceId: 'price_unlimited', now: startedAt, randomUUID
  });
  assert.notStrictEqual(otherPlan.idempotencyKey, first.idempotencyKey);

  const changedPrice = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro_v2',
    now: new Date(startedAt.getTime() + 2 * 60 * 60 * 1000), randomUUID
  });
  assert.strictEqual(changedPrice.reused, false);
  assert.notStrictEqual(changedPrice.idempotencyKey, first.idempotencyKey,
    'changed Stripe request parameters require a new idempotency key');

  const expired = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro_v2',
    now: new Date(changedPrice.expiresAt.getTime()), randomUUID
  });
  assert.strictEqual(expired.reused, true);
  assert.strictEqual(expired.expired, true);
  assert.strictEqual(expired.idempotencyKey, changedPrice.idempotencyKey,
    'expired intents must not rotate before authoritative Stripe inspection');
  const replaced = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro_v2',
    now: new Date(changedPrice.expiresAt.getTime()), randomUUID,
    allowExpiredReplacement: true
  });
  assert.strictEqual(replaced.reused, false);
  assert.notStrictEqual(replaced.idempotencyKey, changedPrice.idempotencyKey);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM subscription_checkout_intents').get().count, 2);

  assert.throws(() => acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'free', priceId: 'price_free', now: startedAt
  }), /invalid/);

  let stripeRequest;
  await createCheckoutSessionWithClient({
    checkout: { sessions: { create: async (payload, requestOptions) => {
      stripeRequest = { payload, requestOptions };
      return { id: 'cs_test_safe' };
    } } }
  }, 'checkout@example.com', 'price_pro', 'https://copyquick.example/success',
  'https://copyquick.example/cancel', `checkout:166:${first.idempotencyKey}`, 166,
  Math.floor(first.expiresAt.getTime() / 1000));
  assert.strictEqual(stripeRequest.payload.expires_at, Math.floor(first.expiresAt.getTime() / 1000));
  assert.strictEqual(stripeRequest.requestOptions.idempotencyKey, `checkout:166:${first.idempotencyKey}`);
  assert.strictEqual(stripeRequest.payload.client_reference_id, '166');

    console.log('Story 3.166 Subscription Checkout Intent tests passed');
  } finally {
    db.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
