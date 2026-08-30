const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  BillingPolicyError,
  evaluateStripeEntitlement,
  planForPrice
} = require('../lib/billingEntitlement');
const {
  BASELINE_MIGRATION,
  BILLING_RECONCILIATION_MIGRATION,
  LEDGER_TABLE,
  MIGRATIONS,
  runMigrationEngine
} = require('../db/migrations');
const {
  getBillingReconciliationStatus,
  reconcileBilling
} = require('../lib/billingReconciliation');
const { createBillingReconciliationScheduler, resolveBillingScheduleConfig } = require('../lib/billingReconciliationScheduler');
const { acquireBillingReconciliationLock } = require('../lib/billingReconciliationLock');

const env = {
  NODE_ENV: 'test',
  STRIPE_PRO_PRICE: 'price_pro',
  STRIPE_UNLIMITED_PRICE: 'price_unlimited',
  STRIPE_PAST_DUE_GRACE_HOURS: '72'
};

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-billing-'));
  const databasePath = path.join(directory, 'test.db');
  const db = new Database(databasePath);
  runMigrationEngine(db, { env, logger: () => {} });
  return { directory, databasePath, db };
}

function closeFixture(value) {
  try { value.db.close(); } catch (_) {}
  fs.rmSync(value.directory, { recursive: true, force: true });
}

function remote(overrides = {}) {
  return {
    id: overrides.id || 'sub_1',
    customer: overrides.customer || 'cus_1',
    status: overrides.status || 'active',
    items: overrides.items === undefined ? { data: [{ price: { id: overrides.price || env.STRIPE_PRO_PRICE } }] } : overrides.items,
    current_period_start: overrides.currentPeriodStart ?? 1767225600,
    current_period_end: overrides.currentPeriodEnd ?? 1769904000,
    cancel_at_period_end: false,
    canceled_at: overrides.canceledAt ?? null,
    ended_at: overrides.endedAt ?? null
  };
}

function insertRelationship(db, overrides = {}) {
  const userId = Number(db.prepare(`
    INSERT INTO users(email, name, plan_tier, monthly_limit, stripe_customer_id)
    VALUES (?, 'Billing User', ?, ?, ?)
  `).run(
    overrides.email || `${Math.random()}@example.com`,
    overrides.userPlan || 'free',
    overrides.userLimit ?? 10,
    overrides.customer || 'cus_1'
  ).lastInsertRowid);
  const subscriptionId = Number(db.prepare(`
    INSERT INTO subscriptions(
      user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier, price_id,
      current_period_start, current_period_end, past_due_since
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, overrides.customer || 'cus_1', overrides.subscription || 'sub_1',
    overrides.status || 'active', overrides.subscriptionPlan || 'free',
    overrides.price || env.STRIPE_PRO_PRICE,
    '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', overrides.pastDueSince || null
  ).lastInsertRowid);
  return { userId, subscriptionId };
}

function fakeStripe(pages, options = {}) {
  const calls = [];
  return {
    calls,
    subscriptions: {
      list: async params => {
        calls.push(params);
        if (options.failAtCall === calls.length) throw Object.assign(new Error('secret provider detail'), { code: 'api_secret_code' });
        const page = pages[calls.length - 1] || { data: [], has_more: false };
        return page;
      }
    }
  };
}

function tableDigest(db, table) {
  return JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
}

function expectPolicyCode(fn, code) {
  assert.throws(fn, error => error instanceof BillingPolicyError && error.code === code);
}

async function run() {
  const now = new Date('2026-08-29T12:00:00.000Z');

  // One policy owns every supported Stripe status and exact price mapping.
  assert.deepStrictEqual(planForPrice(env.STRIPE_PRO_PRICE, env), { planTier: 'pro', monthlyLimit: 200, priceId: env.STRIPE_PRO_PRICE });
  assert.strictEqual(planForPrice('price_unknown', env), null);
  for (const status of ['active', 'trialing']) {
    assert.strictEqual(evaluateStripeEntitlement(remote({ status }), { env, now }).entitled, true);
  }
  for (const status of ['unpaid', 'incomplete', 'incomplete_expired', 'paused', 'canceled', 'deleted']) {
    const result = evaluateStripeEntitlement(remote({ status }), { env, now });
    assert.strictEqual(result.entitled, false, status);
    assert.strictEqual(result.planTier, 'free');
  }
  assert.strictEqual(evaluateStripeEntitlement(remote({ status: 'past_due' }), {
    env, now, pastDueSince: '2026-08-27T00:00:00.000Z'
  }).entitled, true);
  assert.strictEqual(evaluateStripeEntitlement(remote({ status: 'past_due' }), {
    env, now, pastDueSince: '2026-08-25T00:00:00.000Z'
  }).entitled, false);
  const unknownPastDueStart = evaluateStripeEntitlement(remote({ status: 'past_due' }), { env, now });
  assert.strictEqual(unknownPastDueStart.entitled, false);
  assert.strictEqual(unknownPastDueStart.issueCode, 'STRIPE_PAST_DUE_SINCE_UNKNOWN');
  expectPolicyCode(() => evaluateStripeEntitlement(remote({ status: 'future_status' }), { env, now }), 'STRIPE_STATUS_UNKNOWN');
  expectPolicyCode(() => evaluateStripeEntitlement(remote({ price: 'price_unknown' }), { env, now }), 'STRIPE_PRICE_UNKNOWN');
  expectPolicyCode(() => evaluateStripeEntitlement(remote({ items: { data: [] } }), { env, now }), 'STRIPE_RECORD_INCOMPLETE');
  expectPolicyCode(() => evaluateStripeEntitlement(remote({ customer: 'cus_other' }), { env, now, expectedCustomerId: 'cus_1' }), 'CUSTOMER_SUBSCRIPTION_MISMATCH');
  expectPolicyCode(() => evaluateStripeEntitlement(remote({ customer: { id: 'cus_1', deleted: true } }), { env, now }), 'STRIPE_CUSTOMER_MISSING');

  // v1 -> v2 is additive, records an intentionally rollback-incompatible ledger entry, and creates no business rows.
  {
    const value = fixture();
    try {
      assert.strictEqual(MIGRATIONS.at(-1), BILLING_RECONCILIATION_MIGRATION);
      assert.strictEqual(BILLING_RECONCILIATION_MIGRATION.rollbackCompatible, false);
      assert.strictEqual(value.db.prepare(`SELECT MAX(version) version FROM ${LEDGER_TABLE}`).get().version, 2);
      assert.ok(value.db.pragma('table_info(subscriptions)').some(column => column.name === 'past_due_since'));
      assert.strictEqual(value.db.prepare('SELECT COUNT(*) count FROM billing_reconciliation_runs').get().count, 0);
    } finally { closeFixture(value); }
  }

  {
    const value = fixture();
    try {
      value.db.close();
      fs.unlinkSync(value.databasePath);
      value.db = new Database(value.databasePath);
      runMigrationEngine(value.db, {
        registry: [BASELINE_MIGRATION], minVersion: 1, maxVersion: 1, env, logger: () => {}
      });
      const userId = Number(value.db.prepare("INSERT INTO users(email, name, plan_tier, monthly_limit) VALUES ('migration@example.com', 'Migration', 'pro', 200)").run().lastInsertRowid);
      const before = value.db.prepare('SELECT * FROM users WHERE id=?').get(userId);
      runMigrationEngine(value.db, { env, logger: () => {} });
      assert.deepStrictEqual(value.db.prepare('SELECT * FROM users WHERE id=?').get(userId), before);
      assert.strictEqual(value.db.prepare(`SELECT MAX(version) version FROM ${LEDGER_TABLE}`).get().version, 2);
    } finally { closeFixture(value); }
  }

  // Dry-run detects drift but changes no entitlement, subscription, usage, generation, or production state.
  {
    const value = fixture();
    try {
      const ids = insertRelationship(value.db);
      value.db.prepare(`INSERT INTO usage_periods(user_id, period_start, period_end, plan_tier, monthly_limit, usage_count) VALUES (?, ?, ?, 'free', 10, 3)`)
        .run(ids.userId, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
      const before = Object.fromEntries(['users', 'subscriptions', 'usage_periods', 'usage_events', 'generations', 'production_jobs'].map(table => [table, tableDigest(value.db, table)]));
      const stripe = fakeStripe([{ data: [remote()], has_more: false }]);
      const result = await reconcileBilling({ db: value.db, stripeClient: stripe, mode: 'dry_run', env, now: () => now, logger: () => {} });
      assert.deepStrictEqual({ drift: result.driftCount, repaired: result.repairedCount }, { drift: 1, repaired: 0 });
      for (const [table, digest] of Object.entries(before)) assert.strictEqual(tableDigest(value.db, table), digest, table);
      assert.strictEqual(value.db.prepare('SELECT resolution_status FROM billing_reconciliation_issues').get().resolution_status, 'detected');
    } finally { closeFixture(value); }
  }

  // Apply repairs missed activation, is idempotent, changes prices, and leaves accounting/history untouched.
  {
    const value = fixture();
    try {
      const ids = insertRelationship(value.db);
      const protectedTables = ['usage_periods', 'usage_events', 'generations', 'production_jobs'];
      const before = Object.fromEntries(protectedTables.map(table => [table, tableDigest(value.db, table)]));
      let stripe = fakeStripe([{ data: [remote()], has_more: false }]);
      let result = await reconcileBilling({ db: value.db, stripeClient: stripe, mode: 'apply', env, now: () => now, logger: () => {} });
      assert.strictEqual(result.repairedCount, 1);
      assert.deepStrictEqual(value.db.prepare('SELECT plan_tier, monthly_limit FROM users WHERE id=?').get(ids.userId), { plan_tier: 'pro', monthly_limit: 200 });
      stripe = fakeStripe([{ data: [remote()], has_more: false }]);
      result = await reconcileBilling({ db: value.db, stripeClient: stripe, mode: 'apply', env, now: () => now, logger: () => {} });
      assert.strictEqual(result.repairedCount, 0);
      stripe = fakeStripe([{ data: [remote({ price: env.STRIPE_UNLIMITED_PRICE })], has_more: false }]);
      result = await reconcileBilling({ db: value.db, stripeClient: stripe, mode: 'apply', env, now: () => now, logger: () => {} });
      assert.strictEqual(result.repairedCount, 1);
      assert.strictEqual(value.db.prepare('SELECT plan_tier FROM users WHERE id=?').get(ids.userId).plan_tier, 'unlimited');
      for (const [table, digest] of Object.entries(before)) assert.strictEqual(tableDigest(value.db, table), digest, table);
    } finally { closeFixture(value); }
  }

  // Terminal status revokes stale access; active status restores incorrectly revoked access.
  for (const scenario of [
    { localPlan: 'pro', localLimit: 200, remoteStatus: 'canceled', expected: 'free' },
    { localPlan: 'free', localLimit: 10, remoteStatus: 'active', expected: 'pro' }
  ]) {
    const value = fixture();
    try {
      const ids = insertRelationship(value.db, { userPlan: scenario.localPlan, userLimit: scenario.localLimit, subscriptionPlan: 'pro' });
      await reconcileBilling({ db: value.db, stripeClient: fakeStripe([{ data: [remote({ status: scenario.remoteStatus })], has_more: false }]), mode: 'apply', env, now: () => now, logger: () => {} });
      assert.strictEqual(value.db.prepare('SELECT plan_tier FROM users WHERE id=?').get(ids.userId).plan_tier, scenario.expected);
    } finally { closeFixture(value); }
  }

  // Unknown/malformed authority and relationship mismatch never mutate entitlement.
  for (const subscription of [
    remote({ price: 'price_unknown' }), remote({ status: 'future_status' }), remote({ items: { data: [] } }),
    remote({ customer: 'cus_mismatch' }), remote({ customer: { id: 'cus_1', deleted: true } })
  ]) {
    const value = fixture();
    try {
      const ids = insertRelationship(value.db, { userPlan: 'pro', userLimit: 200 });
      await reconcileBilling({ db: value.db, stripeClient: fakeStripe([{ data: [subscription], has_more: false }]), mode: 'apply', env, now: () => now, logger: () => {} });
      assert.deepStrictEqual(value.db.prepare('SELECT plan_tier, monthly_limit FROM users WHERE id=?').get(ids.userId), { plan_tier: 'pro', monthly_limit: 200 });
      assert.strictEqual(value.db.prepare('SELECT resolution_status FROM billing_reconciliation_issues ORDER BY id DESC LIMIT 1').get().resolution_status, 'unresolved');
    } finally { closeFixture(value); }
  }

  // Missing remote subscriptions and local paid accounts without a relationship are conservatively revoked in apply mode.
  {
    const value = fixture();
    try {
      const ids = insertRelationship(value.db, { userPlan: 'pro', userLimit: 200 });
      const orphanId = Number(value.db.prepare(`INSERT INTO users(email,name,plan_tier,monthly_limit) VALUES ('orphan@example.com','Orphan','pro',200)`).run().lastInsertRowid);
      const result = await reconcileBilling({ db: value.db, stripeClient: fakeStripe([{ data: [], has_more: false }]), mode: 'apply', env, now: () => now, logger: () => {} });
      assert(result.repairedCount >= 2);
      assert.strictEqual(value.db.prepare('SELECT plan_tier FROM users WHERE id=?').get(ids.userId).plan_tier, 'free');
      assert.strictEqual(value.db.prepare('SELECT plan_tier FROM users WHERE id=?').get(orphanId).plan_tier, 'free');
    } finally { closeFixture(value); }
  }

  // Pagination is bounded and a later Stripe failure occurs before any entitlement repair.
  {
    const value = fixture();
    try {
      const first = insertRelationship(value.db, { customer: 'cus_1', subscription: 'sub_1' });
      const second = insertRelationship(value.db, { customer: 'cus_2', subscription: 'sub_2' });
      const pages = [
        { data: [remote({ id: 'sub_1', customer: 'cus_1' })], has_more: true },
        { data: [remote({ id: 'sub_2', customer: 'cus_2' })], has_more: false }
      ];
      const stripe = fakeStripe(pages);
      const result = await reconcileBilling({ db: value.db, stripeClient: stripe, mode: 'apply', env, pageSize: 1, now: () => now, logger: () => {} });
      assert.strictEqual(stripe.calls[1].starting_after, 'sub_1');
      assert.strictEqual(result.inspectedCount, 2);
      assert.strictEqual(value.db.prepare('SELECT plan_tier FROM users WHERE id=?').get(second.userId).plan_tier, 'pro');

      value.db.prepare("UPDATE users SET plan_tier='free', monthly_limit=10 WHERE id IN (?,?)").run(first.userId, second.userId);
      await assert.rejects(() => reconcileBilling({
        db: value.db, stripeClient: fakeStripe(pages, { failAtCall: 2 }), mode: 'apply', env, pageSize: 1, now: () => now, logger: () => {}
      }), error => error.code === 'STRIPE_API_UNAVAILABLE');
      assert.strictEqual(value.db.prepare("SELECT COUNT(*) count FROM users WHERE id IN (?,?) AND plan_tier='pro'").get(first.userId, second.userId).count, 0);
    } finally { closeFixture(value); }
  }

  // Scheduler is opt-in, honors recent success, drains, and uses injected lock ownership.
  {
    assert.strictEqual(resolveBillingScheduleConfig({}).enabled, false);
    const value = fixture();
    try {
      let runs = 0;
      let released = 0;
      const scheduler = createBillingReconciliationScheduler({
        db: value.db, env, stripeClient: {}, now: () => now.getTime(),
        config: { enabled: true, intervalMs: 24 * 3600000, startupGraceMs: 1, pollMs: 10, shutdownGraceMs: 10, lockLeaseMs: 1000 },
        acquireLock: () => ({ release: () => { released += 1; return { released: true }; }, renew: () => true, leaseMs: 1000 }),
        startHeartbeat: () => () => {},
        runReconciliation: async () => { runs += 1; },
        setTimeoutFn: () => ({ unref() {} }), clearTimeoutFn: () => {}, logger: () => {}
      });
      await scheduler.tick();
      assert.strictEqual(runs, 1);
      assert.strictEqual(released, 1);
      assert.strictEqual((await scheduler.stop()).drained, true);

      value.db.prepare(`
        INSERT INTO billing_reconciliation_runs(mode, status, started_at, completed_at)
        VALUES ('dry_run', 'completed', ?, ?)
      `).run(now.toISOString(), now.toISOString());
      const dryRunDoesNotPostpone = createBillingReconciliationScheduler({
        db: value.db, env, stripeClient: {}, now: () => now.getTime(),
        config: { enabled: true, intervalMs: 24 * 3600000, startupGraceMs: 1, pollMs: 10, shutdownGraceMs: 10, lockLeaseMs: 1000 },
        acquireLock: () => ({ release: () => ({ released: true }), renew: () => true, leaseMs: 1000 }),
        startHeartbeat: () => () => {},
        runReconciliation: async () => { runs += 1; },
        setTimeoutFn: () => ({ unref() {} }), clearTimeoutFn: () => {}, logger: () => {}
      });
      await dryRunDoesNotPostpone.tick();
      assert.strictEqual(runs, 2, 'a dry-run must not postpone scheduled apply reconciliation');
      await dryRunDoesNotPostpone.stop();
    } finally { closeFixture(value); }
  }

  // Manual and scheduled apply paths share one token-owned cross-process lease.
  {
    const value = fixture();
    const lockEnv = { NODE_ENV: 'test', DATABASE_PATH: value.databasePath };
    let first;
    let replacement;
    try {
      first = acquireBillingReconciliationLock({ env: lockEnv, leaseMs: 1000 });
      assert.throws(
        () => acquireBillingReconciliationLock({ env: lockEnv, leaseMs: 1000 }),
        error => error.code === 'RECONCILIATION_LOCKED'
      );
      assert.strictEqual(first.release().released, true);
      first = null;
      replacement = acquireBillingReconciliationLock({ env: lockEnv, leaseMs: 1000 });
      assert.strictEqual(replacement.renew(), true);
    } finally {
      if (first) first.release();
      if (replacement) replacement.release();
      closeFixture(value);
    }
  }

  // The global work bound includes local orphan inspection, not only Stripe pages.
  {
    const value = fixture();
    try {
      insertRelationship(value.db);
      value.db.prepare("INSERT INTO users(email, name, plan_tier, monthly_limit) VALUES ('bounded@example.com', 'Bounded', 'pro', 200)").run();
      await assert.rejects(
        () => reconcileBilling({
          db: value.db,
          stripeClient: fakeStripe([{ data: [], has_more: false }]),
          mode: 'dry_run', env, maxRecords: 1, now: () => now, logger: () => {}
        }),
        error => error.code === 'RECONCILIATION_RECORD_LIMIT_EXCEEDED'
      );
    } finally { closeFixture(value); }
  }

  // Status contains operational summaries only, and durable issue references are hashed.
  {
    const value = fixture();
    try {
      insertRelationship(value.db);
      await reconcileBilling({ db: value.db, stripeClient: fakeStripe([{ data: [remote({ price: 'price_unknown' })], has_more: false }]), mode: 'dry_run', env, now: () => now, logger: () => {} });
      const status = getBillingReconciliationStatus(value.db, { enabled: false });
      assert.strictEqual(status.enabled, false);
      const serialized = JSON.stringify({ status, issues: value.db.prepare('SELECT * FROM billing_reconciliation_issues').all() });
      assert.doesNotMatch(serialized, /example\.com|cus_1|sub_1|secret/i);
    } finally { closeFixture(value); }
  }

  console.log('Story 3.20 Stripe Subscription Reconciliation tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
