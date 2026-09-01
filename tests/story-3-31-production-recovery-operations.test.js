const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { BASELINE_SCHEMA_SQL } = require('../db/schema');
const { initDb } = require('../db/init');
const { acquireRuntimeLock } = require('../lib/databaseRuntimeLock');
const { applyProductionRecovery, inspectProductionRecovery } = require('../lib/productionRecovery');
const { parseArguments } = require('../scripts/production-recovery');
const { getProductionContract } = require('../lib/productionContracts');

function createDb() {
  const db = new Database(':memory:');
  db.exec(BASELINE_SCHEMA_SQL);
  db.pragma('foreign_keys = ON');
  return db;
}

function createRecoveryRun(db, suffix) {
  const userId = Number(db.prepare(`
    INSERT INTO users(email, name, generations_used, monthly_limit, current_period_used)
    VALUES (?, 'Recovery Owner', 2, 100, 2)
  `).run(`recovery-${suffix}@example.com`).lastInsertRowid);
  const usagePeriodId = Number(db.prepare(`
    INSERT INTO usage_periods(user_id, period_start, period_end, plan_tier, monthly_limit, usage_count)
    VALUES (?, '2026-08-01', '2026-09-01', 'pro', 100, 2)
  `).run(userId).lastInsertRowid);
  db.prepare('UPDATE users SET current_usage_period_id = ? WHERE id = ?').run(usagePeriodId, userId);
  const runId = Number(db.prepare(`
    INSERT INTO production_runs(
      user_id, objective, status, plan_fingerprint, idempotency_key, approved_at,
      strategy_snapshot, production_cost_units, usage_period_id
    ) VALUES (?, 'launch_product', 'blocked', ?, ?, CURRENT_TIMESTAMP, '{}', 2, ?)
  `).run(userId, `fingerprint-${suffix}`, `recovery-key-${suffix}`, usagePeriodId).lastInsertRowid);
  const rootJobId = Number(db.prepare(`
    INSERT INTO production_jobs(
      production_run_id, deliverable_id, title, phase, sequence_order, status,
      strategic_direction, strategy_snapshot, dependencies, attempt_count, max_attempts,
      last_error_code, recovery_reason
    ) VALUES (?, 'customer_profile', 'Customer Profile', 'foundation', 0, 'recovery_required',
      'Direction', '{}', '[]', 1, 3, 'PROVIDER_TIMEOUT', 'Ambiguous provider result')
  `).run(runId).lastInsertRowid);
  const childJobId = Number(db.prepare(`
    INSERT INTO production_jobs(
      production_run_id, deliverable_id, title, phase, sequence_order, status,
      strategic_direction, strategy_snapshot, dependencies, attempt_count, max_attempts
    ) VALUES (?, 'product_positioning', 'Product Positioning', 'foundation', 1, 'waiting_dependency',
      'Direction', '{}', '["customer_profile"]', 0, 3)
  `).run(runId).lastInsertRowid);
  return { userId, usagePeriodId, runId, rootJobId, childJobId };
}

function run() {
  const db = createDb();
  const retryRun = createRecoveryRun(db, 'retry');
  const summary = inspectProductionRecovery(db);
  assert.strictEqual(summary.recoveryRequiredCount, 1);
  assert.strictEqual(summary.failedCount, 0);
  assert.strictEqual(summary.issueCount, 1);
  assert.deepStrictEqual(summary.issues[0], {
    runId: retryRun.runId,
    jobId: retryRun.rootJobId,
    deliverableId: 'customer_profile',
    status: 'recovery_required',
    attemptCount: 1,
    maxAttempts: 3,
    failureCode: 'PROVIDER_TIMEOUT',
    updatedAt: summary.issues[0].updatedAt
  });
  assert(!JSON.stringify(summary).includes('@example.com'));

  assert.deepStrictEqual(applyProductionRecovery(db, {
    productionRunId: retryRun.runId, productionJobId: retryRun.rootJobId, action: 'safe_retry'
  }), { valid: false, code: 'PRODUCTION_RECOVERY_VERIFICATION_REQUIRED' });
  let result = applyProductionRecovery(db, {
    productionRunId: retryRun.runId, productionJobId: retryRun.rootJobId,
    action: 'safe_retry', verifiedSafe: true
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE id = ?').get(retryRun.rootJobId).status, 'queued');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM production_job_events WHERE production_job_id = ? AND event_type = 'job_recovered'").get(retryRun.rootJobId).count, 1);
  assert.strictEqual(applyProductionRecovery(db, {
    productionRunId: retryRun.runId, productionJobId: retryRun.rootJobId,
    action: 'safe_retry', verifiedSafe: true
  }).valid, false, 'an already reconciled job must not be changed twice');

  const completedRun = createRecoveryRun(db, 'completed');
  const customerProfile = {
    summary: 'Independent retailers need a dependable way to launch clearly.',
    primaryCustomer: 'Independent retailers',
    needs: ['A clear launch plan'],
    motivations: ['Confident growth'],
    objections: ['Unproven claims'],
    buyingTriggers: ['Clear evidence'],
    languageStyle: 'Direct and practical'
  };
  const generationId = Number(db.prepare(`
    INSERT INTO generations(
      user_id, title, input_text, content_type, results, generation_type,
      production_job_id, deliverable_id, contract_version, structured_result
    ) VALUES (?, 'Customer Profile', 'internal', 'sales_message', '[]', 'production',
      ?, 'customer_profile', ?, ?)
  `).run(
    completedRun.userId,
    completedRun.rootJobId,
    getProductionContract('customer_profile').version,
    JSON.stringify(customerProfile)
  ).lastInsertRowid);
  result = applyProductionRecovery(db, {
    productionRunId: completedRun.runId, productionJobId: completedRun.rootJobId,
    action: 'mark_completed', generationId, verifiedSafe: true
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE id = ?').get(completedRun.rootJobId).status, 'completed');
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE id = ?').get(completedRun.childJobId).status, 'queued');

  const failedRun = createRecoveryRun(db, 'failed');
  result = applyProductionRecovery(db, {
    productionRunId: failedRun.runId, productionJobId: failedRun.rootJobId,
    action: 'mark_failed', verifiedSafe: true
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.outcome, 'permanent_failure');
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE id = ?').get(failedRun.rootJobId).status, 'failed');
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE id = ?').get(failedRun.childJobId).status, 'skipped');
  assert.strictEqual(db.prepare('SELECT usage_count FROM usage_periods WHERE id = ?').get(failedRun.usagePeriodId).usage_count, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM usage_events WHERE production_run_id = ? AND event_type = 'production_reversal'").get(failedRun.runId).count, 2);

  const rollbackRun = createRecoveryRun(db, 'rollback');
  db.exec(`CREATE TRIGGER fail_recovery_reversal BEFORE INSERT ON usage_events
    WHEN NEW.production_run_id = ${rollbackRun.runId}
    BEGIN SELECT RAISE(ABORT, 'forced recovery rollback'); END;`);
  assert.throws(() => applyProductionRecovery(db, {
    productionRunId: rollbackRun.runId, productionJobId: rollbackRun.rootJobId,
    action: 'mark_failed', verifiedSafe: true
  }), /forced recovery rollback/);
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE id = ?').get(rollbackRun.rootJobId).status, 'recovery_required',
    'failed recovery resolution must roll back its synthetic claim');
  db.exec('DROP TRIGGER fail_recovery_reversal');

  assert.deepStrictEqual(parseArguments([]), { mode: 'status' });
  assert.deepStrictEqual(parseArguments(['--safe-retry', '--run-id', '2', '--job-id', '3', '--verified-safe']), {
    mode: 'apply', action: 'safe_retry', productionRunId: 2, productionJobId: 3, verifiedSafe: true
  });
  assert.strictEqual(parseArguments(['--safe-retry', '--run-id', '2', '--job-id', '3']), null);
  assert.strictEqual(parseArguments(['--safe-retry', '--run-id', '2', '--job-id', '3', '--verified-safe', '--typo']), null);
  assert.strictEqual(parseArguments(['--safe-retry', '--run-id', '2', '--run-id', '4', '--job-id', '3', '--verified-safe']), null);
  assert.strictEqual(parseArguments(['--safe-retry', '--run-id', '2', '--job-id', '3', '--generation-id', '4', '--verified-safe']), null);
  assert.strictEqual(parseArguments(['--mark-completed', '--run-id', '2', '--job-id', '3', '--verified-safe']), null);

  db.close();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-recovery-cli-'));
  const databasePath = path.join(root, 'copyquick.db');
  const fileDb = new Database(databasePath);
  initDb({ db: fileDb, env: { NODE_ENV: 'test' }, logger: () => {} });
  fileDb.close();
  const release = acquireRuntimeLock(databasePath);
  const script = path.join(__dirname, '..', 'scripts', 'production-recovery.js');
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath };
  let cli = spawnSync(process.execPath, [script, '--status'], { env, encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert(!cli.stdout.includes(databasePath));
  cli = spawnSync(process.execPath, [script, '--safe-retry', '--run-id', '1', '--job-id', '1', '--verified-safe'], { env, encoding: 'utf8' });
  assert.strictEqual(cli.status, 1);
  assert.strictEqual(JSON.parse(cli.stderr).code, 'PRODUCTION_RUNTIME_ACTIVE');
  release();
  fs.rmSync(root, { recursive: true, force: true });

  console.log('Story 3.31 Production Recovery Operations tests passed');
}

try { run(); } catch (error) {
  console.error(error);
  process.exitCode = 1;
}
