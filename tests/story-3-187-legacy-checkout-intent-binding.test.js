const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { resolveCheckoutUser } = require('../lib/checkoutIdentity');

function run() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    runMigrationEngine(db, { logger: () => {} });
    db.prepare("INSERT INTO users(id,email,name) VALUES (187,'legacy187@example.com','Legacy 187')").run();
    db.prepare("INSERT INTO users(id,email,name) VALUES (188,'other188@example.com','Other 188')").run();
    db.prepare(`
      INSERT INTO subscription_checkout_intents(
        user_id, plan_tier, price_id, idempotency_key, stripe_checkout_session_id,
        expires_at, created_at, updated_at
      ) VALUES (187, 'pro', 'price_pro', 'intent-187', 'cs_legacy_187', ?, ?, ?)
    `).run('2026-09-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');

    const ownedLegacy = resolveCheckoutUser(db, {
      id: 'cs_legacy_187',
      customer_email: ' LEGACY187@EXAMPLE.COM '
    });
    assert.deepStrictEqual({
      valid: ownedLegacy.valid,
      legacy: ownedLegacy.legacy,
      userId: ownedLegacy.user?.id
    }, { valid: true, legacy: true, userId: 187 });

    for (const session of [
      { id: 'cs_unrecorded_187', customer_email: 'legacy187@example.com' },
      { id: 'cs_legacy_187', customer_email: 'other188@example.com' },
      { id: 'invalid', customer_email: 'legacy187@example.com' }
    ]) {
      const result = resolveCheckoutUser(db, session);
      assert.deepStrictEqual(result, { valid: false, legacy: true, user: null });
    }

    const modern = resolveCheckoutUser(db, {
      id: 'cs_modern_without_intent',
      client_reference_id: '188',
      metadata: { copyquick_user_id: '188' },
      customer_email: 'legacy187@example.com'
    });
    assert.strictEqual(modern.valid, true);
    assert.strictEqual(modern.legacy, false);
    assert.strictEqual(modern.user.id, 188,
      'immutable modern identity remains authoritative without email fallback');

    console.log('Story 3.187 Legacy Checkout Intent Binding tests passed');
  } finally {
    db.close();
  }
}

run();
