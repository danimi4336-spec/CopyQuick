const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const {
  CHECKOUT_INTENT_TTL_MS,
  acquireSubscriptionCheckoutIntent,
  clearSubscriptionCheckoutIntentIfMatches,
  getConflictingSubscriptionCheckoutIntent,
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
  assert.strictEqual(first.requiresInspection, false);
  assert.strictEqual(repeated.reused, true);
  assert.strictEqual(repeated.requiresInspection, false);
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
  assert.deepStrictEqual(getConflictingSubscriptionCheckoutIntent(db, {
    userId: 166,
    planTier: 'unlimited'
  }), {
    planTier: 'pro',
    idempotencyKey: first.idempotencyKey,
    stripeCheckoutSessionId: 'cs_test_checkout_intent_166',
    expiresAt: first.expiresAt.toISOString()
  });
  assert.strictEqual(clearSubscriptionCheckoutIntentIfMatches(db, {
    userId: 166,
    planTier: 'pro',
    idempotencyKey: 'wrong-key',
    stripeCheckoutSessionId: 'cs_test_checkout_intent_166'
  }), false);

  const changedPrice = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro_v2',
    now: new Date(startedAt.getTime() + 2 * 60 * 60 * 1000), randomUUID
  });
  assert.strictEqual(changedPrice.reused, true);
  assert.strictEqual(changedPrice.requiresInspection, true);
  assert.strictEqual(changedPrice.idempotencyKey, first.idempotencyKey,
    'changed Stripe request parameters must inspect the prior Checkout before rotating');

  const replacedChangedPrice = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro_v2',
    now: new Date(startedAt.getTime() + 2 * 60 * 60 * 1000), randomUUID,
    allowExpiredReplacement: true
  });
  assert.strictEqual(replacedChangedPrice.reused, false);
  assert.notStrictEqual(replacedChangedPrice.idempotencyKey, first.idempotencyKey);

  const expired = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro_v2',
    now: new Date(replacedChangedPrice.expiresAt.getTime()), randomUUID
  });
  assert.strictEqual(expired.reused, true);
  assert.strictEqual(expired.expired, true);
  assert.strictEqual(expired.requiresInspection, true);
  assert.strictEqual(expired.idempotencyKey, replacedChangedPrice.idempotencyKey,
    'expired intents must not rotate before authoritative Stripe inspection');
  const replaced = acquireSubscriptionCheckoutIntent(db, {
    userId: 166, planTier: 'pro', priceId: 'price_pro_v2',
    now: new Date(replacedChangedPrice.expiresAt.getTime()), randomUUID,
    allowExpiredReplacement: true
  });
  assert.strictEqual(replaced.reused, false);
  assert.notStrictEqual(replaced.idempotencyKey, replacedChangedPrice.idempotencyKey);
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
  assert.strictEqual(stripeRequest.payload.customer_email, 'checkout@example.com');
  assert.strictEqual(stripeRequest.payload.customer, undefined);

  await createCheckoutSessionWithClient({
    checkout: { sessions: { create: async (payload, requestOptions) => {
      stripeRequest = { payload, requestOptions };
      return { id: 'cs_test_returning' };
    } } }
  }, 'checkout@example.com', 'price_pro', 'https://copyquick.example/success',
  'https://copyquick.example/cancel', `checkout:166:${first.idempotencyKey}`, 166,
  Math.floor(first.expiresAt.getTime() / 1000), 'cus_returning_166');
  assert.strictEqual(stripeRequest.payload.customer, 'cus_returning_166');
  assert.strictEqual(stripeRequest.payload.customer_email, undefined,
    'returning subscriptions must reuse the authoritative Stripe customer');
  await assert.rejects(() => createCheckoutSessionWithClient({
    checkout: { sessions: { create: async () => ({}) } }
  }, 'checkout@example.com', 'price_pro', 'https://copyquick.example/success',
  'https://copyquick.example/cancel', 'checkout:invalid', 166,
  Math.floor(first.expiresAt.getTime() / 1000), 'invalid_customer'));

    console.log('Story 3.166 Subscription Checkout Intent tests passed');
  } finally {
    db.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
