const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { initDb } = require('../db/init');
const { buildOperationalStatus, exitCodeForOperationalStatus } = require('../lib/operationalStatus');

function healthy(overrides = {}) {
  return {
    production: true,
    migration: { safe: true, code: 'MIGRATION_COMPATIBLE', currentVersion: 3, pendingCount: 0 },
    storage: {
      status: 'healthy', quickCheck: 'ok', capacityStatus: 'healthy', freePercent: 70,
      localBackupStatus: 'healthy', latestVerifiedBackupAt: '2026-08-31T10:00:00.000Z',
      offsiteEnabled: true, offsiteStatus: 'healthy', offsiteScheduleEnabled: true,
      offsiteLastSuccessAt: '2026-08-31T11:00:00.000Z'
    },
    billing: {
      enabled: true, lastRunAt: '2026-08-31T12:00:00.000Z', lastSuccessAt: '2026-08-31T12:01:00.000Z',
      lastFailureCode: null, driftCount: 2, unresolvedCount: 0, lastMode: 'apply'
    },
    generation: { mode: 'running', code: 'GENERATION_CONTROL_ACTIVE' },
    productionRecovery: { recoveryRequiredCount: 0, failedCount: 4, skippedCount: 2 },
    ...overrides
  };
}

function codes(status) { return status.conditions.map(item => item.code); }

function run() {
  let status = buildOperationalStatus(healthy());
  assert.strictEqual(status.status, 'healthy');
  assert.strictEqual(exitCodeForOperationalStatus(status), 0);
  assert.strictEqual(status.production.failedCount, 4, 'historical resolved failures remain visible without holding health open');
  assert(!codes(status).includes('BILLING_DRIFT_DETECTED'), 'repaired apply drift is not outstanding drift');

  status = buildOperationalStatus(healthy({
    billing: { ...healthy().billing, lastMode: 'dry_run', driftCount: 2 }
  }));
  assert.strictEqual(status.status, 'warning');
  assert(codes(status).includes('BILLING_DRIFT_DETECTED'));
  assert.strictEqual(exitCodeForOperationalStatus(status), 1);

  status = buildOperationalStatus(healthy({
    billing: { ...healthy().billing, lastFailureCode: 'STRIPE_API_UNAVAILABLE', unresolvedCount: 3 },
    productionRecovery: { recoveryRequiredCount: 1, failedCount: 0, skippedCount: 0 }
  }));
  assert.strictEqual(status.status, 'critical');
  assert(codes(status).includes('BILLING_RECONCILIATION_FAILED'));
  assert(codes(status).includes('BILLING_RECONCILIATION_UNRESOLVED'));
  assert(codes(status).includes('PRODUCTION_RECOVERY_REQUIRED'));
  assert.strictEqual(exitCodeForOperationalStatus(status), 2);

  status = buildOperationalStatus(healthy({
    generation: { mode: 'paused', code: 'GENERATION_PAUSED', updatedAt: '2026-08-31T12:00:00.000Z' }
  }));
  assert.strictEqual(status.status, 'warning');
  assert(codes(status).includes('GENERATION_OPERATOR_PAUSED'));
  status = buildOperationalStatus(healthy({
    generation: { mode: 'paused', code: 'GENERATION_CONTROL_UNAVAILABLE' }
  }));
  assert.strictEqual(status.status, 'critical');

  status = buildOperationalStatus(healthy({
    migration: { safe: false, code: 'MIGRATION_REQUIRED' },
    storage: { ...healthy().storage, offsiteStatus: 'critical' }
  }));
  assert.strictEqual(status.status, 'critical');
  assert(codes(status).includes('MIGRATION_REQUIRED'));
  assert(codes(status).includes('OFFSITE_BACKUP_CRITICAL'));

  status = buildOperationalStatus(healthy({
    billing: { ...healthy().billing, lastFailureCode: 'private error with spaces' },
    generation: { mode: 'paused', code: 'unsafe/path', updatedAt: 'not-a-date' }
  }));
  assert.strictEqual(status.billing.lastFailureCode, 'RECONCILIATION_FAILED');
  assert.strictEqual(status.generation.code, 'GENERATION_CONTROL_UNAVAILABLE');
  assert.strictEqual(status.generation.updatedAt, null);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-operations-status-'));
  const databasePath = path.join(root, 'copyquick.db');
  const backupDirectory = path.join(root, 'backups');
  fs.mkdirSync(backupDirectory);
  const db = new Database(databasePath);
  initDb({ db, env: { NODE_ENV: 'test' }, logger: () => {} });
  db.close();
  fs.copyFileSync(databasePath, path.join(backupDirectory, 'copyquick-2026-08-31T120000Z.db'));
  const script = path.join(__dirname, '..', 'scripts', 'operations-status.js');
  const env = {
    ...process.env,
    NODE_ENV: 'test', DATABASE_PATH: databasePath, DATABASE_BACKUP_DIR: backupDirectory,
    OFFSITE_BACKUP_ENABLED: 'false', STRIPE_RECONCILIATION_ENABLED: 'false',
    DATABASE_STORAGE_WARNING_FREE_BYTES: '0', DATABASE_STORAGE_CRITICAL_FREE_BYTES: '0',
    DATABASE_STORAGE_WARNING_FREE_PERCENT: '0', DATABASE_STORAGE_CRITICAL_FREE_PERCENT: '0',
    RESEND_API_KEY: 'must-not-appear', STRIPE_KEY: 'must-not-appear'
  };
  const cli = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stderr);
  const output = JSON.parse(cli.stdout);
  assert.strictEqual(output.status, 'healthy');
  assert.strictEqual(output.migration.currentVersion, 3);
  assert.strictEqual(output.storage.quickCheck, 'ok');
  assert.strictEqual(output.generation.mode, 'running');
  assert(!cli.stdout.includes(databasePath));
  assert(!cli.stdout.includes('must-not-appear'));
  assert(!cli.stdout.includes('@'));
  assert.strictEqual(spawnSync(process.execPath, [script, '--unknown'], { env, encoding: 'utf8' }).status, 2);
  fs.rmSync(root, { recursive: true, force: true });

  console.log('Story 3.32 Unified Production Operations Status tests passed');
}

try { run(); } catch (error) {
  console.error(error);
  process.exitCode = 1;
}
