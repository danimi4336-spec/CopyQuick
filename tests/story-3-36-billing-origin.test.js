const assert = require('assert');
const express = require('express');
const http = require('http');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const {
  getPublicAppOrigin,
  parseConfiguredOrigin,
  validateBillingReturnOrigin
} = require('../lib/publicAppOrigin');

const stripeModuleId = require.resolve('../lib/stripe');
const calls = { checkout: [], portal: [] };
let retrievedCheckoutSession = { status: 'expired' };
const checkoutKey = '11111111-1111-4111-8111-111111111111';
require.cache[stripeModuleId] = {
  id: stripeModuleId,
  filename: stripeModuleId,
  loaded: true,
  exports: {
    isBillingEnabled: true,
    createCheckoutSession: async (...args) => {
      calls.checkout.push(args);
      return { id: 'cs_test_origin_safe', url: 'https://checkout.stripe.com/test' };
    },
    retrieveCheckoutSession: async () => retrievedCheckoutSession,
    createCustomerPortalSession: async (...args) => {
      calls.portal.push(args);
      return { url: 'https://billing.stripe.com/test' };
    }
  }
};

function request(server, route) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method: 'POST',
      path: route,
      headers: {
        Host: 'attacker.example',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    if (route === '/subscribe') req.write(`price=pro&checkoutKey=${checkoutKey}`);
    req.end();
  });
}

async function run() {
  assert.strictEqual(
    parseConfiguredOrigin('https://copyquick.example/'),
    'https://copyquick.example'
  );
  assert.strictEqual(
    parseConfiguredOrigin('http://localhost:3000', { production: false }),
    'http://localhost:3000'
  );
  for (const invalid of [
    'javascript:alert(1)',
    'https://user:secret@copyquick.example',
    'https://copyquick.example/path',
    'https://copyquick.example?next=evil',
    '//copyquick.example'
  ]) {
    assert.throws(() => parseConfiguredOrigin(invalid, { production: true }));
  }
  assert.throws(() => parseConfiguredOrigin('http://copyquick.example', { production: true }));
  assert.throws(() => getPublicAppOrigin({ env: { NODE_ENV: 'production' } }), /required/);
  assert.strictEqual(
    getPublicAppOrigin({
      env: { NODE_ENV: 'production', PUBLIC_APP_ORIGIN: 'https://copyquick.example' }
    }),
    'https://copyquick.example'
  );
  assert.doesNotThrow(() => validateBillingReturnOrigin({ NODE_ENV: 'production' }));
  assert.throws(
    () => validateBillingReturnOrigin({ NODE_ENV: 'production', STRIPE_KEY: 'sk_test_configured' }),
    /PUBLIC_APP_ORIGIN is required/
  );
  const serverSource = require('fs').readFileSync(require.resolve('../server'), 'utf8');
  assert(
    serverSource.indexOf('validateBillingReturnOrigin(process.env)') < serverSource.indexOf('const databaseStorage = getDatabaseStorage()'),
    'billing return origin must be validated before database/runtime initialization'
  );

  process.env.NODE_ENV = 'production';
  process.env.PUBLIC_APP_ORIGIN = 'https://app.copyquick.example';
  process.env.STRIPE_PRO_PRICE = 'price_pro';
  const pricingRoutes = require('../routes/pricing');
  const app = express();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrationEngine(db, { logger: () => {} });
  db.prepare('INSERT INTO users(id, email, name, stripe_customer_id) VALUES (?, ?, ?, ?)')
    .run(36, 'owner@example.com', 'Owner', 'cus_safe');
  db.prepare(`
    INSERT INTO subscriptions(
      user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
      price_id, current_period_start, current_period_end
    ) VALUES (36, 'cus_safe', 'sub_safe', 'canceled', 'pro', 'price_pro', ?, ?)
  `).run('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
  app.locals.copyquickDb = db;
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = {
      userId: 36,
      checkoutKeys: [{ key: checkoutKey, price: 'pro', createdAt: Date.now() }]
    };
    res.locals.user = {
      id: 36,
      email: 'owner@example.com',
      plan_tier: 'free',
      stripe_customer_id: 'cus_safe'
    };
    next();
  });
  app.use(pricingRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const checkout = await request(server, '/subscribe');
    assert.strictEqual(checkout.statusCode, 302);
    assert.deepStrictEqual(calls.checkout[0].slice(1, 4), [
      'price_pro',
      'https://app.copyquick.example/billing/return?session_id={CHECKOUT_SESSION_ID}',
      'https://app.copyquick.example/pricing'
    ]);
    assert.match(calls.checkout[0][4], /^checkout:36:[0-9a-f-]{36}$/i);
    assert.strictEqual(calls.checkout[0][5], 36);
    assert(Number.isSafeInteger(calls.checkout[0][6]));
    assert.strictEqual(calls.checkout[0][7], 'cus_safe');

    db.prepare("UPDATE subscription_checkout_intents SET expires_at = '2020-01-01T00:00:00.000Z'").run();
    retrievedCheckoutSession = { status: 'complete' };
    const completedReplay = await request(server, '/subscribe');
    assert.strictEqual(completedReplay.statusCode, 303);
    assert.strictEqual(completedReplay.headers.location, '/profile?billing=pending');
    assert.strictEqual(calls.checkout.length, 1,
      'a completed authoritative Checkout Session must prevent a second subscription checkout');

    retrievedCheckoutSession = { status: 'expired' };
    const expiredReplacement = await request(server, '/subscribe');
    assert.strictEqual(expiredReplacement.statusCode, 302);
    assert.strictEqual(calls.checkout.length, 2,
      'a new checkout is safe only after Stripe confirms the prior session expired');

    const portal = await request(server, '/manage');
    assert.strictEqual(portal.statusCode, 302);
    assert.deepStrictEqual(calls.portal[0], [
      'cus_safe',
      'https://app.copyquick.example/profile'
    ]);
    assert(!JSON.stringify(calls).includes('attacker.example'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  console.log('Story 3.36 trusted billing origin tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
