const assert = require('assert');
const express = require('express');
const http = require('http');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');

process.env.STRIPE_PRO_PRICE = 'price_story_3188_pro';
process.env.STRIPE_UNLIMITED_PRICE = 'price_story_3188_unlimited';
const checkoutKey = '18818818-8188-4188-8188-188188188188';
const checkoutCalls = [];
let retrievedSession = {
  id: 'cs_story_3188_pro',
  status: 'open',
  url: 'https://checkout.stripe.com/c/pay/story-3188-pro'
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
      const id = args[1] === process.env.STRIPE_PRO_PRICE
        ? 'cs_story_3188_pro'
        : 'cs_story_3188_unlimited';
      return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
    },
    retrieveCheckoutSession: async () => retrievedSession,
    createCustomerPortalSession: async () => ({ url: 'https://billing.stripe.com/p/session/story-3188' })
  }
};
const pricingRoutes = require('../routes/pricing');

function post(server, price) {
  return new Promise((resolve, reject) => {
    const body = `price=${price}&checkoutKey=${checkoutKey}`;
    const request = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: '/subscribe',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
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
  db.prepare("INSERT INTO users(id,email,name,plan_tier) VALUES (188,'checkout188@example.com','Checkout 188','free')").run();

  const app = express();
  app.locals.copyquickDb = db;
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = {
      userId: 188,
      checkoutKeys: [
        { key: checkoutKey, price: 'pro', createdAt: Date.now() },
        { key: checkoutKey, price: 'unlimited', createdAt: Date.now() }
      ]
    };
    res.locals.user = { id: 188, email: 'checkout188@example.com', plan_tier: 'free' };
    next();
  });
  app.use(pricingRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const first = await post(server, 'pro');
    assert.strictEqual(first.statusCode, 302);
    assert.strictEqual(checkoutCalls.length, 1);

    const crossPlanOpen = await post(server, 'unlimited');
    assert.strictEqual(crossPlanOpen.statusCode, 302);
    assert.strictEqual(crossPlanOpen.headers.location, retrievedSession.url,
      'a second plan request must resume the one authoritative open Checkout Session');
    assert.strictEqual(checkoutCalls.length, 1,
      'different plans must not create concurrent Checkout Sessions');

    retrievedSession = { id: 'cs_story_3188_pro', status: 'complete' };
    const crossPlanComplete = await post(server, 'unlimited');
    assert.strictEqual(crossPlanComplete.statusCode, 303);
    assert.strictEqual(crossPlanComplete.headers.location, '/profile?billing=pending');
    assert.strictEqual(checkoutCalls.length, 1);

    retrievedSession = { id: 'cs_story_3188_pro', status: 'expired' };
    const crossPlanExpired = await post(server, 'unlimited');
    assert.strictEqual(crossPlanExpired.statusCode, 302);
    assert.strictEqual(checkoutCalls.length, 2,
      'an authoritatively expired cross-plan session may be replaced');
    const intents = db.prepare(`
      SELECT plan_tier, stripe_checkout_session_id
      FROM subscription_checkout_intents WHERE user_id=188 ORDER BY plan_tier
    `).all();
    assert.deepStrictEqual(intents, [{
      plan_tier: 'unlimited',
      stripe_checkout_session_id: 'cs_story_3188_unlimited'
    }]);

    db.prepare('DELETE FROM subscription_checkout_intents WHERE user_id=188').run();
    db.prepare(`
      INSERT INTO subscription_checkout_intents(
        user_id, plan_tier, price_id, idempotency_key, expires_at, created_at, updated_at
      ) VALUES (188, 'pro', ?, 'in-flight-pro-188', ?, ?, ?)
    `).run(
      process.env.STRIPE_PRO_PRICE,
      '2026-09-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
    );
    const inFlight = await post(server, 'unlimited');
    assert.strictEqual(inFlight.statusCode, 303);
    assert.strictEqual(inFlight.headers.location, '/profile?billing=pending');
    assert.strictEqual(checkoutCalls.length, 2,
      'an in-flight cross-plan operation must block before its Stripe session ID is recorded');

    console.log('Story 3.188 Cross-Plan Checkout Exclusivity tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
