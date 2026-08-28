const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const {
  MAGIC,
  MAX_HEADER_BYTES,
  decodeEncryptionKey,
  decryptArtifactBuffer,
  encryptBackupFile,
  parseArtifact,
  validateArtifactSize,
  verifyEncryptedArtifact
} = require('../lib/backupEncryption');
const { createDatabaseBackup, listRecognizedBackups, verifySqliteBackup } = require('../lib/databaseBackup');
const {
  applyRemoteRetention,
  createOffsiteBackup,
  inspectOffsiteFreshness,
  normalizeOperationalCode,
  objectKeyFor,
  prepareOffsiteRestore,
  readOffsiteState,
  recognizedObjectKey,
  resolveOffsiteConfig,
  validateRemoteContentLength,
  writeOffsiteState
} = require('../lib/offsiteBackup');
const { S3CompatibleStorage } = require('../lib/offsiteStorage');

const projectRoot = path.join(__dirname, '..');

class FakeStorage {
  constructor() {
    this.objects = new Map();
    this.puts = [];
    this.deletes = [];
  }
  async putObject({ key, filePath, sizeBytes, metadata }) {
    const body = fs.readFileSync(filePath);
    this.puts.push({ key, sizeBytes, metadata, body });
    this.objects.set(key, { body, metadata, sizeBytes });
  }
  async headObject(key) {
    const object = this.objects.get(key);
    if (!object) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
    return { sizeBytes: object.sizeBytes, metadata: object.metadata };
  }
  async getObject(key) {
    const object = this.objects.get(key);
    if (!object) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
    return object.body;
  }
  async listObjects(prefix) {
    return [...this.objects.entries()].filter(([key]) => key.startsWith(prefix))
      .map(([key, object]) => ({ key, sizeBytes: object.sizeBytes }));
  }
  async deleteObject(key) {
    this.deletes.push(key);
    this.objects.delete(key);
  }
}

function initializeDatabase(databasePath) {
  const result = spawnSync(process.execPath, ['-e', `
    const {initDb}=require('./db/init'); const {getDb}=require('./db/database');
    initDb(); getDb().prepare("INSERT INTO users(email,name) VALUES('private@example.com','Private Data')").run();
  `], { cwd: projectRoot, env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

function mutateCiphertext(buffer) {
  const result = Buffer.from(buffer);
  result[result.length - 1] ^= 0xff;
  return result;
}

function mutateTag(buffer) {
  const result = Buffer.from(buffer);
  const headerLength = result.readUInt32BE(8);
  const start = 12;
  const header = JSON.parse(result.subarray(start, start + headerLength).toString());
  header.authTag = `${header.authTag[0] === 'A' ? 'B' : 'A'}${header.authTag.slice(1)}`;
  const replacement = Buffer.from(JSON.stringify(header));
  assert.strictEqual(replacement.length, headerLength);
  replacement.copy(result, start);
  return result;
}

function replaceHeader(buffer, mutate) {
  const headerLength = buffer.readUInt32BE(MAGIC.length);
  const start = MAGIC.length + 4;
  const header = JSON.parse(buffer.subarray(start, start + headerLength).toString());
  mutate(header);
  const encoded = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(encoded.length);
  return Buffer.concat([MAGIC, length, encoded, buffer.subarray(start + headerLength)]);
}

function successState(overrides = {}) {
  return {
    lastSuccessAt: '2026-08-25T00:00:00.000Z',
    lastSuccessObjectKey: 'copyquick/production/2026/08/25/copyquick-2026-08-25T000000Z-v1.cqbackup',
    lastFailureCode: null,
    keyId: 'v1',
    artifactSizeBytes: 1024,
    ciphertextSha256: 'a'.repeat(64),
    ...overrides
  };
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-3-14-'));
  try {
    const persistent = path.join(root, 'persistent');
    fs.mkdirSync(persistent);
    const databasePath = path.join(persistent, 'copyquick.db');
    initializeDatabase(databasePath);
    const keyV1 = Buffer.alloc(32, 17).toString('base64');
    const keyV2 = Buffer.alloc(32, 29).toString('base64');
    assert.strictEqual(keyV1.length, 44);
    assert.strictEqual(decodeEncryptionKey(keyV1).length, 32);
    for (const invalid of ['', 'not-base64!', Buffer.alloc(16).toString('base64'), 'your_key_here', keyV1.replace(/=+$/, ''), `${keyV1}=`, ` ${keyV1}`]) {
      assert.throws(() => decodeEncryptionKey(invalid), error => error.code === 'INVALID_ENCRYPTION_KEY');
    }

    const baseEnv = {
      NODE_ENV: 'production', DATABASE_PATH: databasePath, PERSISTENT_DATA_DIR: persistent,
      DATABASE_BACKUP_DIR: path.join(persistent, 'backups'), DATABASE_BACKUP_RETENTION: '7',
      OFFSITE_BACKUP_ENABLED: 'true', OFFSITE_BACKUP_ENDPOINT: 'https://objects.example.invalid',
      OFFSITE_BACKUP_REGION: 'us-east-1', OFFSITE_BACKUP_BUCKET: 'copyquick-backups',
      OFFSITE_BACKUP_ACCESS_KEY_ID: 'operator-access', OFFSITE_BACKUP_SECRET_ACCESS_KEY: 'operator-secret',
      OFFSITE_BACKUP_PREFIX: 'copyquick/production', OFFSITE_BACKUP_ENCRYPTION_KEY: keyV1,
      OFFSITE_BACKUP_KEY_ID: 'v1', OFFSITE_BACKUP_RETENTION: '2', OFFSITE_BACKUP_MAX_AGE_HOURS: '36'
    };
    assert.strictEqual(inspectOffsiteFreshness({ env: { ...baseEnv, OFFSITE_BACKUP_ENABLED: 'false' } }).status, 'disabled');
    assert.strictEqual(inspectOffsiteFreshness({ env: baseEnv }).status, 'never_succeeded');
    assert.throws(() => resolveOffsiteConfig({ ...baseEnv, OFFSITE_BACKUP_PREFIX: '../escape' }),
      error => error.code === 'INVALID_OFFSITE_BACKUP_PREFIX');

    const liveDb = new Database(databasePath);
    const localResult = await createDatabaseBackup({ db: liveDb, env: baseEnv, logger: () => {}, now: () => new Date('2026-08-27T01:51:07Z') });
    liveDb.close();
    const localPath = path.join(persistent, 'backups', localResult.filename);
    verifySqliteBackup(localPath);

    const artifactOne = path.join(root, 'one.cqbackup');
    const artifactTwo = path.join(root, 'two.cqbackup');
    encryptBackupFile({ sourcePath: localPath, destinationPath: artifactOne, encryptionKey: keyV1, keyId: 'v1', createdAt: new Date('2026-08-27T02:00:00Z') });
    encryptBackupFile({ sourcePath: localPath, destinationPath: artifactTwo, encryptionKey: keyV1, keyId: 'v1', createdAt: new Date('2026-08-27T02:00:00Z') });
    const bytesOne = fs.readFileSync(artifactOne);
    const bytesTwo = fs.readFileSync(artifactTwo);
    const parsedOne = parseArtifact(bytesOne);
    const parsedTwo = parseArtifact(bytesTwo);
    assert.strictEqual(parsedOne.header.version, 1);
    assert.strictEqual(parsedOne.header.keyId, 'v1');
    assert.notStrictEqual(parsedOne.header.nonce, parsedTwo.header.nonce);
    assert.notDeepStrictEqual(bytesOne, fs.readFileSync(localPath));
    assert(!bytesOne.includes(Buffer.from(keyV1)));
    assert(!bytesOne.includes(Buffer.alloc(32, 17)));
    assert.deepStrictEqual(decryptArtifactBuffer(bytesOne, keyV1).plaintext, fs.readFileSync(localPath));
    assert.throws(() => decryptArtifactBuffer(bytesOne, keyV2), error => error.code === 'BACKUP_AUTHENTICATION_FAILED');
    assert.throws(() => decryptArtifactBuffer(mutateCiphertext(bytesOne), keyV1), error => error.code === 'CIPHERTEXT_HASH_MISMATCH');
    assert.throws(() => decryptArtifactBuffer(mutateTag(bytesOne), keyV1), error => error.code === 'BACKUP_AUTHENTICATION_FAILED');
    assert.strictEqual(verifyEncryptedArtifact(artifactOne, keyV1).header.keyId, 'v1');
    assert.strictEqual(verifyEncryptedArtifact(artifactOne, keyV1, fs, bytesOne.length).header.keyId, 'v1');
    assert.throws(() => verifyEncryptedArtifact(artifactOne, keyV1, fs, bytesOne.length - 1),
      error => error.code === 'BACKUP_ARTIFACT_SIZE_INVALID');
    assert.strictEqual(validateArtifactSize(bytesOne.length, bytesOne.length), bytesOne.length);

    const oversizedHeaderLength = Buffer.alloc(4);
    oversizedHeaderLength.writeUInt32BE(MAX_HEADER_BYTES + 1);
    const oversizedHeader = Buffer.concat([MAGIC, oversizedHeaderLength, Buffer.alloc(MAX_HEADER_BYTES + 2)]);
    assert.throws(() => parseArtifact(oversizedHeader), error => error.code === 'INVALID_BACKUP_ARTIFACT');
    const impossibleHeaderLength = Buffer.alloc(4);
    impossibleHeaderLength.writeUInt32BE(0xffffffff);
    assert.throws(() => parseArtifact(Buffer.concat([MAGIC, impossibleHeaderLength, Buffer.from('{}x')])),
      error => error.code === 'INVALID_BACKUP_ARTIFACT');
    for (const mutated of [
      replaceHeader(bytesOne, header => { header.nonce = Buffer.alloc(11).toString('base64'); }),
      replaceHeader(bytesOne, header => { header.authTag = Buffer.alloc(15).toString('base64'); }),
      replaceHeader(bytesOne, header => { header.plaintextSha256 = 'A'.repeat(64); }),
      replaceHeader(bytesOne, header => { header.ciphertextSha256 = '0'.repeat(63); }),
      replaceHeader(bytesOne, header => { header.createdAt = 'not-a-date'; }),
      replaceHeader(bytesOne, header => { header.sourceBackupName = '../copyquick.db'; }),
      replaceHeader(bytesOne, header => { header.extra = 'ignored-before-hardening'; })
    ]) {
      assert.throws(() => parseArtifact(mutated), error => error.code === 'INVALID_BACKUP_HEADER');
    }

    const safeKey = objectKeyFor({
      prefix: 'copyquick/production', sourceBackupName: localResult.filename,
      createdAt: new Date('2026-08-27T02:00:00Z'), keyId: 'v1'
    });
    assert(recognizedObjectKey(safeKey, 'copyquick/production'));
    assert(!recognizedObjectKey('copyquick/production/../../secret.cqbackup', 'copyquick/production'));

    const storage = new FakeStorage();
    storage.objects.set('copyquick/production/unrelated.txt', { body: Buffer.from('keep'), metadata: {}, sizeBytes: 4 });
    storage.objects.set('copyquick/production/2026/08/20/copyquick-2026-08-20T010000Z-v1.cqbackup', { body: bytesOne, metadata: {}, sizeBytes: bytesOne.length });
    storage.objects.set('copyquick/production/2026/08/21/copyquick-2026-08-21T010000Z-v1.cqbackup', { body: bytesOne, metadata: {}, sizeBytes: bytesOne.length });
    const logs = [];
    const result = await createOffsiteBackup({
      source: localPath, env: baseEnv, storage, logger: event => logs.push(event),
      now: () => new Date('2026-08-27T02:00:00Z')
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(storage.puts.length, 1);
    assert.notDeepStrictEqual(storage.puts[0].body, fs.readFileSync(localPath), 'plaintext database must never be uploaded');
    assert.strictEqual(storage.puts[0].metadata.ciphertextsha256, parseArtifact(storage.puts[0].body).header.ciphertextSha256);
    assert(storage.deletes.includes('copyquick/production/2026/08/20/copyquick-2026-08-20T010000Z-v1.cqbackup'));
    assert(storage.objects.has('copyquick/production/unrelated.txt'));
    assert.strictEqual([...storage.objects.keys()].filter(key => recognizedObjectKey(key, baseEnv.OFFSITE_BACKUP_PREFIX)).length, 2);
    const config = resolveOffsiteConfig(baseEnv, { requireSecrets: false });
    assert.strictEqual(fs.readdirSync(config.stagingDirectory).length, 0, 'encrypted staging artifact must be removed');
    assert(!JSON.stringify(logs).includes(keyV1));
    assert(!JSON.stringify(logs).includes(baseEnv.OFFSITE_BACKUP_SECRET_ACCESS_KEY));

    const recent = inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-27T03:00:00Z') });
    assert.strictEqual(recent.status, 'healthy');
    const stateConfig = resolveOffsiteConfig(baseEnv, { requireSecrets: false });
    writeOffsiteState(stateConfig, successState({ lastFailureCode: 'REMOTE_TIMEOUT' }));
    assert.strictEqual(inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-27T00:00:00Z') }).status, 'warning');
    assert.strictEqual(inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-29T00:00:00Z') }).status, 'critical');
    const freshnessJson = JSON.stringify(inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-29T00:00:00Z') }));
    assert(!freshnessJson.includes(baseEnv.OFFSITE_BACKUP_SECRET_ACCESS_KEY));
    assert(!freshnessJson.includes(keyV1));
    writeOffsiteState(stateConfig, successState({ lastSuccessAt: 'malformed' }));
    assert.strictEqual(inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-27T00:00:00Z') }).status, 'critical');
    writeOffsiteState(stateConfig, successState({ lastSuccessAt: '2099-01-01T00:00:00.000Z' }));
    assert.strictEqual(inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-27T00:00:00Z') }).status, 'critical');
    writeOffsiteState(stateConfig, successState({ lastSuccessAt: '2026-08-27T00:04:00.000Z' }));
    assert.strictEqual(inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-27T00:00:00Z') }).status, 'healthy');
    writeOffsiteState(stateConfig, { lastSuccessAt: '2026-08-25T00:00:00.000Z', keyId: 'v1' });
    assert.strictEqual(inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-27T00:00:00Z') }).status, 'critical');
    fs.writeFileSync(stateConfig.statePath, '{malformed json', { mode: 0o600 });
    assert.strictEqual(inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-27T00:00:00Z') }).status, 'critical');

    const noUpload = new FakeStorage();
    const invalidLocal = path.join(persistent, 'backups', 'copyquick-2026-08-27T030000Z.db');
    fs.writeFileSync(invalidLocal, 'invalid sqlite');
    await assert.rejects(createOffsiteBackup({ source: invalidLocal, env: baseEnv, storage: noUpload, logger: () => {} }));
    assert.strictEqual(noUpload.puts.length, 0);
    const symlinkSource = path.join(persistent, 'backups', 'copyquick-2026-08-27T031000Z.db');
    fs.symlinkSync(artifactOne, symlinkSource);
    await assert.rejects(createOffsiteBackup({ source: symlinkSource, env: baseEnv, storage: noUpload, logger: () => {} }),
      error => error.code === 'UNTRUSTED_LOCAL_BACKUP');
    const hardlinkSource = path.join(persistent, 'backups', 'copyquick-2026-08-27T032000Z.db');
    fs.linkSync(databasePath, hardlinkSource);
    await assert.rejects(createOffsiteBackup({ source: hardlinkSource, env: baseEnv, storage: noUpload, logger: () => {} }),
      error => error.code === 'LIVE_DATABASE_SOURCE_REJECTED');
    const oversizedLocal = path.join(persistent, 'backups', 'copyquick-2026-08-27T033000Z.db');
    fs.copyFileSync(localPath, oversizedLocal);
    const oversizedDb = new Database(oversizedLocal);
    oversizedDb.exec('CREATE TABLE size_padding(value BLOB);');
    oversizedDb.prepare('INSERT INTO size_padding(value) VALUES(zeroblob(?))').run(2 * 1024 * 1024);
    oversizedDb.close();
    await assert.rejects(createOffsiteBackup({
      source: oversizedLocal,
      env: { ...baseEnv, OFFSITE_BACKUP_MAX_ARTIFACT_BYTES: String(1024 * 1024) },
      storage: noUpload,
      logger: () => {}
    }), error => error.code === 'LOCAL_BACKUP_TOO_LARGE');

    const badHeadStorage = new FakeStorage();
    badHeadStorage.headObject = async key => {
      const actual = await FakeStorage.prototype.headObject.call(badHeadStorage, key);
      return { ...actual, sizeBytes: actual.sizeBytes + 1 };
    };
    const preservedSuccessAt = '2026-08-27T03:30:00.000Z';
    writeOffsiteState(stateConfig, successState({ lastSuccessAt: preservedSuccessAt }));
    await assert.rejects(
      createOffsiteBackup({ source: localPath, env: baseEnv, storage: badHeadStorage, logger: () => {}, now: () => new Date('2026-08-27T04:00:00Z') }),
      error => error.code === 'REMOTE_VERIFICATION_FAILED'
    );
    const afterFailedAttempt = inspectOffsiteFreshness({ env: baseEnv, now: () => new Date('2026-08-27T04:00:00Z') });
    assert.strictEqual(afterFailedAttempt.lastSuccessAt, preservedSuccessAt);
    assert.strictEqual(afterFailedAttempt.status, 'healthy');
    assert.strictEqual(afterFailedAttempt.lastFailureCode, 'REMOTE_VERIFICATION_FAILED');
    assert.strictEqual(readOffsiteState(stateConfig).retryEligibleAt, '2026-08-27T05:00:00.000Z',
      'failed operations persist one-hour retry eligibility without replacing verified success');
    assert.strictEqual(readOffsiteState(stateConfig).consecutiveFailureCount, 1);
    await assert.rejects(
      createOffsiteBackup({ source: localPath, env: baseEnv, storage: badHeadStorage, logger: () => {}, now: () => new Date('2026-08-27T04:01:00Z') }),
      error => error.code === 'REMOTE_VERIFICATION_FAILED'
    );
    assert.strictEqual(readOffsiteState(stateConfig).consecutiveFailureCount, 2,
      'each distinct failed operation increments the durable count once');
    await createOffsiteBackup({
      source: localPath, env: baseEnv, storage: new FakeStorage(), logger: () => {},
      now: () => new Date('2026-08-27T04:02:00Z')
    });
    assert.strictEqual(readOffsiteState(stateConfig).consecutiveFailureCount, 0,
      'verified success resets consecutive failure tracking');
    assert.strictEqual(readOffsiteState(stateConfig).lastFailureAt, null);
    assert.strictEqual(fs.readdirSync(config.stagingDirectory).length, 0);

    const retentionFailureStorage = new FakeStorage();
    retentionFailureStorage.objects.set('copyquick/production/2026/08/20/copyquick-2026-08-20T010000Z-v1.cqbackup', { body: bytesOne, metadata: {}, sizeBytes: bytesOne.length });
    retentionFailureStorage.deleteObject = async () => { throw Object.assign(new Error('denied'), { code: 'DENIED' }); };
    const retentionConfig = { ...config, retention: 0 };
    const retentionResult = await applyRemoteRetention({ storage: retentionFailureStorage, config: retentionConfig });
    assert.strictEqual(retentionResult.failures.length, 1);

    const protectedKey = 'copyquick/production/2026/08/27/copyquick-2026-08-27T010000Z-v1.cqbackup';
    const futureKey = 'copyquick/production/2099/01/01/copyquick-2099-01-01T010000Z-v1.cqbackup';
    const unrelatedKey = 'copyquick/production/manual-export.cqbackup';
    const protectedRetention = new FakeStorage();
    protectedRetention.objects.set(protectedKey, { body: bytesOne, metadata: {}, sizeBytes: bytesOne.length, lastModified: new Date('2026-08-27') });
    protectedRetention.objects.set(futureKey, { body: bytesOne, metadata: {}, sizeBytes: bytesOne.length, lastModified: new Date('2099-01-01') });
    protectedRetention.objects.set(unrelatedKey, { body: Buffer.from('keep'), metadata: {}, sizeBytes: 4 });
    protectedRetention.listObjects = async function (prefix) { return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, lastModified: value.lastModified }));
    };
    await applyRemoteRetention({ storage: protectedRetention, config: { ...config, retention: 1 }, protectedObjectKey: protectedKey });
    assert(protectedRetention.objects.has(protectedKey), 'newly verified object must be protected even against future-dated objects');
    assert(!protectedRetention.objects.has(futureKey));
    assert(protectedRetention.objects.has(unrelatedKey));

    const suffixTwo = 'copyquick/production/2026/08/27/copyquick-2026-08-27T010000Z-2-v1.cqbackup';
    const suffixTen = 'copyquick/production/2026/08/27/copyquick-2026-08-27T010000Z-10-v1.cqbackup';
    const suffixStorage = new FakeStorage();
    suffixStorage.objects.set(suffixTwo, { body: bytesOne, metadata: {}, sizeBytes: bytesOne.length, lastModified: null });
    suffixStorage.objects.set(suffixTen, { body: bytesOne, metadata: {}, sizeBytes: bytesOne.length, lastModified: 'invalid' });
    suffixStorage.listObjects = protectedRetention.listObjects.bind(suffixStorage);
    await applyRemoteRetention({ storage: suffixStorage, config: { ...config, retention: 1 } });
    assert(!suffixStorage.objects.has(suffixTwo));
    assert(suffixStorage.objects.has(suffixTen), 'collision suffixes must sort numerically');

    for (const invalidLength of [0, -1, NaN, Infinity, '12', config.maxArtifactBytes + 1]) {
      assert.throws(() => validateRemoteContentLength(invalidLength, config.maxArtifactBytes),
        error => error.code === 'REMOTE_CONTENT_LENGTH_INVALID');
    }
    assert.strictEqual(validateRemoteContentLength(config.maxArtifactBytes, config.maxArtifactBytes), config.maxArtifactBytes);

    async function * oversizedBody() {
      yield Buffer.alloc(4);
      yield Buffer.alloc(5);
    }
    let destroyed = false;
    const body = oversizedBody();
    body.destroy = () => { destroyed = true; };
    const streamingStorage = new S3CompatibleStorage({
      bucket: 'test',
      client: { send: async () => ({ Body: body }) }
    });
    await assert.rejects(streamingStorage.getObject('safe-key', { expectedSize: 4, maxBytes: 8 }),
      error => error.code === 'REMOTE_OBJECT_SIZE_EXCEEDED');
    assert.strictEqual(destroyed, true);

    const lyingHeadStorage = new FakeStorage();
    lyingHeadStorage.objects.set(result.objectKey, storage.objects.get(result.objectKey));
    lyingHeadStorage.headObject = async () => ({
      sizeBytes: 1,
      metadata: storage.objects.get(result.objectKey).metadata
    });
    lyingHeadStorage.getObject = async (_key, options) => {
      assert.strictEqual(options.expectedSize, 1);
      throw Object.assign(new Error('stream exceeded bound'), { code: 'REMOTE_OBJECT_SIZE_EXCEEDED' });
    };
    await assert.rejects(prepareOffsiteRestore({ objectKey: result.objectKey, env: baseEnv, storage: lyingHeadStorage, logger: () => {} }),
      error => error.code === 'REMOTE_OBJECT_SIZE_EXCEEDED');

    const uploadedKey = result.objectKey;
    const prepared = await prepareOffsiteRestore({ objectKey: uploadedKey, env: baseEnv, storage, logger: () => {} });
    assert.strictEqual(prepared.keyId, 'v1');
    assert.strictEqual(verifySqliteBackup(prepared.restoreCandidatePath).quickCheck, 'ok');
    assert(fs.existsSync(databasePath), 'preparation must not replace production');
    await assert.rejects(prepareOffsiteRestore({ objectKey: 'unrelated/object', env: baseEnv, storage, logger: () => {} }),
      error => error.code === 'UNRECOGNIZED_REMOTE_OBJECT');
    fs.unlinkSync(prepared.restoreCandidatePath);

    const v2Env = { ...baseEnv, OFFSITE_BACKUP_KEY_ID: 'v2', OFFSITE_BACKUP_ENCRYPTION_KEY: keyV2 };
    await assert.rejects(prepareOffsiteRestore({ objectKey: uploadedKey, env: v2Env, storage, logger: () => {} }),
      error => error.code === 'BACKUP_KEY_ID_UNAVAILABLE');
    const rotationCandidate = await prepareOffsiteRestore({
      objectKey: uploadedKey, env: v2Env, storage, decryptionKey: keyV1,
      decryptionKeyId: 'v1', logger: () => {}
    });
    assert.strictEqual(rotationCandidate.keyId, 'v1');
    fs.unlinkSync(rotationCandidate.restoreCandidatePath);

    const tamperedStorage = new FakeStorage();
    const remoteObject = storage.objects.get(uploadedKey);
    tamperedStorage.objects.set(uploadedKey, { ...remoteObject, body: mutateCiphertext(remoteObject.body) });
    await assert.rejects(prepareOffsiteRestore({ objectKey: uploadedKey, env: baseEnv, storage: tamperedStorage, logger: () => {} }));

    const cleanupLogs = [];
    const cleanupFailingFs = Object.create(fs);
    cleanupFailingFs.unlinkSync = candidate => {
      if (path.basename(candidate).startsWith('.download-')) {
        throw Object.assign(new Error('path and secret must not be logged'), { code: 'EACCES\nsecret=value' });
      }
      return fs.unlinkSync(candidate);
    };
    await assert.rejects(
      prepareOffsiteRestore({
        objectKey: uploadedKey,
        env: baseEnv,
        storage: tamperedStorage,
        fsApi: cleanupFailingFs,
        logger: event => cleanupLogs.push(event)
      }),
      error => error.code === 'CIPHERTEXT_HASH_MISMATCH'
    );
    const cleanupEvent = cleanupLogs.find(event => event.event === 'offsite_restore_cleanup_failed');
    assert(cleanupEvent);
    assert.deepStrictEqual(Object.keys(cleanupEvent).sort(), ['artifactClass', 'code', 'event']);
    assert.strictEqual(cleanupEvent.artifactClass, 'encrypted_staging');
    assert.strictEqual(cleanupEvent.code, 'RESTORE_CLEANUP_FAILED');
    assert(!JSON.stringify(cleanupLogs).includes('secret=value'));

    assert.strictEqual(normalizeOperationalCode('AccessDenied'), 'ACCESSDENIED');
    assert.strictEqual(normalizeOperationalCode('REMOTE_TIMEOUT_2'), 'REMOTE_TIMEOUT_2');
    for (const unsafeCode of ['', 'contains spaces', 'line\nbreak', '☃', 'A'.repeat(65), undefined]) {
      assert.strictEqual(normalizeOperationalCode(unsafeCode), 'OFFSITE_OPERATION_FAILED');
    }

    const maliciousFailureStorage = new FakeStorage();
    maliciousFailureStorage.putObject = async () => {
      throw Object.assign(new Error('provider details'), { code: 'SECRET token\n' + 'X'.repeat(100) });
    };
    const failureLogs = [];
    writeOffsiteState(stateConfig, successState({ lastSuccessAt: '2026-08-27T04:30:00.000Z' }));
    await assert.rejects(createOffsiteBackup({
      source: localPath,
      env: baseEnv,
      storage: maliciousFailureStorage,
      logger: event => failureLogs.push(event),
      now: () => new Date('2026-08-27T05:00:00Z')
    }));
    assert(failureLogs.every(event => !JSON.stringify(event).includes('SECRET token')));
    assert.strictEqual(inspectOffsiteFreshness({
      env: baseEnv,
      now: () => new Date('2026-08-27T05:00:00Z')
    }).lastFailureCode, 'OFFSITE_OPERATION_FAILED');

    console.log('Story 3.14 encrypted off-site backup tests passed.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
