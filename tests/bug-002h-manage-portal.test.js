const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002h-test.sqlite');
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

const stripeModuleId = require.resolve('../lib/stripe');
const portalCalls = [];
require.cache[stripeModuleId] = {
  id: stripeModuleId,
  filename: stripeModuleId,
  loaded: true,
  exports: {
    createCheckoutSession: async () => {
      throw new Error('Checkout should not be called by /manage');
    },
    createCustomerPortalSession: async (customerId, returnUrl) => {
      portalCalls.push({ customerId, returnUrl });
      return { url: '/stripe-portal-session' };
    },
    stripe: {}
  }
};

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { getAuthenticatedUserById } = require('../lib/authUser');
const pricingRoutes = require('../routes/pricing');

function request(server, method, url) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path: url
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  initDb();
  const db = getDb();
  const paidUserId = db.prepare(`
    INSERT INTO users (email, name, plan_tier, generations_used, monthly_limit, stripe_customer_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('paid@example.com', 'Paid User', 'pro', 7, 200, 'cus_paid_123').lastInsertRowid;

  const loadedPaidUser = getAuthenticatedUserById(db, paidUserId);
  assert.strictEqual(loadedPaidUser.email, 'paid@example.com');
  assert.strictEqual(loadedPaidUser.name, 'Paid User');
  assert.strictEqual(loadedPaidUser.plan_tier, 'pro');
  assert.strictEqual(loadedPaidUser.generations_used, 7);
  assert.strictEqual(loadedPaidUser.monthly_limit, 200);
  assert.strictEqual(loadedPaidUser.stripe_customer_id, 'cus_paid_123');

  let currentUser = loadedPaidUser;
  const app = express();
  app.use((req, res, next) => {
    req.session = { userId: currentUser.id };
    res.locals.user = currentUser;
    next();
  });
  app.use(pricingRoutes);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });

  try {
    const paidResponse = await request(server, 'POST', '/manage');
    assert.strictEqual(paidResponse.statusCode, 302);
    assert.strictEqual(paidResponse.headers.location, '/stripe-portal-session');
    assert.strictEqual(portalCalls.length, 1);
    assert.strictEqual(portalCalls[0].customerId, 'cus_paid_123');
    assert.match(portalCalls[0].returnUrl, /^http:\/\/127\.0\.0\.1:\d+\/profile$/);

    portalCalls.length = 0;
    currentUser = {
      ...loadedPaidUser,
      id: paidUserId + 1,
      email: 'free@example.com',
      plan_tier: 'free',
      monthly_limit: 10,
      stripe_customer_id: null
    };

    const freeResponse = await request(server, 'POST', '/manage');
    assert.strictEqual(freeResponse.statusCode, 302);
    assert.strictEqual(freeResponse.headers.location, '/pricing');
    assert.deepStrictEqual(portalCalls, []);
  } finally {
    server.close();
  }
}

run()
  .then(() => {
    console.log('BUG-002H manage portal tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
