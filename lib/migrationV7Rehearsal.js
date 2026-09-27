const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createDatabaseBackup, verifySqliteBackup } = require('./databaseBackup');
const { restoreDatabase } = require('./databaseRestore');
const { MIGRATIONS, inspectMigrationStatus, runMigrationEngine } = require('../db/migrations');

function assertRehearsal(condition, code) {
  if (condition) return;
  const error = new Error('Migration v7 rehearsal failed.');
  error.code = code;
  throw error;
}

function seedVersionSixDatabase(db) {
  runMigrationEngine(db, {
    registry: MIGRATIONS.slice(0, 6), minVersion: 1, maxVersion: 6, logger: () => {}
  });
  const userId = Number(db.prepare(`
    INSERT INTO users(email, name) VALUES('migration-v7-rehearsal@example.test', 'Migration Rehearsal')
  `).run().lastInsertRowid);
  const runId = Number(db.prepare(`
    INSERT INTO production_runs(
      user_id, objective, status, plan_fingerprint, idempotency_key,
      approved_at, strategy_snapshot, production_cost_units
    ) VALUES (?, 'launch_product', 'running', 'migration-v7-rehearsal-plan',
      'migration-v7-rehearsal-run', CURRENT_TIMESTAMP, '{}', 0)
  `).run(userId).lastInsertRowid);
  db.prepare(`
    INSERT INTO production_jobs(
      production_run_id, deliverable_id, title, phase, sequence_order,
      status, strategic_direction, strategy_snapshot, dependencies
    ) VALUES (?, 'customer_profile', 'Customer Profile', 'define', 0,
      'completed', 'Define the customer.', '{}', '[]')
  `).run(runId);
  return { userId, runId };
}

function preservedRows(db, fixture) {
  return {
    user: db.prepare('SELECT email, name FROM users WHERE id = ?').get(fixture.userId),
    run: db.prepare('SELECT objective, status, plan_fingerprint FROM production_runs WHERE id = ?').get(fixture.runId),
    jobs: db.prepare('SELECT deliverable_id, status FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(fixture.runId)
  };
}

async function rehearseMigrationV7({ rootDirectory, keepArtifacts = false, logger = () => {} } = {}) {
  const v7Registry = MIGRATIONS.slice(0, 7);
  const v7Options = { registry: v7Registry, minVersion: 1, maxVersion: 7 };
  const ownedRoot = !rootDirectory;
  const root = rootDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-migration-v7-rehearsal-'));
  const databasePath = path.join(root, 'copyquick.db');
  const backupDirectory = path.join(root, 'backups');
  const env = {
    NODE_ENV: 'test', DATABASE_PATH: databasePath, DATABASE_BACKUP_DIR: backupDirectory,
    DATABASE_BACKUP_RETENTION: '7'
  };
  let db;
  try {
    db = new Database(databasePath);
    const fixture = seedVersionSixDatabase(db);
    const before = preservedRows(db, fixture);
    const preMigrationStatus = inspectMigrationStatus(db, v7Options);
    assertRehearsal(preMigrationStatus.currentVersion === 6 && preMigrationStatus.pendingCount === 1, 'V6_FIXTURE_INVALID');

    const backup = await createDatabaseBackup({ db, env, logger, applyRetentionPolicy: false });
    const backupPath = path.join(backupDirectory, backup.filename);
    assertRehearsal(verifySqliteBackup(backupPath).quickCheck === 'ok', 'PRE_MIGRATION_BACKUP_INVALID');

    const migrated = runMigrationEngine(db, { ...v7Options, logger });
    assertRehearsal(migrated.currentVersion === 7 && migrated.pendingCount === 0, 'V7_MIGRATION_INCOMPLETE');
    assertRehearsal(db.pragma('table_info(production_runs)').some(column => column.name === 'production_plan_snapshot'), 'V7_COLUMN_MISSING');
    assertRehearsal(JSON.stringify(preservedRows(db, fixture)) === JSON.stringify(before), 'BUSINESS_ROWS_CHANGED');
    db.close();
    db = null;

    db = new Database(databasePath);
    const restartedStatus = inspectMigrationStatus(db, v7Options);
    assertRehearsal(restartedStatus.currentVersion === 7 && restartedStatus.pendingCount === 0, 'V7_RESTART_INVALID');
    const secondPass = runMigrationEngine(db, { ...v7Options, logger });
    assertRehearsal(secondPass.pendingCount === 0, 'V7_REAPPLIED');
    db.prepare('UPDATE production_runs SET production_plan_snapshot = ? WHERE id = ?')
      .run(JSON.stringify({ planFingerprint: 'migration-v7-rehearsal-plan', displayName: 'Migration V7 Rehearsal', selectedDeliverables: [] }), fixture.runId);
    assertRehearsal(Boolean(db.prepare('SELECT production_plan_snapshot FROM production_runs WHERE id = ?').get(fixture.runId).production_plan_snapshot), 'V7_SNAPSHOT_WRITE_FAILED');
    db.close();
    db = null;

    await restoreDatabase({
      source: backupPath, env, confirmApplicationStopped: true, logger
    });
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    const restoredStatus = inspectMigrationStatus(db, v7Options);
    assertRehearsal(restoredStatus.currentVersion === 6 && restoredStatus.pendingCount === 1, 'V6_RESTORE_INVALID');
    assertRehearsal(!db.pragma('table_info(production_runs)').some(column => column.name === 'production_plan_snapshot'), 'RESTORE_RETAINED_V7_SCHEMA');
    assertRehearsal(JSON.stringify(preservedRows(db, fixture)) === JSON.stringify(before), 'RESTORED_ROWS_CHANGED');
    db.close();
    db = null;

    return {
      ok: true,
      fixtureVersion: 6,
      migratedVersion: 7,
      migrationAppliedOnce: true,
      restartVerified: true,
      businessRowsPreserved: true,
      preMigrationBackupVerified: true,
      restoreVerified: true,
      restoredVersion: 6,
      artifactsRetained: Boolean(keepArtifacts),
      ...(keepArtifacts ? { rootDirectory: root } : {})
    };
  } finally {
    if (db) db.close();
    if (ownedRoot && !keepArtifacts) fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { rehearseMigrationV7, seedVersionSixDatabase };
