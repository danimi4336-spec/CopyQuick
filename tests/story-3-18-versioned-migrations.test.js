const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { BASELINE_SCHEMA_SQL } = require('../db/schema');
const {
  BASELINE_MIGRATION,
  LEDGER_TABLE,
  MigrationError,
  initializeDatabaseForStartup,
  inspectMigrationStatus,
  migrationChecksum,
  runMigrationEngine,
  validateMigrationRegistry,
  verifyBaselineStructure
} = require('../db/migrations');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-migrations-'));
  const databasePath = path.join(directory, 'fixture.db');
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  return { directory, databasePath, db };
}

function closeFixture(value) {
  try { value.db.close(); } catch (_) {}
  fs.rmSync(value.directory, { recursive: true, force: true });
}

function productionShape(db) {
  db.exec(BASELINE_SCHEMA_SQL);
}

function additive(version, name, statements, validate) {
  return {
    version,
    name,
    kind: 'migration',
    policy: 'additive',
    rollbackCompatible: true,
    statements,
    validate
  };
}

function assertCode(fn, code) {
  assert.throws(fn, error => error instanceof MigrationError && error.code === code);
}

async function run() {
  // Fresh databases are created exclusively through the baseline migration.
  {
    const value = fixture();
    try {
      const result = runMigrationEngine(value.db, { logger: () => {} });
      assert.strictEqual(result.currentVersion, 1);
      assert.strictEqual(result.pendingCount, 0);
      assert.strictEqual(value.db.prepare(`SELECT COUNT(*) count FROM ${LEDGER_TABLE}`).get().count, 1);
      assert.strictEqual(verifyBaselineStructure(value.db), true);
    } finally { closeFixture(value); }
  }

  {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-migrate-cli-'));
    const databasePath = path.join(directory, 'cli.db');
    try {
      const migrated = spawnSync(process.execPath, ['scripts/migrate-database.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath },
        encoding: 'utf8'
      });
      assert.strictEqual(migrated.status, 0, migrated.stderr);
      assert.match(migrated.stdout, /"event":"database_migration_complete"/);
      const db = new Database(databasePath, { readonly: true, fileMustExist: true });
      assert.strictEqual(inspectMigrationStatus(db).currentVersion, 1);
      db.close();
      assert.strictEqual(fs.existsSync(`${databasePath}.runtime-lock`), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  // Existing production-shaped databases are structurally adopted without row rewrites.
  {
    const value = fixture();
    try {
      productionShape(value.db);
      value.db.prepare(`INSERT INTO users(email, name, generations_used) VALUES (?, ?, ?)`)
        .run('baseline@example.com', 'Untouched', 7);
      const before = value.db.prepare('SELECT * FROM users WHERE email = ?').get('baseline@example.com');
      const status = inspectMigrationStatus(value.db);
      assert.strictEqual(status.baselineStatus, 'adoption_required');
      runMigrationEngine(value.db, { logger: () => {} });
      const after = value.db.prepare('SELECT * FROM users WHERE email = ?').get('baseline@example.com');
      assert.deepStrictEqual(after, before);
      assert.strictEqual(value.db.prepare(`SELECT COUNT(*) count FROM ${LEDGER_TABLE}`).get().count, 1);
    } finally { closeFixture(value); }
  }

  // Partial legacy databases fail closed: table, column, index, and unexpected-table cases.
  for (const mutate of [
    db => db.exec('DROP TABLE production_job_events'),
    db => db.exec('ALTER TABLE users DROP COLUMN builder_goal'),
    db => db.exec('DROP INDEX idx_generations_user_id'),
    db => db.exec('CREATE TABLE unexpected_legacy_state(id INTEGER)')
  ]) {
    const value = fixture();
    try {
      productionShape(value.db);
      mutate(value.db);
      assertCode(() => inspectMigrationStatus(value.db), 'BASELINE_STRUCTURE_INVALID');
      assert.strictEqual(value.db.prepare(`SELECT 1 FROM sqlite_master WHERE name = '${LEDGER_TABLE}'`).get(), undefined);
    } finally { closeFixture(value); }
  }

  {
    const value = fixture();
    try {
      value.db.exec(BASELINE_SCHEMA_SQL.replace('email TEXT UNIQUE NOT NULL', 'email TEXT NOT NULL'));
      assertCode(() => inspectMigrationStatus(value.db), 'BASELINE_STRUCTURE_INVALID');
    } finally { closeFixture(value); }
  }

  const v2 = additive(2, 'add_migration_probe', ['CREATE TABLE migration_probe(id INTEGER PRIMARY KEY)']);
  const v3 = additive(3, 'add_migration_probe_index', ['CREATE INDEX idx_migration_probe_id ON migration_probe(id)']);
  const registry = [BASELINE_MIGRATION, v2, v3];

  // Ordering is deterministic and every migration applies exactly once.
  {
    const value = fixture();
    try {
      const first = runMigrationEngine(value.db, { registry, minVersion: 1, maxVersion: 3, logger: () => {} });
      const second = runMigrationEngine(value.db, { registry, minVersion: 1, maxVersion: 3, logger: () => {} });
      assert.strictEqual(first.currentVersion, 3);
      assert.strictEqual(second.pendingCount, 0);
      assert.deepStrictEqual(value.db.prepare(`SELECT version FROM ${LEDGER_TABLE} ORDER BY version`).all().map(row => row.version), [1, 2, 3]);
      assert.strictEqual(value.db.prepare(`SELECT COUNT(*) count FROM ${LEDGER_TABLE}`).get().count, 3);
    } finally { closeFixture(value); }
  }

  // Historical checksums are immutable.
  {
    const value = fixture();
    try {
      runMigrationEngine(value.db, { logger: () => {} });
      value.db.prepare(`UPDATE ${LEDGER_TABLE} SET checksum = ? WHERE version = 1`).run('0'.repeat(64));
      assertCode(() => inspectMigrationStatus(value.db), 'MIGRATION_CHECKSUM_MISMATCH');
      assert.notStrictEqual(migrationChecksum(BASELINE_MIGRATION), '0'.repeat(64));
    } finally { closeFixture(value); }
  }

  // A migration failure rolls back its DDL and ledger row, stops later work, and can be retried.
  {
    const value = fixture();
    const failing = additive(2, 'transactional_probe', [
      'CREATE TABLE rollback_probe(id INTEGER PRIMARY KEY)',
      'CREATE INDEX idx_missing_table ON missing_table(id)'
    ]);
    const later = additive(3, 'later_probe', ['CREATE TABLE later_probe(id INTEGER PRIMARY KEY)']);
    try {
      assertCode(() => runMigrationEngine(value.db, {
        registry: [BASELINE_MIGRATION, failing, later], minVersion: 1, maxVersion: 3, logger: () => {}
      }), 'MIGRATION_FAILED');
      assert.strictEqual(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='rollback_probe'").get(), undefined);
      assert.strictEqual(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='later_probe'").get(), undefined);
      assert.strictEqual(value.db.prepare(`SELECT 1 FROM ${LEDGER_TABLE} WHERE version=2`).get(), undefined);

      const corrected = additive(2, 'transactional_probe', ['CREATE TABLE rollback_probe(id INTEGER PRIMARY KEY)']);
      runMigrationEngine(value.db, {
        registry: [BASELINE_MIGRATION, corrected, later], minVersion: 1, maxVersion: 3, logger: () => {}
      });
      assert.ok(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='later_probe'").get());
    } finally { closeFixture(value); }
  }

  // Compatibility bounds reject ledgered schemas outside the declared range.
  {
    const old = fixture();
    try {
      runMigrationEngine(old.db, { logger: () => {} });
      assertCode(() => inspectMigrationStatus(old.db, { registry, minVersion: 2, maxVersion: 3 }), 'SCHEMA_VERSION_TOO_OLD');
    } finally { closeFixture(old); }

    const newer = fixture();
    try {
      runMigrationEngine(newer.db, { registry: [BASELINE_MIGRATION, v2], minVersion: 1, maxVersion: 2, logger: () => {} });
      assertCode(() => inspectMigrationStatus(newer.db), 'SCHEMA_VERSION_TOO_NEW');
    } finally { closeFixture(newer); }
  }

  {
    const invalidBounds = fixture();
    try {
      assertCode(() => inspectMigrationStatus(invalidBounds.db, {
        registry: [BASELINE_MIGRATION, v2], minVersion: 1, maxVersion: 1
      }), 'SCHEMA_COMPATIBILITY_CONFIG_INVALID');
    } finally { closeFixture(invalidBounds); }
  }

  // Pending production migration requires a successful verified backup first.
  {
    const value = fixture();
    try {
      runMigrationEngine(value.db, { logger: () => {} });
      let backups = 0;
      const events = [];
      await initializeDatabaseForStartup(value.db, {
        env: { NODE_ENV: 'production' }, registry: [BASELINE_MIGRATION, v2], minVersion: 1, maxVersion: 2,
        createBackup: async () => {
          backups += 1;
          assert.strictEqual(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='migration_probe'").get(), undefined);
          events.push('backup');
          return { success: true };
        },
        logger: entry => events.push(entry.event)
      });
      assert.strictEqual(backups, 1);
      assert.strictEqual(events[0], 'backup');
      assert.ok(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='migration_probe'").get());
    } finally { closeFixture(value); }
  }

  // No pending migration creates no backup; backup failure prevents all migration writes.
  {
    const current = fixture();
    try {
      runMigrationEngine(current.db, { logger: () => {} });
      let backups = 0;
      await initializeDatabaseForStartup(current.db, {
        env: { NODE_ENV: 'production' }, createBackup: async () => { backups += 1; }
      });
      assert.strictEqual(backups, 0);
    } finally { closeFixture(current); }

    const blocked = fixture();
    try {
      runMigrationEngine(blocked.db, { logger: () => {} });
      await assert.rejects(() => initializeDatabaseForStartup(blocked.db, {
        env: { NODE_ENV: 'production' }, registry: [BASELINE_MIGRATION, v2], minVersion: 1, maxVersion: 2,
        createBackup: async () => { throw Object.assign(new Error('private backup detail'), { code: 'BACKUP_FAILED' }); }
      }), error => error.code === 'BACKUP_FAILED');
      assert.strictEqual(blocked.db.prepare("SELECT 1 FROM sqlite_master WHERE name='migration_probe'").get(), undefined);
      assert.strictEqual(blocked.db.prepare(`SELECT 1 FROM ${LEDGER_TABLE} WHERE version=2`).get(), undefined);
    } finally { closeFixture(blocked); }
  }

  // The synchronous compatibility entry point cannot bypass production backup gating.
  {
    const value = fixture();
    try {
      runMigrationEngine(value.db, { logger: () => {} });
      const { initDb } = require('../db/init');
      assertCode(() => initDb({
        db: value.db,
        env: { NODE_ENV: 'production' },
        registry: [BASELINE_MIGRATION, v2],
        minVersion: 1,
        maxVersion: 2,
        logger: () => {}
      }), 'PREMIGRATION_BACKUP_REQUIRED');
      assert.strictEqual(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='migration_probe'").get(), undefined);
    } finally { closeFixture(value); }
  }

  // Supported lock order is runtime ownership followed by the backup-operation
  // lease; the real hardened backup primitive completes before migration.
  {
    const value = fixture();
    let releaseRuntime;
    try {
      runMigrationEngine(value.db, { logger: () => {} });
      const { acquireRuntimeLock } = require('../lib/databaseRuntimeLock');
      releaseRuntime = acquireRuntimeLock(value.databasePath);
      await initializeDatabaseForStartup(value.db, {
        env: {
          NODE_ENV: 'production',
          DATABASE_PATH: value.databasePath,
          PERSISTENT_DATA_DIR: value.directory,
          DATABASE_BACKUP_DIR: path.join(value.directory, 'backups')
        },
        registry: [BASELINE_MIGRATION, v2],
        minVersion: 1,
        maxVersion: 2,
        logger: () => {},
        backupLogger: () => {}
      });
      assert.ok(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='migration_probe'").get());
      assert.strictEqual(fs.readdirSync(path.join(value.directory, 'backups')).filter(name => name.endsWith('.db')).length, 1);
    } finally {
      if (releaseRuntime) assert.strictEqual(releaseRuntime().released, true);
      closeFixture(value);
    }
  }

  // The V1 registry accepts only explicitly additive DDL.
  for (const statement of [
    'DROP TABLE users',
    'ALTER TABLE users DROP COLUMN name',
    'DELETE FROM users',
    'ALTER TABLE users RENAME TO old_users',
    'CREATE TABLE safe_probe(id INTEGER); DROP TABLE users',
    'CREATE TABLE copied_users AS SELECT * FROM users'
  ]) {
    assertCode(() => validateMigrationRegistry([
      BASELINE_MIGRATION,
      additive(2, 'unsafe_probe', [statement])
    ]), 'DESTRUCTIVE_MIGRATION_REJECTED');
  }

  // Status is read-only and sanitized; migrate CLI uses the shared initializer.
  {
    const value = fixture();
    try {
      productionShape(value.db);
      value.db.close();
      const before = fs.statSync(value.databasePath);
      const status = spawnSync(process.execPath, ['scripts/migration-status.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: value.databasePath },
        encoding: 'utf8'
      });
      assert.strictEqual(status.status, 0, status.stderr);
      assert.match(status.stdout, /"baselineStatus": "adoption_required"/);
      assert.doesNotMatch(status.stdout, new RegExp(value.directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      const readOnly = new Database(value.databasePath, { readonly: true });
      assert.strictEqual(readOnly.prepare(`SELECT 1 FROM sqlite_master WHERE name='${LEDGER_TABLE}'`).get(), undefined);
      readOnly.close();
      assert.strictEqual(fs.statSync(value.databasePath).size, before.size);
      value.db = new Database(value.databasePath);
    } finally { closeFixture(value); }
  }

  // Startup constructs no normal service before migration success.
  {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(source.indexOf('await initializeDatabase') < source.indexOf('app.listen'));
    assert.ok(source.indexOf('app.listen') < source.indexOf('productionWorker.start()'));
    assert.match(source, /acquireRuntimeLock[\s\S]+initializeDatabase/);
  }

  console.log('Story 3.18 versioned migration tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
