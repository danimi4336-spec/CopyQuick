const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002p-test.sqlite');
process.env.STRIPE_KEY = 'sk_test_bug_002p';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_bug_002p';
process.env.STRIPE_PRO_PRICE = 'price_test_pro';
process.env.STRIPE_UNLIMITED_PRICE = 'price_test_unlimited';
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
const events = [];
const calls = {
  constructEvent: 0,
  listLineItems: 0,
  retrieve: 0
};

require.cache[stripeModuleId] = {
  id: stripeModuleId,
  filename: stripeModuleId,
  loaded: true,
  exports: {
    stripe: {
      webhooks: {
        constructEvent: (body, signature, secret) => {
          calls.constructEvent += 1;
          assert.strictEqual(secret, process.env.STRIPE_WEBHOOK_SECRET);
          if (signature === 'bad-signature') {
            throw new Error('signature verification failed');
          }
          const event = events.shift();
          if (!event) throw new Error('missing queued event');
          return event;
        }
      },
      checkout: {
        sessions: {
          listLineItems: async () => {
            calls.listLineItems += 1;
            return { data: [{ price: { id: process.env.STRIPE_PRO_PRICE } }] };
          }
        }
      },
      subscriptions: {
        retrieve: async (subscriptionId) => {
          calls.retrieve += 1;
          return {
            id: subscriptionId,
            status: 'active',
            current_period_start: 1767225600,
            current_period_end: 1769904000,
            cancel_at_period_end: false,
            canceled_at: null,
            ended_at: null
          };
        }
      }
    }
  }
};

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { getCurrentUsageSnapshot } = require('../lib/subscriptions');
const webhookRoutes = require('../routes/webhook');

function subscriptionEvent({ id, type = 'customer.subscription.updated', created, customer, subscription, price = process.env.STRIPE_PRO_PRICE, status = 'active' }) {
  return {
    id,
    type,
    created,
    data: {
      object: {
        id: subscription,
        customer,
        status,
        items: { data: [{ price: { id: price } }] },
        current_period_start: 1767225600,
        current_period_end: 1769904000,
        cancel_at_period_end: false,
        canceled_at: status === 'canceled' ? created : null,
        ended_at: status === 'canceled' ? created : null
      }
    }
  };
}

function checkoutEvent({ id, created, email, customer, subscription }) {
  return {
    id,
    type: 'checkout.session.completed',
    created,
    data: {
      object: {
        id: `cs_${id}`,
        customer_email: email,
        customer,
        subscription
      }
    }
  };
}

function unsupportedEvent(id) {
  return {
    id,
    type: 'invoice.payment_succeeded',
    created: 500,
    data: { object: { id: 'in_unsupported' } }
  };
}

function request(server, event, signature = 'valid-signature') {
  if (event) events.push(event);

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ id: event?.id || 'evt_invalid' });
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method: 'POST',
      path: '/stripe/webhook',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Stripe-Signature': signature
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

function getUser(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function eventCount(db, eventId) {
  return db.prepare('SELECT COUNT(*) AS count FROM stripe_webhook_events WHERE event_id = ?').get(eventId).count;
}

async function run() {
  initDb();
  const db = getDb();

  db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('checkout@example.com', 'Checkout User');
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('fail@example.com', 'Fail User', 'cus_fail');
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('stale@example.com', 'Stale User', 'cus_stale');
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('other@example.com', 'Other User', 'cus_other');

  const app = express();
  app.use('/', webhookRoutes);
  const server = await listen(app);

  try {
    const checkout = checkoutEvent({
      id: 'evt_checkout_once',
      created: 100,
      email: 'checkout@example.com',
      customer: 'cus_checkout',
      subscription: 'sub_checkout'
    });
    let response = await request(server, checkout);
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(JSON.parse(response.body).received, true);
    assert.strictEqual(getUser(db, 'checkout@example.com').plan_tier, 'pro');
    assert.strictEqual(eventCount(db, 'evt_checkout_once'), 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_periods').get().count, 1);
    assert.strictEqual(calls.listLineItems, 1);
    assert.strictEqual(calls.retrieve, 1);

    response = await request(server, checkoutEvent({
      id: 'evt_checkout_once',
      created: 100,
      email: 'checkout@example.com',
      customer: 'cus_checkout',
      subscription: 'sub_checkout'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(eventCount(db, 'evt_checkout_once'), 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_periods').get().count, 1);
    assert.strictEqual(calls.listLineItems, 1, 'duplicate checkout should not repeat line item lookup');
    assert.strictEqual(calls.retrieve, 1, 'duplicate checkout should not repeat subscription retrieval');

    db.exec(`
      CREATE TRIGGER fail_subscription_insert
      BEFORE INSERT ON subscriptions
      BEGIN
        SELECT RAISE(ABORT, 'forced subscription failure');
      END;
    `);
    response = await request(server, subscriptionEvent({
      id: 'evt_fail_then_retry',
      created: 150,
      customer: 'cus_fail',
      subscription: 'sub_fail'
    }));
    assert.strictEqual(response.res.statusCode, 500);
    assert.strictEqual(eventCount(db, 'evt_fail_then_retry'), 0);
    assert.strictEqual(getUser(db, 'fail@example.com').plan_tier, 'free');

    db.exec('DROP TRIGGER fail_subscription_insert');
    response = await request(server, subscriptionEvent({
      id: 'evt_fail_then_retry',
      created: 150,
      customer: 'cus_fail',
      subscription: 'sub_fail'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(eventCount(db, 'evt_fail_then_retry'), 1);
    assert.strictEqual(getUser(db, 'fail@example.com').plan_tier, 'pro');

    response = await request(server, subscriptionEvent({
      id: 'evt_stale_active',
      created: 200,
      customer: 'cus_stale',
      subscription: 'sub_stale',
      status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'stale@example.com').plan_tier, 'pro');

    response = await request(server, subscriptionEvent({
      id: 'evt_stale_deleted',
      type: 'customer.subscription.deleted',
      created: 300,
      customer: 'cus_stale',
      subscription: 'sub_stale',
      status: 'canceled'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'stale@example.com').plan_tier, 'free');

    response = await request(server, subscriptionEvent({
      id: 'evt_stale_old_update',
      created: 250,
      customer: 'cus_stale',
      subscription: 'sub_stale',
      status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'stale@example.com').plan_tier, 'free');
    assert.strictEqual(db.prepare('SELECT status FROM stripe_webhook_events WHERE event_id = ?').get('evt_stale_old_update').status, 'stale');

    response = await request(server, subscriptionEvent({
      id: 'evt_stale_reactivate',
      created: 350,
      customer: 'cus_stale',
      subscription: 'sub_stale',
      status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'stale@example.com').plan_tier, 'pro');

    response = await request(server, subscriptionEvent({
      id: 'evt_other_independent',
      created: 100,
      customer: 'cus_other',
      subscription: 'sub_other',
      status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'other@example.com').plan_tier, 'pro');
    assert.strictEqual(db.prepare('SELECT latest_stripe_event_id FROM subscriptions WHERE stripe_subscription_id = ?').get('sub_other').latest_stripe_event_id, 'evt_other_independent');

    const beforeUnsupported = getUser(db, 'other@example.com');
    response = await request(server, unsupportedEvent('evt_unsupported'));
    assert.strictEqual(response.res.statusCode, 200);
    assert.deepStrictEqual(getUser(db, 'other@example.com'), beforeUnsupported);
    assert.strictEqual(db.prepare('SELECT status FROM stripe_webhook_events WHERE event_id = ?').get('evt_unsupported').status, 'ignored');

    response = await request(server, null, 'bad-signature');
    assert.strictEqual(response.res.statusCode, 400);
    assert.strictEqual(eventCount(db, 'evt_invalid'), 0);

    const staleUser = getUser(db, 'stale@example.com');
    const snapshot = getCurrentUsageSnapshot(db, staleUser);
    assert.strictEqual(snapshot.monthlyLimit, 200);
    assert.strictEqual(snapshot.used, 0);
    assert(snapshot.usagePeriod, 'usage snapshot should keep billing-period usage available');

    const duplicateUsagePeriods = db.prepare(`
      SELECT COUNT(*) AS count
      FROM usage_periods
      WHERE user_id = ? AND period_start = ? AND period_end = ?
    `).get(staleUser.id, snapshot.usagePeriod.period_start, snapshot.usagePeriod.period_end).count;
    assert.strictEqual(duplicateUsagePeriods, 1);
  } finally {
    server.close();
  }
}

run()
  .then(() => {
    console.log('BUG-002P Stripe webhook idempotency tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
