const assert = require('assert');
const express = require('express');
const http = require('http');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');

process.env.STRIPE_PRO_PRICE = 'price_story_3189_current';
const checkoutKey = '18918918-9189-4189-8189-189189189189';
const checkoutCalls = [];
let retrievedSession = {
  id: 'cs_story_3189_old',
  status: 'open',
  url: 'https://checkout.stripe.com/c/pay/story-3189-old'
};
const stripeModuleId = require.resolve('../lib/stripe');
require.cache[stripeModuleId] = {
  id: stripeModuleId,
  filename: stripeModuleId,
  loaded: true,
  exports: {
    isBillingEnabled: true,
    createCheckoutSession: async (...args) => {
      checkoutCalls.push(args);
      return {
        id: 'cs_story_3189_current',
        url: 'https://checkout.stripe.com/c/pay/story-3189-current'
      };
    },
    retrieveCheckoutSession: async () => retrievedSession,
    createCustomerPortalSession: async () => ({ url: 'https://billing.stripe.com/p/session/story-3189' })
  }
};
const pricingRoutes = require('../routes/pricing');

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
  db.prepare("INSERT INTO users(id,email,name,plan_tier) VALUES (189,'price189@example.com','Price 189','free')").run();
  db.prepare(`
    INSERT INTO subscription_checkout_intents(
      user_id, plan_tier, price_id, idempotency_key, stripe_checkout_session_id,
      expires_at, created_at, updated_at
    ) VALUES (189, 'pro', 'price_story_3189_old', 'old-price-intent-189',
      'cs_story_3189_old', ?, ?, ?)
  `).run('2026-09-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');

  const app = express();
  app.locals.copyquickDb = db;
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = {
      userId: 189,
      checkoutKeys: [{ key: checkoutKey, price: 'pro', createdAt: Date.now() }]
    };
    res.locals.user = { id: 189, email: 'price189@example.com', plan_tier: 'free' };
    next();
  });
  app.use(pricingRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const open = await post(server);
    assert.strictEqual(open.statusCode, 302);
    assert.strictEqual(open.headers.location, retrievedSession.url);
    assert.strictEqual(checkoutCalls.length, 0,
      'a price change must not replace an open Checkout Session');

    retrievedSession = { id: 'cs_story_3189_old', status: 'complete' };
    const complete = await post(server);
    assert.strictEqual(complete.statusCode, 303);
    assert.strictEqual(complete.headers.location, '/profile?billing=pending');
    assert.strictEqual(checkoutCalls.length, 0,
      'a completed old-price Checkout must not create another subscription');

    retrievedSession = { id: 'cs_story_3189_old', status: 'expired' };
    const expired = await post(server);
    assert.strictEqual(expired.statusCode, 302);
    assert.strictEqual(expired.headers.location, 'https://checkout.stripe.com/c/pay/story-3189-current');
    assert.strictEqual(checkoutCalls.length, 1,
      'only an authoritatively expired old-price Checkout may rotate');
    assert.deepStrictEqual(db.prepare(`
      SELECT price_id, stripe_checkout_session_id
      FROM subscription_checkout_intents WHERE user_id=189 AND plan_tier='pro'
    `).get(), {
      price_id: process.env.STRIPE_PRO_PRICE,
      stripe_checkout_session_id: 'cs_story_3189_current'
    });

    console.log('Story 3.189 Checkout Price Change Safety tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
