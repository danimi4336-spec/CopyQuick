const assert = require('assert');
const ejs = require('ejs');
const express = require('express');
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { canStartSubscriptionCheckout } = require('../lib/subscriptionCheckoutPolicy');

process.env.STRIPE_UNLIMITED_PRICE = 'price_unlimited_story_344';

const stripeModuleId = require.resolve('../lib/stripe');
const checkoutCalls = [];
require.cache[stripeModuleId] = {
  id: stripeModuleId,
  filename: stripeModuleId,
  loaded: true,
  exports: {
    isBillingEnabled: true,
    createCheckoutSession: async (...args) => {
      checkoutCalls.push(args);
      return { id: 'cs_test_subscriber_safe', url: 'https://checkout.stripe.com/c/pay/test-session' };
    },
    retrieveCheckoutSession: async () => ({ status: 'expired' }),
    createCustomerPortalSession: async () => ({ url: 'https://billing.stripe.com/p/session/test-session' })
  }
};

const pricingRoutes = require('../routes/pricing');
const checkoutKey = '11111111-1111-4111-8111-111111111111';

function post(server, user) {
  return new Promise((resolve, reject) => {
    const body = `price=unlimited&checkoutKey=${checkoutKey}`;
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: '/subscribe',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'X-Test-Plan': user.plan_tier
      }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function run() {
  const app = express();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrationEngine(db, { logger: () => {} });
  db.prepare('INSERT INTO users(id, email, name) VALUES (?, ?, ?)').run(44, 'safe@example.com', 'Safe');
  assert.strictEqual(canStartSubscriptionCheckout({ id: 44, plan_tier: 'free' }, db), true);
  assert.strictEqual(canStartSubscriptionCheckout({ id: 44, plan_tier: 'free' }), false);
  for (const planTier of ['pro', 'unlimited', 'unexpected', null, undefined]) {
    assert.strictEqual(canStartSubscriptionCheckout({ id: 44, plan_tier: planTier }, db), false);
  }
  app.locals.copyquickDb = db;
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const planTier = req.headers['x-test-plan'];
    req.session = {
      userId: 44,
      checkoutKeys: [{ key: checkoutKey, price: 'unlimited', createdAt: Date.now() }]
    };
    res.locals.user = { id: 44, email: 'safe@example.com', plan_tier: planTier };
    next();
  });
  app.use(pricingRoutes);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const paid = await post(server, { plan_tier: 'pro' });
    assert.strictEqual(paid.statusCode, 303);
    assert.strictEqual(paid.headers.location, '/profile');
    assert.strictEqual(checkoutCalls.length, 0, 'an entitled subscriber must not create another subscription Checkout Session');

    db.prepare(`
      INSERT INTO subscriptions(
        user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
        price_id, current_period_start, current_period_end
      ) VALUES (44, 'cus_story_344', 'sub_story_344', 'active', 'pro', 'price_pro', ?, ?)
    `).run('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    const driftedFree = await post(server, { plan_tier: 'free' });
    assert.strictEqual(driftedFree.statusCode, 303);
    assert.strictEqual(driftedFree.headers.location, '/profile');
    assert.strictEqual(checkoutCalls.length, 0, 'a nonterminal local subscription must block checkout despite stale free entitlement');

    db.prepare("UPDATE subscriptions SET status='canceled' WHERE user_id=44").run();
    db.prepare("UPDATE users SET stripe_customer_id='cus_story_344' WHERE id=44").run();
    const free = await post(server, { plan_tier: 'free' });
    assert.strictEqual(free.statusCode, 302);
    assert.strictEqual(free.headers.location, 'https://checkout.stripe.com/c/pay/test-session');
    assert.strictEqual(checkoutCalls.length, 1);
    assert.strictEqual(checkoutCalls[0][7], 'cus_story_344',
      'safe resubscription must reuse the historical Stripe customer');
    db.prepare("UPDATE subscriptions SET status='unpaid' WHERE user_id=44").run();
    assert.strictEqual(canStartSubscriptionCheckout({ id: 44, plan_tier: 'free' }, db), false);
    db.prepare("UPDATE subscriptions SET status='incomplete_expired' WHERE user_id=44").run();
    assert.strictEqual(canStartSubscriptionCheckout({ id: 44, plan_tier: 'free' }, db), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }

  const pricingView = path.join(__dirname, '..', 'views', 'pricing.ejs');
  const paidHtml = await ejs.renderFile(pricingView, {
    user: { plan_tier: 'pro' },
    csrfToken: 'safe-token',
    checkoutKeys: { pro: checkoutKey, unlimited: checkoutKey }
  });
  assert.doesNotMatch(paidHtml, /action="\/subscribe"/);
  assert.match(paidHtml, /Current Plan/);
  assert.match(paidHtml, /Manage Subscription/);

  const freeHtml = await ejs.renderFile(pricingView, {
    user: { plan_tier: 'free' },
    csrfToken: 'safe-token',
    checkoutKeys: { pro: checkoutKey, unlimited: checkoutKey }
  });
  assert.strictEqual((freeHtml.match(/action="\/subscribe"/g) || []).length, 2);
  console.log('Story 3.44 subscriber checkout guard tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
