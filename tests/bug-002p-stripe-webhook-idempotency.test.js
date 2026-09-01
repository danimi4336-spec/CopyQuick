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
const subscriptionStates = new Map();

function makeStripeSubscription({
  id,
  customer,
  status = 'active',
  price = process.env.STRIPE_PRO_PRICE,
  currentPeriodStart = 1767225600,
  currentPeriodEnd = 1769904000
}) {
  return {
    id,
    customer,
    status,
    items: { data: [{ price: { id: price } }] },
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: false,
    canceled_at: status === 'canceled' ? 1767225600 : null,
    ended_at: status === 'canceled' ? 1767225600 : null
  };
}

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
          if (subscriptionStates.has(subscriptionId)) {
            const state = subscriptionStates.get(subscriptionId);
            if (state === null) {
              const err = new Error('No such subscription');
              err.statusCode = 404;
              err.code = 'resource_missing';
              throw err;
            }
            return state;
          }

          return makeStripeSubscription({ id: subscriptionId, customer: `cus_${subscriptionId}` });
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

function checkoutEvent({ id, created, email, customer, subscription, userId, metadataUserId = userId }) {
  const identity = userId === undefined && metadataUserId === undefined ? {} : {
    client_reference_id: String(userId),
    metadata: { copyquick_user_id: String(metadataUserId) }
  };
  return {
    id,
    type: 'checkout.session.completed',
    created,
    data: {
      object: {
        id: `cs_${id}`,
        customer_email: email,
        customer,
        subscription,
        ...identity
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

function malformedLifecycleEvent(id, created) {
  const event = subscriptionEvent({
    id,
    created,
    customer: 'cus_fail',
    subscription: 'sub_fail'
  });
  if (created === undefined) {
    delete event.created;
  }
  return event;
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

  const checkoutUserId = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('checkout@example.com', 'Checkout User').lastInsertRowid;
  db.prepare(`
    INSERT INTO subscription_checkout_intents(
      user_id, plan_tier, price_id, idempotency_key, stripe_checkout_session_id,
      expires_at, created_at, updated_at
    ) VALUES (?, 'pro', ?, 'checkout-intent-webhook', 'cs_checkout_webhook', ?, ?, ?)
  `).run(
    checkoutUserId, process.env.STRIPE_PRO_PRICE,
    '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
  );
  const mismatchUserId = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('mismatch@example.com', 'Mismatch User').lastInsertRowid;
  const legacyUserId = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)')
    .run('legacy@example.com', 'Legacy Checkout User').lastInsertRowid;
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('fail@example.com', 'Fail User', 'cus_fail');
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('stale@example.com', 'Stale User', 'cus_stale');
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('other@example.com', 'Other User', 'cus_other');
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('same@example.com', 'Same Second User', 'cus_same');
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('null-order@example.com', 'Null Order User', 'cus_null');
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)').run('multi@example.com', 'Multi Subscription User', 'cus_multi');
  const boundOwnerId = db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)')
    .run('bound-owner@example.com', 'Bound Owner', 'cus_shared').lastInsertRowid;
  db.prepare('INSERT INTO users (email, name, stripe_customer_id) VALUES (?, ?, ?)')
    .run('cached-owner@example.com', 'Cached Owner', 'cus_shared');
  db.prepare(`
    INSERT INTO subscriptions(
      user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier,
      price_id, current_period_start, current_period_end
    ) VALUES (?, 'cus_shared', 'sub_bound_owner', 'active', 'pro', ?, ?, ?)
  `).run(
    boundOwnerId, process.env.STRIPE_PRO_PRICE,
    '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'
  );

  const app = express();
  app.use('/', webhookRoutes);
  const server = await listen(app);

  try {
    subscriptionStates.set('sub_checkout', makeStripeSubscription({
      id: 'sub_checkout',
      customer: 'cus_checkout'
    }));
    const checkout = checkoutEvent({
      id: 'evt_checkout_once',
      created: 100,
      email: 'checkout@example.com',
      customer: 'cus_checkout',
      subscription: 'sub_checkout',
      userId: checkoutUserId
    });
    let response = await request(server, checkout);
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(JSON.parse(response.body).received, true);
    assert.strictEqual(getUser(db, 'checkout@example.com').plan_tier, 'pro');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM subscription_checkout_intents WHERE user_id = ?').get(checkoutUserId).count, 0);
    assert.strictEqual(eventCount(db, 'evt_checkout_once'), 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_periods').get().count, 1);
    assert.strictEqual(calls.listLineItems, 1);
    assert.strictEqual(calls.retrieve, 1);

    response = await request(server, checkoutEvent({
      id: 'evt_checkout_once',
      created: 100,
      email: 'checkout@example.com',
      customer: 'cus_checkout',
      subscription: 'sub_checkout',
      userId: checkoutUserId
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(eventCount(db, 'evt_checkout_once'), 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_periods').get().count, 1);
    assert.strictEqual(calls.listLineItems, 1, 'duplicate checkout should not repeat line item lookup');
    assert.strictEqual(calls.retrieve, 1, 'duplicate checkout should not repeat subscription retrieval');

    subscriptionStates.set('sub_mismatch', makeStripeSubscription({ id: 'sub_mismatch', customer: 'cus_mismatch' }));
    response = await request(server, checkoutEvent({
      id: 'evt_checkout_mismatch', created: 110, email: 'mismatch@example.com',
      customer: 'cus_mismatch', subscription: 'sub_mismatch', userId: mismatchUserId,
      metadataUserId: checkoutUserId
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'mismatch@example.com').plan_tier, 'free');
    assert.strictEqual(db.prepare('SELECT status FROM stripe_webhook_events WHERE event_id = ?').get('evt_checkout_mismatch').status, 'invalid');

    subscriptionStates.set('sub_legacy_unbound', makeStripeSubscription({
      id: 'sub_legacy_unbound', customer: 'cus_legacy_unbound'
    }));
    response = await request(server, checkoutEvent({
      id: 'evt_checkout_legacy_unbound', created: 115, email: 'legacy@example.com',
      customer: 'cus_legacy_unbound', subscription: 'sub_legacy_unbound'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'legacy@example.com').plan_tier, 'free',
      'email alone must not bind an unrecorded legacy Checkout Session');
    assert.strictEqual(db.prepare('SELECT status FROM stripe_webhook_events WHERE event_id = ?')
      .get('evt_checkout_legacy_unbound').status, 'invalid');

    db.prepare(`
      INSERT INTO subscription_checkout_intents(
        user_id, plan_tier, price_id, idempotency_key, stripe_checkout_session_id,
        expires_at, created_at, updated_at
      ) VALUES (?, 'pro', ?, 'legacy-checkout-intent', 'cs_evt_checkout_legacy', ?, ?, ?)
    `).run(
      legacyUserId, process.env.STRIPE_PRO_PRICE,
      '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
    subscriptionStates.set('sub_legacy', makeStripeSubscription({ id: 'sub_legacy', customer: 'cus_legacy' }));
    response = await request(server, checkoutEvent({
      id: 'evt_checkout_legacy', created: 120, email: 'legacy@example.com',
      customer: 'cus_legacy', subscription: 'sub_legacy'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'legacy@example.com').plan_tier, 'pro');

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

    const beforeIncomplete = getUser(db, 'fail@example.com');
    const incomplete = subscriptionEvent({
      id: 'evt_incomplete_authority',
      created: 175,
      customer: 'cus_fail',
      subscription: 'sub_fail'
    });
    incomplete.data.object.items = { data: [] };
    response = await request(server, incomplete);
    assert.strictEqual(response.res.statusCode, 200);
    assert.deepStrictEqual(getUser(db, 'fail@example.com'), beforeIncomplete,
      'incomplete Stripe authority must not partially mutate entitlement');
    assert.strictEqual(db.prepare('SELECT status FROM stripe_webhook_events WHERE event_id = ?').get('evt_incomplete_authority').status, 'invalid');

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
      id: 'evt_exact_binding_wins', created: 355, customer: 'cus_shared',
      subscription: 'sub_bound_owner', status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'bound-owner@example.com').plan_tier, 'free',
      'a globally ambiguous customer must not grant entitlement even to the bound subscription');
    assert.strictEqual(getUser(db, 'cached-owner@example.com').plan_tier, 'free',
      'a duplicated cached customer ID must not override the exact subscription owner');
    assert.strictEqual(db.prepare("SELECT user_id FROM subscriptions WHERE stripe_subscription_id='sub_bound_owner'").get().user_id, boundOwnerId,
      'an ambiguous event must never transfer the existing subscription binding');

    response = await request(server, subscriptionEvent({
      id: 'evt_ambiguous_customer_only', created: 356, customer: 'cus_shared',
      subscription: 'sub_unbound_shared', status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM subscriptions WHERE stripe_subscription_id='sub_unbound_shared'").get().count, 0,
      'an ambiguous customer-only relationship must fail closed');
    assert.strictEqual(getUser(db, 'cached-owner@example.com').plan_tier, 'free');

    response = await request(server, subscriptionEvent({
      id: 'evt_multi_old_active', created: 360, customer: 'cus_multi',
      subscription: 'sub_multi_old', status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    response = await request(server, subscriptionEvent({
      id: 'evt_multi_new_active', created: 370, customer: 'cus_multi',
      subscription: 'sub_multi_new', status: 'active', price: process.env.STRIPE_UNLIMITED_PRICE
    }));
    assert.strictEqual(response.res.statusCode, 200);
    const multiBeforeTerminal = getUser(db, 'multi@example.com');
    const siblingUsageBeforeTerminal = db.prepare('SELECT * FROM usage_periods WHERE id = ?')
      .get(multiBeforeTerminal.current_usage_period_id);
    assert.strictEqual(siblingUsageBeforeTerminal.monthly_limit, 999999);
    subscriptionStates.set('sub_multi_new', makeStripeSubscription({
      id: 'sub_multi_new', customer: 'cus_multi', status: 'active', price: process.env.STRIPE_UNLIMITED_PRICE
    }));
    response = await request(server, subscriptionEvent({
      id: 'evt_multi_old_canceled', type: 'customer.subscription.deleted', created: 380,
      customer: 'cus_multi', subscription: 'sub_multi_old', status: 'canceled'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'multi@example.com').plan_tier, 'unlimited',
      'a terminal event for an older subscription must preserve an authoritative active sibling');
    const multiAfterTerminal = getUser(db, 'multi@example.com');
    assert.strictEqual(multiAfterTerminal.current_usage_period_id, multiBeforeTerminal.current_usage_period_id,
      'a protected sibling entitlement must preserve its current usage ledger');
    assert.deepStrictEqual(
      db.prepare('SELECT * FROM usage_periods WHERE id = ?').get(multiAfterTerminal.current_usage_period_id),
      siblingUsageBeforeTerminal,
      'terminal sibling history must not rewrite current usage accounting'
    );
    assert.strictEqual(db.prepare("SELECT status FROM subscriptions WHERE stripe_subscription_id='sub_multi_old'").get().status, 'canceled');

    subscriptionStates.set('sub_multi_new', null);
    response = await request(server, subscriptionEvent({
      id: 'evt_multi_old_terminal_again', created: 390,
      customer: 'cus_multi', subscription: 'sub_multi_old', status: 'unpaid'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'multi@example.com').plan_tier, 'free',
      'a missing sibling must not preserve stale local paid entitlement');

    response = await request(server, subscriptionEvent({
      id: 'evt_multi_new_restored', created: 400, customer: 'cus_multi',
      subscription: 'sub_multi_new', status: 'active', price: process.env.STRIPE_UNLIMITED_PRICE
    }));
    assert.strictEqual(response.res.statusCode, 200);
    subscriptionStates.set('sub_multi_new', makeStripeSubscription({
      id: 'sub_multi_new', customer: 'cus_multi', status: 'active', price: 'price_unknown'
    }));
    response = await request(server, subscriptionEvent({
      id: 'evt_multi_ambiguous_sibling', created: 410, customer: 'cus_multi',
      subscription: 'sub_multi_old', status: 'unpaid'
    }));
    assert.strictEqual(response.res.statusCode, 500);
    assert.strictEqual(eventCount(db, 'evt_multi_ambiguous_sibling'), 0,
      'ambiguous sibling authority must remain retryable');
    assert.strictEqual(getUser(db, 'multi@example.com').plan_tier, 'unlimited',
      'ambiguous sibling authority must not partially revoke entitlement');

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

    response = await request(server, subscriptionEvent({
      id: 'evt_same_initial',
      created: 650,
      customer: 'cus_same',
      subscription: 'sub_same',
      status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'same@example.com').plan_tier, 'pro');

    response = await request(server, subscriptionEvent({
      id: 'evt_a_same_deleted',
      type: 'customer.subscription.deleted',
      created: 700,
      customer: 'cus_same',
      subscription: 'sub_same',
      status: 'canceled'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'same@example.com').plan_tier, 'free');

    subscriptionStates.set('sub_same', null);
    response = await request(server, subscriptionEvent({
      id: 'evt_z_same_update',
      created: 700,
      customer: 'cus_same',
      subscription: 'sub_same',
      status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'same@example.com').plan_tier, 'free', 'same-second stale update must not restore access when Stripe says the subscription is deleted');
    assert.strictEqual(db.prepare('SELECT status FROM stripe_webhook_events WHERE event_id = ?').get('evt_z_same_update').status, 'processed');

    subscriptionStates.set('sub_same', makeStripeSubscription({
      id: 'sub_same',
      customer: 'cus_same',
      status: 'active'
    }));
    response = await request(server, subscriptionEvent({
      id: 'evt_0_same_reactivate',
      created: 700,
      customer: 'cus_same',
      subscription: 'sub_same',
      status: 'canceled'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'same@example.com').plan_tier, 'pro', 'same-second reactivation must apply current Stripe state even when the event ID sorts lower');
    assert.strictEqual(db.prepare('SELECT latest_stripe_event_id FROM subscriptions WHERE stripe_subscription_id = ?').get('sub_same').latest_stripe_event_id, 'evt_0_same_reactivate');

    const nullOrderUser = getUser(db, 'null-order@example.com');
    db.prepare(`
      INSERT INTO subscriptions (
        user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier, price_id,
        current_period_start, current_period_end, latest_stripe_event_created, latest_stripe_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      nullOrderUser.id,
      'cus_null',
      'sub_null_order',
      'active',
      'free',
      process.env.STRIPE_PRO_PRICE,
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z'
    );
    response = await request(server, subscriptionEvent({
      id: 'evt_null_order_first',
      created: 800,
      customer: 'cus_null',
      subscription: 'sub_null_order',
      status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(getUser(db, 'null-order@example.com').plan_tier, 'pro');

    for (const [id, created] of [
      ['evt_missing_created', undefined],
      ['evt_malformed_created', '800'],
      ['evt_negative_created', -1],
      ['evt_non_finite_created', Infinity]
    ]) {
      response = await request(server, malformedLifecycleEvent(id, created));
      assert.strictEqual(response.res.statusCode, 500, `${id} should fail retryably`);
      assert.strictEqual(eventCount(db, id), 0, `${id} should not be recorded as processed`);
    }

    const beforeConcurrentClaim = getUser(db, 'same@example.com');
    db.prepare(`
      INSERT INTO stripe_webhook_events (event_id, event_type, stripe_created, status)
      VALUES (?, ?, ?, ?)
    `).run('evt_concurrent_claim', 'customer.subscription.updated', 900, 'processing');
    response = await request(server, subscriptionEvent({
      id: 'evt_concurrent_claim',
      created: 900,
      customer: 'cus_same',
      subscription: 'sub_same',
      status: 'active'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.deepStrictEqual(getUser(db, 'same@example.com'), beforeConcurrentClaim);
    assert.strictEqual(eventCount(db, 'evt_concurrent_claim'), 1);

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
