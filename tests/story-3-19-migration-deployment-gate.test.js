const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const express = require('express');
const { BASELINE_SCHEMA_SQL } = require('../db/schema');
const {
  BASELINE_MIGRATION,
  BILLING_RECONCILIATION_MIGRATION,
  LEDGER_TABLE,
  runMigrationEngine
} = require('../db/migrations');
const { requireCompatibleMigrationState } = require('../lib/migrationStartupGate');
const { startApplicationAfterMigrationGate } = require('../lib/applicationStartup');
const { createHealthRouter } = require('../routes/health');

const projectRoot = path.join(__dirname, '..');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-gate-'));
  const databasePath = path.join(directory, 'fixture.db');
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  return { directory, databasePath, db };
}

function closeFixture(value) {
  try { value.db.close(); } catch (_) {}
  fs.rmSync(value.directory, { recursive: true, force: true });
}

function additiveV3() {
  return {
    version: 3,
    name: 'add_gate_probe',
    kind: 'migration',
    policy: 'additive',
    rollbackCompatible: true,
    statements: ['CREATE TABLE gate_probe(id INTEGER PRIMARY KEY)']
  };
}

function initializeCurrent(db) {
  return runMigrationEngine(db, { logger: () => {} });
}

function initializeNewer(db) {
  return runMigrationEngine(db, {
    registry: [BASELINE_MIGRATION, BILLING_RECONCILIATION_MIGRATION, additiveV3()],
    minVersion: 1,
    maxVersion: 3,
    logger: () => {}
  });
}

function gate(db, inspectOptions = {}, logger = () => {}) {
  return requireCompatibleMigrationState({ db, inspectOptions, logger });
}

function expectBlocked(fn, condition) {
  assert.throws(fn, error => error.code === condition && error.message === 'Application startup blocked by migration state.');
}

function fileHash(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function requestJson(server, pathname) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.get({ hostname: '127.0.0.1', port: address.port, path: pathname }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, json: JSON.parse(body) }));
    });
    request.on('error', reject);
  });
}

async function run() {
  // Current recorded baseline is compatible and emits a sanitized success event.
  {
    const value = fixture();
    try {
      initializeCurrent(value.db);
      const logs = [];
      const status = gate(value.db, {}, entry => logs.push(entry));
      assert.strictEqual(status.currentVersion, 2);
      assert.strictEqual(status.pendingCount, 0);
      assert.deepStrictEqual(logs, [{
        event: 'migration_compatibility_ok',
        currentVersion: 2,
        minSupportedVersion: 1,
        maxSupportedVersion: 2,
        pendingCount: 0
      }]);
    } finally { closeFixture(value); }
  }

  // Mandatory rollback scenario: Build A (v1) refuses a database migrated by Build B (v2).
  {
    const value = fixture();
    try {
      initializeNewer(value.db);
      const beforeRows = value.db.prepare(`SELECT * FROM ${LEDGER_TABLE} ORDER BY version`).all();
      const beforeTables = value.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      const logs = [];
      expectBlocked(() => gate(value.db, {}, entry => logs.push(entry)), 'MIGRATION_INCOMPATIBLE');
      assert.deepStrictEqual(value.db.prepare(`SELECT * FROM ${LEDGER_TABLE} ORDER BY version`).all(), beforeRows);
      assert.deepStrictEqual(value.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(), beforeTables);
      assert.ok(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='gate_probe'").get());
      assert.deepStrictEqual(logs.map(entry => entry.event), ['migration_incompatible', 'startup_blocked_migration_state']);
    } finally { closeFixture(value); }
  }

  // A schema below this build's minimum is incompatible; a pending additive migration is required, never implicit.
  {
    const value = fixture();
    const registry = [BASELINE_MIGRATION, BILLING_RECONCILIATION_MIGRATION, additiveV3()];
    try {
      initializeCurrent(value.db);
      expectBlocked(() => gate(value.db, { registry, minVersion: 3, maxVersion: 3 }), 'MIGRATION_INCOMPATIBLE');
      expectBlocked(() => gate(value.db, { registry, minVersion: 1, maxVersion: 3 }), 'MIGRATION_REQUIRED');
      assert.strictEqual(value.db.prepare("SELECT 1 FROM sqlite_master WHERE name='gate_probe'").get(), undefined);
      assert.strictEqual(value.db.prepare(`SELECT COUNT(*) count FROM ${LEDGER_TABLE}`).get().count, 2);
    } finally { closeFixture(value); }
  }

  // Strict baseline adoption remains available only to the explicit migration command; startup blocks it.
  {
    const valid = fixture();
    try {
      valid.db.exec(BASELINE_SCHEMA_SQL);
      expectBlocked(() => gate(valid.db), 'MIGRATION_REQUIRED');
      assert.strictEqual(valid.db.prepare(`SELECT 1 FROM sqlite_master WHERE name='${LEDGER_TABLE}'`).get(), undefined);
    } finally { closeFixture(valid); }

    const invalid = fixture();
    try {
      invalid.db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT)');
      expectBlocked(() => gate(invalid.db), 'MIGRATION_HISTORY_INVALID');
      assert.strictEqual(invalid.db.prepare(`SELECT 1 FROM sqlite_master WHERE name='${LEDGER_TABLE}'`).get(), undefined);
    } finally { closeFixture(invalid); }
  }

  // Unknown/checksum history and malformed ledger structure fail closed without repair.
  {
    const changed = fixture();
    try {
      initializeCurrent(changed.db);
      changed.db.prepare(`UPDATE ${LEDGER_TABLE} SET checksum=? WHERE version=1`).run('0'.repeat(64));
      expectBlocked(() => gate(changed.db), 'MIGRATION_HISTORY_INVALID');
      assert.strictEqual(changed.db.prepare(`SELECT checksum FROM ${LEDGER_TABLE} WHERE version=1`).get().checksum, '0'.repeat(64));
    } finally { closeFixture(changed); }

    const malformed = fixture();
    try {
      initializeCurrent(malformed.db);
      malformed.db.exec(`ALTER TABLE ${LEDGER_TABLE} ADD COLUMN unexpected_metadata TEXT`);
      expectBlocked(() => gate(malformed.db), 'MIGRATION_HISTORY_INVALID');
      assert.ok(malformed.db.pragma(`table_info(${LEDGER_TABLE})`).some(column => column.name === 'unexpected_metadata'));
    } finally { closeFixture(malformed); }
  }

  // The lifecycle cannot initialize runtime state or start any service before the gate passes.
  {
    const calls = [];
    await assert.rejects(() => startApplicationAfterMigrationGate({
      databaseExists: true,
      getDatabase: () => ({ marker: 'db' }),
      gateMigrationState: () => { calls.push('gate'); throw Object.assign(new Error('blocked'), { code: 'MIGRATION_REQUIRED' }); },
      initializeRuntimeDatabase: () => calls.push('runtime'),
      startHttp: () => calls.push('http'),
      startProductionWorker: () => calls.push('worker'),
      startOffsiteBackupScheduler: () => calls.push('scheduler'),
      startBackupHealthWatcher: () => calls.push('watcher')
    }), error => error.code === 'MIGRATION_REQUIRED');
    assert.deepStrictEqual(calls, ['gate']);

    const safeCalls = [];
    await startApplicationAfterMigrationGate({
      databaseExists: true,
      getDatabase: () => ({ marker: 'db' }),
      gateMigrationState: () => { safeCalls.push('gate'); return { currentVersion: 1 }; },
      initializeRuntimeDatabase: () => safeCalls.push('runtime'),
      startHttp: () => { safeCalls.push('http'); return {}; },
      startProductionWorker: () => { safeCalls.push('worker'); return {}; },
      startOffsiteBackupScheduler: () => { safeCalls.push('scheduler'); return {}; },
      startBackupHealthWatcher: () => { safeCalls.push('watcher'); return {}; }
    });
    assert.deepStrictEqual(safeCalls, ['gate', 'runtime', 'http', 'worker', 'scheduler', 'watcher']);
  }

  // migrations:check is read-only, succeeds only for a safe state, and reports normalized failure.
  {
    const safe = fixture();
    try {
      initializeCurrent(safe.db);
      safe.db.close();
      const beforeHash = fileHash(safe.databasePath);
      const result = spawnSync(process.execPath, ['scripts/migration-check.js'], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: safe.databasePath },
        encoding: 'utf8'
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /"event": "migration_compatibility_ok"/);
      assert.strictEqual(fileHash(safe.databasePath), beforeHash);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(safe.directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      safe.db = new Database(safe.databasePath);
    } finally { closeFixture(safe); }

    const unsafe = fixture();
    try {
      initializeNewer(unsafe.db);
      unsafe.db.close();
      const beforeHash = fileHash(unsafe.databasePath);
      const result = spawnSync(process.execPath, ['scripts/migration-check.js'], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: unsafe.databasePath },
        encoding: 'utf8'
      });
      assert.strictEqual(result.status, 2);
      assert.match(result.stderr, /"condition":"MIGRATION_INCOMPATIBLE"/);
      assert.strictEqual(fileHash(unsafe.databasePath), beforeHash);
      unsafe.db = new Database(unsafe.databasePath);
      assert.strictEqual(unsafe.db.prepare(`SELECT COUNT(*) count FROM ${LEDGER_TABLE}`).get().count, 3);
    } finally { closeFixture(unsafe); }
  }

  // Actual server startup blocks a newer schema, exits nonzero, and releases runtime ownership.
  {
    const value = fixture();
    try {
      initializeNewer(value.db);
      value.db.close();
      const result = spawnSync(process.execPath, ['server.js'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DATABASE_PATH: value.databasePath,
          STRIPE_KEY: '',
          SESSION_SECRET: 'story-3-19-session-secret',
          PORT: '0'
        },
        encoding: 'utf8',
        timeout: 10000
      });
      assert.strictEqual(result.status, 1, result.stderr);
      assert.match(result.stderr, /Database startup failed: MIGRATION_INCOMPATIBLE/);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value.directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.strictEqual(fs.existsSync(`${value.databasePath}.runtime-lock`), false);
      value.db = new Database(value.databasePath);
      assert.strictEqual(value.db.prepare(`SELECT COUNT(*) count FROM ${LEDGER_TABLE}`).get().count, 3);
    } finally { closeFixture(value); }
  }

  // /healthz remains intentionally minimal and does not expose migration details.
  {
    const app = express();
    app.use(createHealthRouter({ getDatabase: () => ({ prepare: () => ({ get: () => ({ ready: 1 }) }) }) }));
    const server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
      const response = await requestJson(server, '/healthz');
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.json, { status: 'ok' });
      assert.doesNotMatch(response.body, /migration|schema|version|pending|database/i);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }

  // Source-level defense: server imports no migration execution path.
  {
    const source = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
    assert.doesNotMatch(source, /runMigrationEngine|executeMigrationsWithProductionBackup|migrateDatabase/);
    assert.ok(source.indexOf('requireCompatibleMigrationState') < source.indexOf('app.listen'));
  }

  console.log('Story 3.19 Production-Safe Migration Deployment Gate tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
