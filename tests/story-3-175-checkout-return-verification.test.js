const assert = require('assert');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const {
  consumeBillingReturnNotice,
  createBillingReturnNotice,
  inspectBillingCheckoutReturn
} = require('../lib/billingCheckoutReturn');

async function run() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrationEngine(db, { logger: () => {} });
  db.prepare("INSERT INTO users(id,email,name,plan_tier,monthly_limit) VALUES (175,'return@example.com','Return','free',10)").run();
  db.prepare(`
    INSERT INTO subscription_checkout_intents(
      user_id, plan_tier, price_id, idempotency_key, stripe_checkout_session_id,
      expires_at, created_at, updated_at
    ) VALUES (175, 'pro', 'price_story_3175', 'return-intent', 'cs_story_3175', ?, ?, ?)
  `).run('2026-09-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
  const user = db.prepare('SELECT * FROM users WHERE id=175').get();
  const validSession = {
    id: 'cs_story_3175', status: 'complete', client_reference_id: '175',
    metadata: { copyquick_user_id: '175' }
  };

  assert.deepStrictEqual(await inspectBillingCheckoutReturn({
    db, user, sessionId: validSession.id, retrieveSession: async () => validSession
  }), { status: 'processing' });
  assert.deepStrictEqual(await inspectBillingCheckoutReturn({
    db, user, sessionId: validSession.id,
    retrieveSession: async () => ({ ...validSession, status: 'open' })
  }), { status: 'incomplete' });
  for (const scenario of [
    { sessionId: 'cs_unknown', session: validSession },
    { sessionId: validSession.id, session: { ...validSession, id: 'cs_different' } },
    { sessionId: validSession.id, session: { ...validSession, metadata: { copyquick_user_id: '176' } } }
  ]) {
    assert.deepStrictEqual(await inspectBillingCheckoutReturn({
      db, user, sessionId: scenario.sessionId, retrieveSession: async () => scenario.session
    }), { status: 'unavailable' });
  }
  assert.deepStrictEqual(await inspectBillingCheckoutReturn({
    db, user, sessionId: validSession.id, retrieveSession: async () => { throw new Error('sensitive provider failure'); }
  }), { status: 'unavailable' });
  assert.deepStrictEqual(await inspectBillingCheckoutReturn({
    db, user: { ...user, plan_tier: 'pro' }, sessionId: 'invalid', retrieveSession: async () => null
  }), { status: 'active' }, 'authoritative local paid state should be reported without a provider call');

  const session = { billingReturnNotice: createBillingReturnNotice('processing'), unrelated: 'preserved' };
  assert.deepStrictEqual(consumeBillingReturnNotice(session), {
    status: 'processing', message: 'Payment was received. Your plan is being activated now.'
  });
  assert.deepStrictEqual(session, { unrelated: 'preserved' }, 'only the one-time billing notice may be consumed');
  assert.strictEqual(createBillingReturnNotice('tampered'), null);

  const pricingSource = fs.readFileSync(require.resolve('../routes/pricing'), 'utf8');
  const dashboardSource = fs.readFileSync(require.resolve('../views/dashboard.ejs'), 'utf8');
  assert.match(pricingSource, /billing\/return\?session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.doesNotMatch(pricingSource, /dashboard\?session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.match(dashboardSource, /billingReturnNotice\.message/);

  db.close();
  console.log('Story 3.175 Checkout Return Verification tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
