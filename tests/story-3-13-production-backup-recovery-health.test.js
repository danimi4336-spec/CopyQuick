const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const {
  createDatabaseBackup,
  listRecognizedBackups,
  resolveBackupConfig,
  verifySqliteBackup
} = require('../lib/databaseBackup');
const { restoreDatabase } = require('../lib/databaseRestore');
const { getRuntimeLockPath } = require('../lib/databaseRuntimeLock');
const { classifyStorageCapacity, inspectStorageHealth } = require('../lib/storageHealth');

const projectRoot = path.join(__dirname, '..');

function runNode(source, env) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function initializeDatabase(databasePath, marker) {
  runNode(`
    const {initDb}=require('./db/init'); const {getDb}=require('./db/database');
    initDb(); getDb().prepare('INSERT INTO users(email,name) VALUES(?,?)').run(${JSON.stringify(marker + '@example.com')},${JSON.stringify(marker)});
  `, { NODE_ENV: 'development', DATABASE_PATH: databasePath });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-3-13-'));
  try {
    const persistentRoot = path.join(root, 'persistent');
    fs.mkdirSync(persistentRoot);
    const databasePath = path.join(persistentRoot, 'copyquick.db');
    initializeDatabase(databasePath, 'live-secret-marker');
    const env = {
      NODE_ENV: 'production',
      DATABASE_PATH: databasePath,
      PERSISTENT_DATA_DIR: persistentRoot,
      DATABASE_BACKUP_RETENTION: '2'
    };
    const sourceDb = new Database(databasePath);
    assert.strictEqual(sourceDb.pragma('journal_mode = WAL', { simple: true }).toLowerCase(), 'wal');
    sourceDb.prepare('INSERT INTO users(email,name) VALUES(?,?)').run('wal@example.com', 'WAL row');
    const sourceCount = sourceDb.prepare('SELECT COUNT(*) count FROM users').get().count;

    const first = await createDatabaseBackup({ db: sourceDb, env, now: () => new Date('2026-08-26T23:55:00Z'), logger: () => {} });
    assert.strictEqual(first.filename, 'copyquick-2026-08-26T235500Z.db');
    const backupDir = path.join(persistentRoot, 'backups');
    const firstPath = path.join(backupDir, first.filename);
    assert(fs.existsSync(firstPath));
    const verified = verifySqliteBackup(firstPath);
    assert.strictEqual(verified.quickCheck, 'ok');
    assert.strictEqual(verified.tableCounts.users, sourceCount);
    const independent = new Database(firstPath, { readonly: true, fileMustExist: true });
    assert.strictEqual(independent.prepare('SELECT COUNT(*) count FROM users').get().count, sourceCount);
    independent.close();
    assert.strictEqual(sourceDb.prepare('SELECT COUNT(*) count FROM users').get().count, sourceCount, 'backup must not mutate source');

    await assert.rejects(
      createDatabaseBackup({
        db: sourceDb,
        env,
        now: () => new Date('2026-08-26T23:56:00Z'),
        logger: () => {},
        backupOperation: async (_db, temporaryPath) => fs.writeFileSync(temporaryPath, 'incomplete')
      }),
      error => error.code === 'BACKUP_VERIFICATION_FAILED'
    );
    assert(!fs.existsSync(path.join(backupDir, 'copyquick-2026-08-26T235600Z.db')));

    await createDatabaseBackup({ db: sourceDb, env, now: () => new Date('2026-08-27T00:00:00Z'), logger: () => {} });
    fs.writeFileSync(path.join(backupDir, 'operator-notes.txt'), 'retain');
    await createDatabaseBackup({ db: sourceDb, env, now: () => new Date('2026-08-28T00:00:00Z'), logger: () => {} });
    const retained = listRecognizedBackups(backupDir);
    assert.strictEqual(retained.length, 2);
    const validRestoreSource = retained[0].path;
    assert(fs.existsSync(path.join(backupDir, 'operator-notes.txt')));
    assert(fs.existsSync(databasePath));
    assert.throws(() => resolveBackupConfig({ ...env, DATABASE_BACKUP_DIR: path.join(root, 'escaped') }),
      error => error.code === 'BACKUP_DIRECTORY_OUTSIDE_PERSISTENT_ROOT');
    assert.throws(() => resolveBackupConfig({ ...env, DATABASE_BACKUP_DIR: '/' }),
      error => error.code === 'BACKUP_DIRECTORY_UNSAFE');

    const health = inspectStorageHealth({ env, db: sourceDb });
    assert(['healthy', 'warning', 'critical'].includes(health.status));
    assert.strictEqual(health.database.quickCheck, 'ok');
    assert.strictEqual(health.backups.recognizedCount, 2);
    assert(health.backups.latestVerifiedBackupAt);
    const serializedHealth = JSON.stringify(health);
    assert(!serializedHealth.includes('live-secret-marker'));
    assert(!serializedHealth.includes(databasePath), 'health output must not expose paths');
    assert.strictEqual(classifyStorageCapacity({ freeBytes: 2e9, freePercent: 50 }), 'healthy');
    assert.strictEqual(classifyStorageCapacity({ freeBytes: 800e6, freePercent: 30 }), 'warning');
    assert.strictEqual(classifyStorageCapacity({ freeBytes: 400e6, freePercent: 30 }), 'critical');

    const corrupt = path.join(root, 'corrupt.db');
    fs.writeFileSync(corrupt, 'not sqlite');
    assert.throws(() => verifySqliteBackup(corrupt), error => error.code === 'BACKUP_VERIFICATION_FAILED');

    sourceDb.close();
    const command = spawnSync(process.execPath, ['scripts/backup-database.js'], {
      cwd: projectRoot, env: { ...process.env, ...env }, encoding: 'utf8'
    });
    assert.strictEqual(command.status, 0, command.stderr);
    assert.match(command.stdout, /Verified database backup created/);
    const failedCommand = spawnSync(process.execPath, ['scripts/backup-database.js'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'production', DATABASE_PATH: '', PERSISTENT_DATA_DIR: persistentRoot },
      encoding: 'utf8'
    });
    assert.notStrictEqual(failedCommand.status, 0);

    const restoreRoot = path.join(root, 'restore');
    fs.mkdirSync(restoreRoot);
    const restorePath = path.join(restoreRoot, 'copyquick.db');
    initializeDatabase(restorePath, 'destination-marker');
    const restoreEnv = {
      NODE_ENV: 'production', DATABASE_PATH: restorePath, PERSISTENT_DATA_DIR: restoreRoot,
      DATABASE_BACKUP_DIR: path.join(restoreRoot, 'backups')
    };
    await assert.rejects(restoreDatabase({ env: restoreEnv, confirmApplicationStopped: true, confirmProductionRestore: true, logger: () => {} }),
      error => error.code === 'RESTORE_SOURCE_REQUIRED');
    await assert.rejects(restoreDatabase({ source: restorePath, env: restoreEnv, confirmApplicationStopped: true, confirmProductionRestore: true, logger: () => {} }),
      error => error.code === 'RESTORE_SOURCE_IS_DESTINATION');
    await assert.rejects(restoreDatabase({ source: validRestoreSource, env: restoreEnv, confirmApplicationStopped: true, logger: () => {} }),
      error => error.code === 'PRODUCTION_RESTORE_CONFIRMATION_REQUIRED');
    await assert.rejects(restoreDatabase({ source: validRestoreSource, env: restoreEnv, confirmProductionRestore: true, logger: () => {} }),
      error => error.code === 'RESTORE_OFFLINE_CONFIRMATION_REQUIRED');

    const lockPath = getRuntimeLockPath(restorePath);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
    await assert.rejects(restoreDatabase({ source: validRestoreSource, env: restoreEnv, confirmApplicationStopped: true, confirmProductionRestore: true, logger: () => {} }),
      error => error.code === 'RESTORE_DATABASE_ACTIVE');
    fs.unlinkSync(lockPath);

    const destinationBeforeCorruptAttempt = new Database(restorePath, { readonly: true });
    const beforeName = destinationBeforeCorruptAttempt.prepare('SELECT name FROM users').get().name;
    destinationBeforeCorruptAttempt.close();
    await assert.rejects(restoreDatabase({ source: corrupt, env: restoreEnv, confirmApplicationStopped: true, confirmProductionRestore: true, logger: () => {} }),
      error => error.code === 'BACKUP_VERIFICATION_FAILED');
    const unchanged = new Database(restorePath, { readonly: true });
    assert.strictEqual(unchanged.prepare('SELECT name FROM users').get().name, beforeName);
    unchanged.close();

    fs.writeFileSync(`${restorePath}-wal`, 'stale-wal');
    fs.writeFileSync(`${restorePath}-shm`, 'stale-shm');
    const restored = await restoreDatabase({
      source: validRestoreSource, env: restoreEnv, confirmApplicationStopped: true,
      confirmProductionRestore: true, logger: () => {}
    });
    assert.strictEqual(restored.verification.quickCheck, 'ok');
    if (fs.existsSync(`${restorePath}-wal`)) assert.notStrictEqual(fs.readFileSync(`${restorePath}-wal`, 'utf8'), 'stale-wal');
    if (fs.existsSync(`${restorePath}-shm`)) assert.notStrictEqual(fs.readFileSync(`${restorePath}-shm`, 'utf8'), 'stale-shm');
    const restoredDb = new Database(restorePath, { readonly: true, fileMustExist: true });
    assert.strictEqual(restoredDb.prepare("SELECT COUNT(*) count FROM users WHERE email='live-secret-marker@example.com'").get().count, 1);
    assert.strictEqual(restoredDb.pragma('quick_check', { simple: true }), 'ok');
    restoredDb.close();
    assert(listRecognizedBackups(path.join(restoreRoot, 'backups')).length >= 1, 'pre-restore safety backup required');

    console.log('Story 3.13 production backup, recovery, and health tests passed.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
