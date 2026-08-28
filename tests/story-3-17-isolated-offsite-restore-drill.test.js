const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { createDatabaseBackup, verifySqliteBackup } = require('../lib/databaseBackup');
const { encryptBackupFile, parseArtifact } = require('../lib/backupEncryption');
const { normalizeOperationalCode, objectKeyFor } = require('../lib/offsiteBackup');
const {
  assertIsolatedPath,
  inspectRestoreDrillState,
  readRestoreDrillState,
  resolveDrillStateConfig,
  runOffsiteRestoreDrill,
  verifyDrillDatabase,
  writeRestoreDrillState
} = require('../lib/offsiteRestoreDrill');

const projectRoot = path.join(__dirname, '..');

class FakeStorage {
  constructor(key, object) { this.key = key; this.object = object; this.headCalls = 0; this.getCalls = 0; }
  async headObject(key) {
    this.headCalls += 1;
    if (key !== this.key || !this.object) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
    return { sizeBytes: this.object.body.length, metadata: this.object.metadata };
  }
  async getObject(key, options) {
    this.getCalls += 1;
    assert.strictEqual(key, this.key);
    assert(options.expectedSize <= options.maxBytes);
    return this.object.body;
  }
}

function initializeDatabase(databasePath) {
  const result = spawnSync(process.execPath, ['-e', `
    const {initDb}=require('./db/init'); const {getDb}=require('./db/database');
    initDb(); getDb().prepare("INSERT INTO users(email,name) VALUES('private@example.com','Private Data')").run();
    getDb().close();
  `], { cwd: projectRoot, env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

function identity(filename) {
  const stat = fs.statSync(filename);
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, bytes: fs.readFileSync(filename) };
}

function assertIdentityUnchanged(filename, before) {
  const after = identity(filename);
  assert.strictEqual(after.dev, before.dev);
  assert.strictEqual(after.ino, before.ino);
  assert.strictEqual(after.size, before.size);
  assert.strictEqual(after.mtimeMs, before.mtimeMs);
  assert.deepStrictEqual(after.bytes, before.bytes);
}

function mutateLastByte(buffer) {
  const result = Buffer.from(buffer);
  result[result.length - 1] ^= 0xff;
  return result;
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-317-'));
  try {
    const persistent = path.join(root, 'persistent');
    const drillTempRoot = path.join(root, 'drills');
    fs.mkdirSync(persistent);
    fs.mkdirSync(drillTempRoot);
    const databasePath = path.join(persistent, 'copyquick.db');
    initializeDatabase(databasePath);
    const keyV1 = Buffer.alloc(32, 17).toString('base64');
    const keyV2 = Buffer.alloc(32, 29).toString('base64');
    const env = {
      NODE_ENV: 'production', DATABASE_PATH: databasePath, PERSISTENT_DATA_DIR: persistent,
      DATABASE_BACKUP_DIR: path.join(persistent, 'backups'),
      OFFSITE_BACKUP_ENABLED: 'true', OFFSITE_BACKUP_ENDPOINT: 'https://objects.example.invalid',
      OFFSITE_BACKUP_REGION: 'auto', OFFSITE_BACKUP_BUCKET: 'private',
      OFFSITE_BACKUP_ACCESS_KEY_ID: 'access-secret', OFFSITE_BACKUP_SECRET_ACCESS_KEY: 'provider-secret',
      OFFSITE_BACKUP_PREFIX: 'copyquick/production', OFFSITE_BACKUP_ENCRYPTION_KEY: keyV1,
      OFFSITE_BACKUP_KEY_ID: 'v1'
    };

    const live = new Database(databasePath);
    const local = await createDatabaseBackup({ db: live, env, logger() {}, now: () => new Date('2026-08-27T10:00:00Z') });
    live.close();
    const localPath = path.join(env.DATABASE_BACKUP_DIR, local.filename);
    const artifactPath = path.join(root, 'fixture.cqbackup');
    encryptBackupFile({ sourcePath: localPath, destinationPath: artifactPath, encryptionKey: keyV1, keyId: 'v1' });
    const artifact = fs.readFileSync(artifactPath);
    const header = parseArtifact(artifact).header;
    const objectKey = objectKeyFor({
      prefix: env.OFFSITE_BACKUP_PREFIX,
      sourceBackupName: local.filename,
      createdAt: new Date('2026-08-27T10:05:00Z'),
      keyId: 'v1'
    });
    const object = {
      body: artifact,
      metadata: { ciphertextsha256: header.ciphertextSha256, keyid: 'v1', formatversion: '1' }
    };
    const osApi = { tmpdir: () => drillTempRoot };

    await assert.rejects(runOffsiteRestoreDrill({ env, storage: new FakeStorage(objectKey, object), osApi, logger() {} }),
      error => error.code === 'RESTORE_DRILL_OBJECT_REQUIRED');
    for (const invalid of ['../escape', '/absolute/object.cqbackup', 'copyquick/other/2026/08/27/file.cqbackup', 'copyquick/production/manual.cqbackup']) {
      await assert.rejects(runOffsiteRestoreDrill({ objectKey: invalid, env, storage: new FakeStorage(objectKey, object), osApi, logger() {} }),
        error => error.code === 'UNRECOGNIZED_REMOTE_OBJECT');
    }

    const missing = new FakeStorage(objectKey, null);
    await assert.rejects(runOffsiteRestoreDrill({ objectKey, env, storage: missing, osApi, logger() {} }),
      error => normalizeOperationalCode(error.code) === 'NOT_FOUND');
    assert.strictEqual(missing.headCalls, 1);
    assert.strictEqual(missing.getCalls, 0);

    const oversized = new FakeStorage(objectKey, object);
    oversized.headObject = async () => ({ sizeBytes: 70 * 1024 * 1024, metadata: object.metadata });
    await assert.rejects(runOffsiteRestoreDrill({ objectKey, env, storage: oversized, osApi, logger() {} }),
      error => error.code === 'REMOTE_CONTENT_LENGTH_INVALID');
    assert.strictEqual(oversized.getCalls, 0);

    const exceeded = new FakeStorage(objectKey, object);
    exceeded.headObject = async () => ({ sizeBytes: 1, metadata: object.metadata });
    exceeded.getObject = async () => { throw Object.assign(new Error('bounded stream'), { code: 'REMOTE_OBJECT_SIZE_EXCEEDED' }); };
    await assert.rejects(runOffsiteRestoreDrill({ objectKey, env, storage: exceeded, osApi, logger() {} }),
      error => error.code === 'REMOTE_OBJECT_SIZE_EXCEEDED');

    const mismatch = new FakeStorage(objectKey, object);
    mismatch.getObject = async () => object.body.subarray(0, object.body.length - 1);
    await assert.rejects(runOffsiteRestoreDrill({ objectKey, env, storage: mismatch, osApi, logger() {} }),
      error => error.code === 'REMOTE_OBJECT_SIZE_MISMATCH');

    const tampered = new FakeStorage(objectKey, { ...object, body: mutateLastByte(artifact) });
    tampered.object.metadata = { ...object.metadata };
    await assert.rejects(runOffsiteRestoreDrill({ objectKey, env, storage: tampered, osApi, logger() {} }),
      error => error.code === 'CIPHERTEXT_HASH_MISMATCH');
    const malformed = new FakeStorage(objectKey, { body: Buffer.from('not-an-encrypted-container'), metadata: object.metadata });
    await assert.rejects(runOffsiteRestoreDrill({ objectKey, env, storage: malformed, osApi, logger() {} }),
      error => error.code === 'INVALID_BACKUP_ARTIFACT');
    await assert.rejects(runOffsiteRestoreDrill({
      objectKey, env: { ...env, OFFSITE_BACKUP_KEY_ID: 'v2', OFFSITE_BACKUP_ENCRYPTION_KEY: keyV2 },
      storage: new FakeStorage(objectKey, object), osApi, logger() {}
    }), error => error.code === 'BACKUP_KEY_ID_UNAVAILABLE');
    await assert.rejects(runOffsiteRestoreDrill({
      objectKey, env, storage: new FakeStorage(objectKey, object), osApi,
      decryptionKey: keyV2, decryptionKeyId: 'v1', logger() {}
    }), error => error.code === 'BACKUP_AUTHENTICATION_FAILED');

    fs.writeFileSync(`${databasePath}-wal`, 'live wal');
    fs.writeFileSync(`${databasePath}-shm`, 'live shm');
    const runtimeLock = `${databasePath}.runtime-lock`;
    fs.writeFileSync(runtimeLock, 'runtime ownership');
    const beforeLive = identity(databasePath);
    const beforeWal = identity(`${databasePath}-wal`);
    const beforeShm = identity(`${databasePath}-shm`);
    const beforeRuntimeLock = identity(runtimeLock);
    fs.writeFileSync(path.join(drillTempRoot, 'unrelated.txt'), 'preserve');
    let usedSqliteBackup = false;
    const result = await runOffsiteRestoreDrill({
      objectKey, env, storage: new FakeStorage(objectKey, object), osApi, logger() {},
      backupOperation: async (sourceDb, destination) => {
        usedSqliteBackup = true;
        await sourceDb.backup(destination);
      },
      now: (() => {
        let value = Date.parse('2026-08-27T11:00:00.000Z');
        return () => new Date(value += 25);
      })()
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.keyId, 'v1');
    assert(result.durationMs >= 0);
    assert.strictEqual(usedSqliteBackup, true);
    assertIdentityUnchanged(databasePath, beforeLive);
    assertIdentityUnchanged(`${databasePath}-wal`, beforeWal);
    assertIdentityUnchanged(`${databasePath}-shm`, beforeShm);
    assertIdentityUnchanged(runtimeLock, beforeRuntimeLock);
    assert.deepStrictEqual(fs.readdirSync(drillTempRoot), ['unrelated.txt']);
    for (const lifecycleModule of [
      '../server.js', '../lib/productionWorker.js', '../lib/offsiteBackupScheduler.js',
      '../lib/backupHealthWatcher.js'
    ]) {
      assert.strictEqual(require.cache[require.resolve(lifecycleModule)], undefined,
        `${lifecycleModule} must not be loaded by the CLI-only drill`);
    }

    const drillStateConfig = resolveDrillStateConfig(env);
    const state = readRestoreDrillState(drillStateConfig);
    assert.strictEqual(fs.statSync(drillStateConfig.statePath).mode & 0o777, 0o600);
    assert.strictEqual(state.lastSuccessAt, '2026-08-27T11:00:00.075Z');
    assert.strictEqual(state.keyId, 'v1');
    assert.strictEqual(state.artifactHash, header.ciphertextSha256);
    assert(!fs.readdirSync(persistent).some(name => name.includes('.offsite-restore-drill-state.json.') && name.endsWith('.tmp')),
      'atomic state writes must not leave temporary metadata');
    const serializedState = fs.readFileSync(drillStateConfig.statePath, 'utf8');
    assert(!serializedState.includes('private@example.com'));
    assert(!serializedState.includes(keyV1));
    assert(!serializedState.includes(env.OFFSITE_BACKUP_SECRET_ACCESS_KEY));
    const health = inspectRestoreDrillState({ env, now: () => new Date('2026-08-27T12:00:00.075Z') });
    assert.strictEqual(health.ageHours, 1);
    assert.strictEqual(health.lastFailureCode, null);

    assert.throws(() => assertIsolatedPath(databasePath, databasePath), error => error.code === 'DRILL_PATH_NOT_ISOLATED');
    const symlink = path.join(root, 'live-alias.db');
    fs.symlinkSync(databasePath, symlink);
    assert.throws(() => assertIsolatedPath(symlink, databasePath), error => error.code === 'DRILL_PATH_NOT_ISOLATED');
    const hardlink = path.join(root, 'live-hardlink.db');
    fs.linkSync(databasePath, hardlink);
    assert.throws(() => assertIsolatedPath(hardlink, databasePath), error => error.code === 'DRILL_PATH_NOT_ISOLATED');

    const invalidDatabasePath = path.join(root, 'invalid-copyquick.db');
    fs.writeFileSync(invalidDatabasePath, 'not sqlite');
    assert.throws(() => verifyDrillDatabase(invalidDatabasePath), error => error.code === 'BACKUP_VERIFICATION_FAILED');
    const incompletePath = path.join(root, 'incomplete.db');
    new Database(incompletePath).close();
    assert.throws(() => verifyDrillDatabase(incompletePath), error => error.code === 'BACKUP_VERIFICATION_FAILED');

    const invalidBackup = path.join(root, 'invalid-source.db');
    fs.writeFileSync(invalidBackup, 'not sqlite');
    const invalidArtifact = path.join(root, 'invalid-source.cqbackup');
    // The container is valid, but its decrypted SQLite payload is not.
    fs.renameSync(invalidBackup, path.join(root, 'copyquick-2026-08-27T120000Z.db'));
    const canonicalInvalid = path.join(root, 'copyquick-2026-08-27T120000Z.db');
    encryptBackupFile({ sourcePath: canonicalInvalid, destinationPath: invalidArtifact, encryptionKey: keyV1, keyId: 'v1' });
    const invalidBytes = fs.readFileSync(invalidArtifact);
    const invalidHeader = parseArtifact(invalidBytes).header;
    const invalidObject = {
      body: invalidBytes,
      metadata: { ciphertextsha256: invalidHeader.ciphertextSha256, keyid: 'v1', formatversion: '1' }
    };
    await assert.rejects(runOffsiteRestoreDrill({ objectKey, env, storage: new FakeStorage(objectKey, invalidObject), osApi, logger() {} }),
      error => error.code === 'BACKUP_VERIFICATION_FAILED');
    assert.deepStrictEqual(fs.readdirSync(drillTempRoot), ['unrelated.txt']);

    let backupFailureDirectory;
    await assert.rejects(runOffsiteRestoreDrill({
      objectKey, env, storage: new FakeStorage(objectKey, object), osApi, logger() {},
      backupOperation: async (_db, destination) => {
        backupFailureDirectory = path.dirname(destination);
        fs.writeFileSync(`${destination}-wal`, 'temporary wal');
        throw Object.assign(new Error('backup failed with private path'), { code: 'SQLITE_BUSY' });
      }
    }), error => error.code === 'SQLITE_BUSY');
    assert(!fs.existsSync(backupFailureDirectory));

    const cleanupLogs = [];
    const cleanupFs = Object.create(fs);
    cleanupFs.unlinkSync = candidate => {
      if (path.basename(candidate) === 'decrypted-source.db') {
        throw Object.assign(new Error(`private ${candidate}`), { code: 'EACCES\n/private/path' });
      }
      return fs.unlinkSync(candidate);
    };
    await assert.rejects(runOffsiteRestoreDrill({
      objectKey, env, storage: new FakeStorage(objectKey, object), osApi, fsApi: cleanupFs,
      backupOperation: async () => { throw Object.assign(new Error('primary'), { code: 'SQLITE_BUSY' }); },
      logger: event => cleanupLogs.push(event)
    }), error => error.code === 'SQLITE_BUSY', 'cleanup failure must preserve the primary error');
    assert(cleanupLogs.some(event => event.event === 'offsite_restore_drill_cleanup_failed'));
    assert(!JSON.stringify(cleanupLogs).includes('/private/path'));
    // Remove the intentionally stranded test artifact without exercising production cleanup code.
    for (const entry of fs.readdirSync(drillTempRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) fs.rmSync(path.join(drillTempRoot, entry.name), { recursive: true, force: true });
    }

    writeRestoreDrillState(drillStateConfig, { ...state, failureCode: 'line\nsecret' });
    assert.strictEqual(readRestoreDrillState(drillStateConfig).failureCode, 'RESTORE_DRILL_FAILED');
    fs.writeFileSync(drillStateConfig.statePath, '{corrupt', { mode: 0o600 });
    assert.strictEqual(readRestoreDrillState(drillStateConfig).stateInvalid, true);
    assert.strictEqual(inspectRestoreDrillState({ env }).lastFailureCode, 'RESTORE_DRILL_STATE_INVALID');

    const missingCli = spawnSync(process.execPath, ['scripts/verify-offsite-restore.js'], {
      cwd: projectRoot, env, encoding: 'utf8'
    });
    assert.strictEqual(missingCli.status, 1);
    assert(missingCli.stderr.includes('RESTORE_DRILL_OBJECT_REQUIRED'));
    assert(!`${missingCli.stdout}${missingCli.stderr}`.includes(keyV1));
    assert(!`${missingCli.stdout}${missingCli.stderr}`.includes(env.OFFSITE_BACKUP_SECRET_ACCESS_KEY));

    assert.strictEqual(normalizeOperationalCode('SQLITE_BUSY'), 'SQLITE_BUSY');
    console.log('Story 3.17 Isolated Off-Site Restore Verification Drill tests passed.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
