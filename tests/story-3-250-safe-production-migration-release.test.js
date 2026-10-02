const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { createDatabaseBackup } = require('../lib/databaseBackup');
const { restoreDatabase } = require('../lib/databaseRestore');
const { inspectReleaseMigrationReadiness } = require('../lib/releaseMigrationReadiness');
const { requireCompatibleMigrationState } = require('../lib/migrationStartupGate');
const { MIGRATIONS, inspectMigrationStatus, runMigrationEngine } = require('../db/migrations');
const { PRODUCTION_CONFIRMATION_FLAG, requireProductionConfirmation } = require('../scripts/migrate-database');

const projectRoot = path.join(__dirname, '..');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-3-250-'));
  const databasePath = path.join(root, 'copyquick.db');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_PATH: databasePath,
    PERSISTENT_DATA_DIR: root,
    DATABASE_BACKUP_DIR: path.join(root, 'backups')
  };
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  runMigrationEngine(db, { registry: MIGRATIONS.slice(0, 2), minVersion: 1, maxVersion: 2, logger: () => {} });
  return { root, databasePath, env, db };
}

function seedV2(db) {
  const userId = Number(db.prepare(`INSERT INTO users(email, name, generations_used) VALUES (?, ?, ?)`).run(
    'migration-release@example.test', 'Release Fixture', 3
  ).lastInsertRowid);
  const generationId = Number(db.prepare(`INSERT INTO generations(user_id, input_text, content_type, results, word_count) VALUES (?, ?, ?, ?, ?)`).run(
    userId, 'fixture input', 'blog_post', 'fixture output', 2
  ).lastInsertRowid);
  const subscriptionId = Number(db.prepare(`INSERT INTO subscriptions(
    user_id, stripe_customer_id, stripe_subscription_id, status, plan_tier, price_id,
    current_period_start, current_period_end
  ) VALUES (?, ?, ?, 'active', 'pro', ?, ?, ?)`).run(
    userId, 'cus_fixture', 'sub_fixture', 'price_fixture', '2026-09-01', '2026-10-01'
  ).lastInsertRowid);
  const usagePeriodId = Number(db.prepare(`INSERT INTO usage_periods(
    user_id, subscription_id, period_start, period_end, plan_tier, monthly_limit, usage_count
  ) VALUES (?, ?, ?, ?, 'pro', 100, 3)`).run(userId, subscriptionId, '2026-09-01', '2026-10-01').lastInsertRowid);
  db.prepare('UPDATE users SET current_usage_period_id = ? WHERE id = ?').run(usagePeriodId, userId);
  const runId = Number(db.prepare(`INSERT INTO production_runs(
    user_id, objective, status, plan_fingerprint, idempotency_key, approved_at,
    strategy_snapshot, production_cost_units, usage_period_id
  ) VALUES (?, 'improve_search_rankings', 'completed', ?, ?, ?, '{}', 1, ?)`).run(
    userId, 'v2-plan-fingerprint', 'v2-release-run', '2026-09-01T00:00:00.000Z', usagePeriodId
  ).lastInsertRowid);
  const usageEventId = Number(db.prepare(`INSERT INTO usage_events(
    user_id, usage_period_id, generation_id, event_type, units, source_route, production_run_id
  ) VALUES (?, ?, ?, 'production_start', 1, '/production', ?)`).run(
    userId, usagePeriodId, generationId, runId
  ).lastInsertRowid);
  db.prepare('UPDATE production_runs SET usage_event_id = ? WHERE id = ?').run(usageEventId, runId);
  db.prepare(`INSERT INTO sessions(id, data, expires_at) VALUES ('fixture-session', '{}', '2027-01-01')`).run();
  return { userId, generationId, subscriptionId, usagePeriodId, runId, usageEventId };
}

function assertSeedPreserved(db, ids) {
  assert.strictEqual(db.prepare('SELECT email FROM users WHERE id = ?').get(ids.userId).email, 'migration-release@example.test');
  assert.strictEqual(db.prepare('SELECT results FROM generations WHERE id = ?').get(ids.generationId).results, 'fixture output');
  assert.strictEqual(db.prepare('SELECT objective FROM production_runs WHERE id = ?').get(ids.runId).objective, 'improve_search_rankings');
  assert.strictEqual(db.prepare('SELECT status FROM subscriptions WHERE id = ?').get(ids.subscriptionId).status, 'active');
  assert.strictEqual(db.prepare('SELECT units FROM usage_events WHERE id = ?').get(ids.usageEventId).units, 1);
  assert.ok(db.prepare("SELECT 1 FROM sessions WHERE id = 'fixture-session'").get());
}

function releaseEnv(env) {
  return {
    ...env,
    SESSION_SECRET: 'synthetic-release-session-secret-over-thirty-two-characters',
    PUBLIC_APP_ORIGIN: 'https://copyquick.example',
    STRIPE_KEY: 'sk_live_synthetic',
    STRIPE_WEBHOOK_SECRET: 'whsec_synthetic',
    STRIPE_PRO_PRICE: 'price_synthetic_pro',
    STRIPE_UNLIMITED_PRICE: 'price_synthetic_unlimited',
    RESEND_API_KEY: 'synthetic',
    AI_PROVIDER: 'deterministic',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_CALLBACK_URL: '',
    OFFSITE_BACKUP_ENABLED: 'true',
    BACKUP_HEALTH_ALERTS_ENABLED: 'true',
    STRIPE_RECONCILIATION_ENABLED: 'true'
  };
}

async function run() {
  const render = fs.readFileSync(path.join(projectRoot, 'render.yaml'), 'utf8');
  assert.match(render, /startCommand:\s*node server\.js/);
  assert.doesNotMatch(render.match(/startCommand:.*$/m)[0], /migrat/i);
  const packageJson = require('../package.json');
  assert.strictEqual(packageJson.scripts.start, 'node server.js');
  assert.strictEqual(packageJson.scripts['migrate:database'], 'node scripts/migrate-database.js');
  assert.strictEqual(packageJson.scripts['migrations:check'], 'node scripts/migration-check.js');

  assert.throws(
    () => requireProductionConfirmation({ NODE_ENV: 'production' }, []),
    error => error.code === 'PRODUCTION_MIGRATION_CONFIRMATION_REQUIRED'
  );
  assert.doesNotThrow(() => requireProductionConfirmation({ NODE_ENV: 'production' }, [PRODUCTION_CONFIRMATION_FLAG]));
  assert.doesNotThrow(() => requireProductionConfirmation({ NODE_ENV: 'test' }, []));

  const value = fixture();
  let ids;
  try {
    ids = seedV2(value.db);
    const before = inspectMigrationStatus(value.db, { registry: MIGRATIONS.slice(0, 2), minVersion: 1, maxVersion: 2 });
    assert.strictEqual(before.currentVersion, 2);
    assert.strictEqual(inspectReleaseMigrationReadiness(value.env).code, 'MIGRATION_REQUIRED');

    const blocked = spawnSync(process.execPath, ['scripts/migrate-database.js'], {
      cwd: projectRoot, env: value.env, encoding: 'utf8'
    });
    assert.notStrictEqual(blocked.status, 0);
    assert.match(blocked.stderr, /PRODUCTION_MIGRATION_CONFIRMATION_REQUIRED/);
    assert.strictEqual(inspectMigrationStatus(value.db, { registry: MIGRATIONS.slice(0, 2), minVersion: 1, maxVersion: 2 }).currentVersion, 2);

    const backup = await createDatabaseBackup({ db: value.db, env: value.env, logger: () => {}, applyRetentionPolicy: false });
    assert.strictEqual(backup.success, true);
    const backupPath = path.join(value.env.DATABASE_BACKUP_DIR, backup.filename);
    assert.ok(fs.existsSync(backupPath));

    const migrated = runMigrationEngine(value.db, { logger: () => {} });
    assert.strictEqual(migrated.currentVersion, 8);
    assert.strictEqual(migrated.pendingCount, 0);
    assert.strictEqual(migrated.integrity, 'ok');
    assertSeedPreserved(value.db, ids);
    assert.ok(value.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_memory_subjects'").get());
    assert.ok(value.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_memory_records'").get());
    assert.strictEqual(value.db.prepare('SELECT COUNT(*) count FROM business_memory_subjects').get().count, 0);
    assert.strictEqual(value.db.prepare('SELECT COUNT(*) count FROM business_memory_records').get().count, 0);
    assert.strictEqual(inspectReleaseMigrationReadiness(value.env).safe, true);
    assert.doesNotThrow(() => requireCompatibleMigrationState({ db: value.db, logger: () => {} }));
    const releasePass = spawnSync(process.execPath, ['scripts/check-deployment-readiness.js'], {
      cwd: projectRoot, env: releaseEnv(value.env), encoding: 'utf8'
    });
    assert.strictEqual(releasePass.status, 0, releasePass.stdout + releasePass.stderr);
    assert.strictEqual(JSON.parse(releasePass.stdout.slice(releasePass.stdout.indexOf('\n{') + 1)).migration.currentVersion, 8);

    const secondPass = runMigrationEngine(value.db, { logger: () => {} });
    assert.strictEqual(secondPass.currentVersion, 8);
    assert.strictEqual(secondPass.pendingCount, 0);

    value.db.close();
    value.db = null;
    await restoreDatabase({
      source: backupPath,
      env: value.env,
      confirmApplicationStopped: true,
      confirmProductionRestore: true,
      logger: () => {}
    });
    const restored = new Database(value.databasePath, { readonly: true, fileMustExist: true });
    try {
      assert.strictEqual(restored.pragma('quick_check', { simple: true }), 'ok');
      assert.strictEqual(inspectMigrationStatus(restored, { registry: MIGRATIONS.slice(0, 2), minVersion: 1, maxVersion: 2 }).currentVersion, 2);
      assertSeedPreserved(restored, ids);
      assert.strictEqual(restored.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_memory_subjects'").get(), undefined);
    } finally { restored.close(); }
    const releaseBlocked = spawnSync(process.execPath, ['scripts/check-deployment-readiness.js'], {
      cwd: projectRoot, env: releaseEnv(value.env), encoding: 'utf8'
    });
    assert.notStrictEqual(releaseBlocked.status, 0);
    assert.match(releaseBlocked.stdout, /MIGRATION_REQUIRED/);
  } finally {
    if (value.db) value.db.close();
    fs.rmSync(value.root, { recursive: true, force: true });
  }

  const future = fixture();
  try {
    const v9 = {
      version: 9, name: 'future_schema_probe', kind: 'migration', policy: 'additive',
      rollbackCompatible: false, statements: ['CREATE TABLE future_schema_probe(id INTEGER PRIMARY KEY)']
    };
    runMigrationEngine(future.db, { registry: [...MIGRATIONS, v9], minVersion: 1, maxVersion: 9, logger: () => {} });
    assert.strictEqual(inspectReleaseMigrationReadiness(future.env).code, 'MIGRATION_INCOMPATIBLE');
  } finally {
    future.db.close();
    fs.rmSync(future.root, { recursive: true, force: true });
  }

  const failure = fixture();
  try {
    const failing = {
      version: 9,
      name: 'forced_release_failure',
      kind: 'migration',
      policy: 'additive',
      rollbackCompatible: false,
      statements: ['CREATE TABLE should_rollback(id INTEGER PRIMARY KEY)'],
      validate() { throw new Error('forced validation failure'); }
    };
    assert.throws(() => runMigrationEngine(failure.db, {
      registry: [...MIGRATIONS, failing], minVersion: 1, maxVersion: 9, logger: () => {}
    }), error => error.code === 'MIGRATION_FAILED');
    assert.strictEqual(inspectMigrationStatus(failure.db).currentVersion, 8);
    assert.strictEqual(failure.db.prepare("SELECT 1 FROM sqlite_master WHERE name='should_rollback'").get(), undefined);
  } finally {
    failure.db.close();
    fs.rmSync(failure.root, { recursive: true, force: true });
  }

  const runbook = fs.readFileSync(path.join(projectRoot, 'docs', 'DEPLOYMENT_READINESS_AUDIT.md'), 'utf8');
  for (const required of [
    'ACTUAL Render start command', 'node server.js', 'PRE_RELEASE_COMMIT',
    'PRE_MIGRATION_SCHEMA', 'PRE_MIGRATION_BACKUP_ID', 'PUBLIC_APP_ORIGIN',
    'deployment owner', 'migration owner', 'rollback owner', 'backup/restore owner',
    'go/no-go authority', 'DETERMINISTIC', 'OPENAI', 'ENABLED', 'DISABLED'
  ]) assert.ok(runbook.includes(required), `release runbook missing ${required}`);

  console.log('Story 3.250 safe production migration and release tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
