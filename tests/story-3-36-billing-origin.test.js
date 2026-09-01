const assert = require('assert');
const express = require('express');
const http = require('http');
const {
  getPublicAppOrigin,
  parseConfiguredOrigin,
  validateBillingReturnOrigin
} = require('../lib/publicAppOrigin');

const stripeModuleId = require.resolve('../lib/stripe');
const calls = { checkout: [], portal: [] };
const checkoutKey = '11111111-1111-4111-8111-111111111111';
require.cache[stripeModuleId] = {
  id: stripeModuleId,
  filename: stripeModuleId,
  loaded: true,
  exports: {
    isBillingEnabled: true,
    createCheckoutSession: async (...args) => {
      calls.checkout.push(args);
      return { url: 'https://checkout.stripe.com/test' };
    },
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
    assert.deepStrictEqual(calls.checkout[0].slice(1), [
      'price_pro',
      'https://app.copyquick.example/dashboard?session_id={CHECKOUT_SESSION_ID}',
      'https://app.copyquick.example/pricing',
      `checkout:36:${checkoutKey}`,
      36
    ]);

    const portal = await request(server, '/manage');
    assert.strictEqual(portal.statusCode, 302);
    assert.deepStrictEqual(calls.portal[0], [
      'cus_safe',
      'https://app.copyquick.example/profile'
    ]);
    assert(!JSON.stringify(calls).includes('attacker.example'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('Story 3.36 trusted billing origin tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
