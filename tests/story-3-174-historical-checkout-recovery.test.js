const assert = require('assert');
const express = require('express');
const http = require('http');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');

process.env.STRIPE_PRO_PRICE = 'price_story_3174_pro';
const stripeModuleId = require.resolve('../lib/stripe');
let createCount = 0;
require.cache[stripeModuleId] = {
  id: stripeModuleId,
  filename: stripeModuleId,
  loaded: true,
  exports: {
    isBillingEnabled: true,
    retrieveCheckoutSession: async () => ({ status: 'complete', subscription: 'sub_story_3174' }),
    createCheckoutSession: async () => {
      createCount += 1;
      return { id: `cs_story_3174_new_${createCount}`, url: 'https://checkout.stripe.com/c/pay/story-3174' };
    },
    createCustomerPortalSession: async () => ({ url: 'https://billing.stripe.com/p/session/story-3174' })
  }
};
const pricingRoutes = require('../routes/pricing');
const checkoutKey = '17417417-4174-4174-8174-174174174174';

function post(server) {
  return new Promise((resolve, reject) => {
    const body = `price=pro&checkoutKey=${checkoutKey}`;
    const request = http.request({
      hostname: '127.0.0.1', port: server.address().port, path: '/subscribe', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, response => {
      response.resume();
      response.on('end', () => resolve(response));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function run() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrationEngine(db, { logger: () => {} });
  db.prepare("INSERT INTO users(id,email,name,plan_tier,monthly_limit) VALUES (174,'resub@example.com','Resub','free',10)").run();
  db.prepare(`
    INSERT INTO subscriptions(
      user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
      price_id, current_period_start, current_period_end
    ) VALUES (174, 'cus_story_3174', 'sub_story_3174', 'canceled', 'pro', ?, ?, ?)
  `).run(process.env.STRIPE_PRO_PRICE, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
  const insertExpiredIntent = () => db.prepare(`
    INSERT INTO subscription_checkout_intents(
      user_id, plan_tier, price_id, idempotency_key, stripe_checkout_session_id,
      expires_at, created_at, updated_at
    ) VALUES (174, 'pro', ?, ?, 'cs_story_3174_old', ?, ?, ?)
    ON CONFLICT(user_id, plan_tier) DO UPDATE SET
      idempotency_key=excluded.idempotency_key,
      stripe_checkout_session_id=excluded.stripe_checkout_session_id,
      expires_at=excluded.expires_at
  `).run(
    process.env.STRIPE_PRO_PRICE, `old-intent-${Date.now()}`,
    '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
  );
  insertExpiredIntent();

  const app = express();
  app.locals.copyquickDb = db;
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = { userId: 174, checkoutKeys: [{ key: checkoutKey, price: 'pro', createdAt: Date.now() }] };
    res.locals.user = { id: 174, email: 'resub@example.com', plan_tier: 'free' };
    next();
  });
  app.use(pricingRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const canceled = await post(server);
    assert.strictEqual(canceled.statusCode, 302);
    assert.strictEqual(canceled.headers.location, 'https://checkout.stripe.com/c/pay/story-3174');
    assert.strictEqual(createCount, 1);

    db.prepare("UPDATE subscriptions SET status='active' WHERE user_id=174").run();
    insertExpiredIntent();
    const active = await post(server);
    assert.strictEqual(active.statusCode, 303);
    assert.strictEqual(active.headers.location, '/profile');
    assert.strictEqual(createCount, 1, 'potentially active billing must not create a duplicate subscription');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
  console.log('Story 3.174 Historical Completed Checkout Recovery tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
