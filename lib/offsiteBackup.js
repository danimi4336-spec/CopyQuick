const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  BACKUP_PATTERN,
  cleanupSnapshotSidecars,
  createDatabaseBackup,
  resolveBackupConfig,
  verifySqliteBackup
} = require('./databaseBackup');
const { isWithinDirectory } = require('./databasePath');
const {
  DEFAULT_MAX_ARTIFACT_BYTES,
  MAX_HEADER_BYTES,
  decodeEncryptionKey,
  decryptArtifactFile,
  encryptBackupFile,
  parseArtifact,
  verifyEncryptedArtifact
} = require('./backupEncryption');
const { S3CompatibleStorage } = require('./offsiteStorage');
const { acquireBackupOperationLock, startBackupOperationHeartbeat } = require('./backupOperationLock');

const DEFAULT_PREFIX = 'copyquick/production';
const DEFAULT_REMOTE_RETENTION = 30;
const DEFAULT_MAX_AGE_HOURS = 36;
const MAX_REMOTE_RETENTION = 365;
// The current implementation can transiently hold 3-5 copies while encrypting
// and validating. Capping configuration at 64 MiB keeps worst-case backup
// memory bounded on the 512 MiB Render Starter service.
const MAX_CONFIGURED_ARTIFACT_BYTES = DEFAULT_MAX_ARTIFACT_BYTES;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const DEFAULT_FAILURE_RETRY_MS = 60 * 60 * 1000;
const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;

class OffsiteBackupError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OffsiteBackupError';
    this.code = code;
  }
}

function configured(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOperationalCode(value, fallback = 'OFFSITE_OPERATION_FAILED') {
  const safeFallback = typeof fallback === 'string' && SAFE_CODE_PATTERN.test(fallback)
    ? fallback
    : 'OFFSITE_OPERATION_FAILED';
  if (typeof value !== 'string') return safeFallback;
  const normalized = value.trim().toUpperCase();
  return SAFE_CODE_PATTERN.test(normalized) ? normalized : safeFallback;
}

function enabled(env = process.env) {
  return configured(env.OFFSITE_BACKUP_ENABLED).toLowerCase() === 'true';
}

function parseBoundedInteger(value, fallback, name, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new OffsiteBackupError(`${name} must be an integer between ${minimum} and ${maximum}.`, `INVALID_${name}`);
  }
  return parsed;
}

function normalizePrefix(value) {
  const prefix = configured(value) || DEFAULT_PREFIX;
  if (prefix.startsWith('/') || prefix.endsWith('/') || prefix.includes('..') ||
      !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(prefix) || prefix.split('/').some(part => !part)) {
    throw new OffsiteBackupError('Off-site backup prefix is unsafe.', 'INVALID_OFFSITE_BACKUP_PREFIX');
  }
  return prefix;
}

function required(value, code) {
  const result = configured(value);
  if (!result || /^(replace|your[_ -]?)/i.test(result)) throw new OffsiteBackupError('Off-site backup configuration is incomplete.', code);
  return result;
}

function resolveOffsiteConfig(env = process.env, { requireSecrets = true, createDirectories = false, fsApi = fs } = {}) {
  const local = resolveBackupConfig(env, { createDirectory: createDirectories, fsApi });
  const isEnabled = enabled(env);
  const prefix = normalizePrefix(env.OFFSITE_BACKUP_PREFIX);
  const stagingDirectory = path.resolve(local.backupDirectory, 'offsite-staging');
  const recoveryDirectory = path.resolve(local.backupDirectory, 'offsite-recovery');
  if (!isWithinDirectory(stagingDirectory, local.backupDirectory) || !isWithinDirectory(recoveryDirectory, local.backupDirectory)) {
    throw new OffsiteBackupError('Off-site staging configuration is unsafe.', 'OFFSITE_STAGING_UNSAFE');
  }
  if (createDirectories) {
    for (const directory of [stagingDirectory, recoveryDirectory]) {
      if (!fsApi.existsSync(directory)) fsApi.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
  }
  const config = {
    enabled: isEnabled,
    prefix,
    local,
    stagingDirectory,
    recoveryDirectory,
    statePath: path.join(local.backupDirectory, '.offsite-backup-state.json'),
    retention: parseBoundedInteger(env.OFFSITE_BACKUP_RETENTION, DEFAULT_REMOTE_RETENTION, 'OFFSITE_BACKUP_RETENTION', 1, MAX_REMOTE_RETENTION),
    maxAgeHours: parseBoundedInteger(env.OFFSITE_BACKUP_MAX_AGE_HOURS, DEFAULT_MAX_AGE_HOURS, 'OFFSITE_BACKUP_MAX_AGE_HOURS', 1, 24 * 30),
    maxArtifactBytes: parseBoundedInteger(
      env.OFFSITE_BACKUP_MAX_ARTIFACT_BYTES,
      DEFAULT_MAX_ARTIFACT_BYTES,
      'OFFSITE_BACKUP_MAX_ARTIFACT_BYTES',
      1024 * 1024,
      MAX_CONFIGURED_ARTIFACT_BYTES
    )
  };
  if (!isEnabled || !requireSecrets) return config;
  config.endpoint = configured(env.OFFSITE_BACKUP_ENDPOINT) || null;
  config.region = required(env.OFFSITE_BACKUP_REGION, 'OFFSITE_REGION_REQUIRED');
  config.bucket = required(env.OFFSITE_BACKUP_BUCKET, 'OFFSITE_BUCKET_REQUIRED');
  config.accessKeyId = required(env.OFFSITE_BACKUP_ACCESS_KEY_ID, 'OFFSITE_ACCESS_KEY_REQUIRED');
  config.secretAccessKey = required(env.OFFSITE_BACKUP_SECRET_ACCESS_KEY, 'OFFSITE_SECRET_KEY_REQUIRED');
  config.keyId = required(env.OFFSITE_BACKUP_KEY_ID, 'OFFSITE_KEY_ID_REQUIRED');
  config.encryptionKey = decodeEncryptionKey(required(env.OFFSITE_BACKUP_ENCRYPTION_KEY, 'OFFSITE_ENCRYPTION_KEY_REQUIRED'));
  return config;
}

function stateDefaults() {
  return {
    lastAttemptAt: null, lastSuccessAt: null, lastSuccessObjectKey: null,
    lastFailureCode: null, retryEligibleAt: null, keyId: null,
    artifactSizeBytes: null, ciphertextSha256: null
  };
}

function readOffsiteState(config, fsApi = fs) {
  try {
    const parsed = JSON.parse(fsApi.readFileSync(config.statePath, 'utf8'));
    return { ...stateDefaults(), ...parsed };
  } catch (error) {
    if (error && error.code !== 'ENOENT') return { ...stateDefaults(), stateInvalid: true };
    return stateDefaults();
  }
}

function writeOffsiteState(config, state, fsApi = fs) {
  const temporaryPath = `${config.statePath}.${crypto.randomUUID()}.tmp`;
  try {
    fsApi.writeFileSync(temporaryPath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    fsApi.chmodSync(temporaryPath, 0o600);
    fsApi.renameSync(temporaryPath, config.statePath);
  } finally {
    if (fsApi.existsSync(temporaryPath)) {
      try { fsApi.unlinkSync(temporaryPath); } catch (_) {}
    }
  }
}

function objectKeyFor({ prefix, sourceBackupName, createdAt, keyId }) {
  if (!BACKUP_PATTERN.test(sourceBackupName)) throw new OffsiteBackupError('Source backup filename is not recognized.', 'UNRECOGNIZED_LOCAL_BACKUP');
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new OffsiteBackupError('Backup timestamp is invalid.', 'INVALID_BACKUP_TIMESTAMP');
  const safeKeyId = configured(keyId);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(safeKeyId)) throw new OffsiteBackupError('Backup key ID is invalid.', 'INVALID_KEY_ID');
  const stem = sourceBackupName.replace(/\.db$/, '');
  return `${normalizePrefix(prefix)}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${stem}-${safeKeyId}.cqbackup`;
}

function recognizedObjectKey(key, prefix) {
  const safePrefix = normalizePrefix(prefix);
  const escaped = safePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}/\\d{4}/\\d{2}/\\d{2}/copyquick-\\d{4}-\\d{2}-\\d{2}T\\d{6}Z(?:-\\d+)?-[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.cqbackup$`).test(key);
}

function validateLocalSource(source, config, fsApi = fs) {
  const sourcePath = path.resolve(source);
  let realSourcePath;
  let realBackupDirectory;
  try {
    realSourcePath = fsApi.realpathSync(sourcePath);
    realBackupDirectory = fsApi.realpathSync(config.local.backupDirectory);
  } catch (error) {
    throw new OffsiteBackupError('Local backup source is unavailable.', 'UNTRUSTED_LOCAL_BACKUP', error);
  }
  if (!isWithinDirectory(realSourcePath, realBackupDirectory) || !BACKUP_PATTERN.test(path.basename(sourcePath))) {
    throw new OffsiteBackupError('Local backup source is outside the trusted backup directory.', 'UNTRUSTED_LOCAL_BACKUP');
  }
  const stats = fsApi.statSync(realSourcePath);
  if (!stats.isFile()) throw new OffsiteBackupError('Local backup source is invalid.', 'UNTRUSTED_LOCAL_BACKUP');
  if (!Number.isSafeInteger(stats.size) || stats.size <= 0 ||
      stats.size > config.maxArtifactBytes - MAX_HEADER_BYTES - 12) {
    throw new OffsiteBackupError('Local backup exceeds configured off-site artifact limits.', 'LOCAL_BACKUP_TOO_LARGE');
  }
  if (fsApi.existsSync(config.local.databasePath)) {
    const liveStats = fsApi.statSync(config.local.databasePath);
    if (stats.dev === liveStats.dev && stats.ino === liveStats.ino) {
      throw new OffsiteBackupError('Local backup source cannot be the live database.', 'LIVE_DATABASE_SOURCE_REJECTED');
    }
  }
  try {
    verifySqliteBackup(realSourcePath, { fsApi });
  } finally {
    cleanupSnapshotSidecars(realSourcePath, { liveDatabasePath: config.local.databasePath, fsApi });
  }
  return realSourcePath;
}

function createStorage(config, storage) {
  return storage || new S3CompatibleStorage({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey
  });
}

function fallbackObjectTimestamp(key, prefix) {
  const safePrefix = normalizePrefix(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = key.match(new RegExp(`^${safePrefix}/\\d{4}/\\d{2}/\\d{2}/copyquick-(\\d{4}-\\d{2}-\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z(?:-(\\d+))?-[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.cqbackup$`));
  if (!match) return { timestamp: 0, collision: 0 };
  const timestamp = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return { timestamp: Number.isFinite(timestamp) ? timestamp : 0, collision: Number(match[5] || 0) };
}

function remoteObjectOrder(object, prefix, index) {
  const fallback = fallbackObjectTimestamp(object.key, prefix);
  const lastModified = object.lastModified == null ? NaN : new Date(object.lastModified).getTime();
  return {
    ...object,
    orderTimestamp: Number.isFinite(lastModified) ? lastModified : fallback.timestamp,
    collision: fallback.collision,
    originalIndex: index
  };
}

async function applyRemoteRetention({ storage, config, protectedObjectKey }) {
  const objects = (await storage.listObjects(`${config.prefix}/`))
    .filter(object => recognizedObjectKey(object.key, config.prefix))
    .map((object, index) => remoteObjectOrder(object, config.prefix, index))
    .sort((a, b) => b.orderTimestamp - a.orderTimestamp || b.collision - a.collision ||
      b.key.localeCompare(a.key) || a.originalIndex - b.originalIndex);
  const protectedPresent = protectedObjectKey && objects.some(object => object.key === protectedObjectKey);
  const keepSlots = Math.max(0, config.retention - (protectedPresent ? 1 : 0));
  const unprotected = objects.filter(object => object.key !== protectedObjectKey);
  const expired = unprotected.slice(keepSlots);
  const deleted = [];
  const failures = [];
  for (const object of expired) {
    try { await storage.deleteObject(object.key); deleted.push(object.key); }
    catch (error) { failures.push({ code: normalizeOperationalCode(error.code, 'REMOTE_DELETE_FAILED') }); }
  }
  return { kept: objects.length - deleted.length, deletedCount: deleted.length, failures };
}

function safeLog(logger, event, details = {}) {
  if (!logger) return;
  const sanitized = { ...details };
  if ('code' in sanitized) sanitized.code = normalizeOperationalCode(sanitized.code);
  try { logger({ event, ...sanitized }); } catch (_) {}
}

function validateRemoteContentLength(value, maximumBytes) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximumBytes) {
    throw new OffsiteBackupError('Remote backup ContentLength is invalid.', 'REMOTE_CONTENT_LENGTH_INVALID');
  }
  return value;
}

function cleanupRestoreSidecars(snapshotPath, artifactClass, config, fsApi, logger) {
  const result = cleanupSnapshotSidecars(snapshotPath, {
    liveDatabasePath: config.local.databasePath,
    fsApi
  });
  for (const failure of result.failures || []) {
    safeLog(logger, 'offsite_restore_cleanup_failed', {
      artifactClass,
      code: normalizeOperationalCode(failure.code, 'RESTORE_CLEANUP_FAILED')
    });
  }
  return result;
}

async function createOffsiteBackup({
  source, env = process.env, storage, fsApi = fs, now = () => new Date(),
  logger = entry => console.log(JSON.stringify(entry)), operationLock = null,
  failureRetryMs = DEFAULT_FAILURE_RETRY_MS
} = {}) {
  const config = resolveOffsiteConfig(env, { requireSecrets: true, createDirectories: true, fsApi });
  if (!config.enabled) throw new OffsiteBackupError('Off-site backups are disabled.', 'OFFSITE_BACKUP_DISABLED');
  let ownedOperationLock = null;
  let stopOperationHeartbeat = () => {};
  if (!operationLock) {
    ownedOperationLock = acquireBackupOperationLock(config.local.backupDirectory, { fsApi });
    try { stopOperationHeartbeat = startBackupOperationHeartbeat(ownedOperationLock); }
    catch (error) { ownedOperationLock.release(); throw error; }
    operationLock = ownedOperationLock;
  }
  let attemptAt;
  let artifactPath;
  try {
    attemptAt = now().toISOString();
    const previousState = readOffsiteState(config, fsApi);
    writeOffsiteState(config, { ...previousState, lastAttemptAt: attemptAt, lastFailureCode: null }, fsApi);
    let sourcePath;
    if (source) sourcePath = validateLocalSource(source, config, fsApi);
    else {
      const localResult = await createDatabaseBackup({ env, fsApi, logger, operationLock });
      sourcePath = path.join(config.local.backupDirectory, localResult.filename);
    }
    if (typeof operationLock.isOwner === 'function' && !operationLock.isOwner()) {
      throw new OffsiteBackupError('Backup operation ownership was lost.', 'BACKUP_OPERATION_OWNERSHIP_LOST');
    }
    const createdAt = now();
    const objectKey = objectKeyFor({ prefix: config.prefix, sourceBackupName: path.basename(sourcePath), createdAt, keyId: config.keyId });
    artifactPath = path.join(config.stagingDirectory, `.offsite-${crypto.randomUUID()}.tmp`);
    const sourceStats = fsApi.statSync(sourcePath);
    if (!Number.isSafeInteger(sourceStats.size) || sourceStats.size <= 0 ||
        sourceStats.size > config.maxArtifactBytes - MAX_HEADER_BYTES - 12) {
      throw new OffsiteBackupError('Local backup exceeds configured off-site artifact limits.', 'LOCAL_BACKUP_TOO_LARGE');
    }
    const encrypted = encryptBackupFile({
      sourcePath, destinationPath: artifactPath, encryptionKey: config.encryptionKey,
      keyId: config.keyId, createdAt, fsApi, maxArtifactBytes: config.maxArtifactBytes
    });
    const verified = verifyEncryptedArtifact(artifactPath, config.encryptionKey, fsApi, config.maxArtifactBytes);
    if (typeof operationLock.isOwner === 'function' && !operationLock.isOwner()) {
      throw new OffsiteBackupError('Backup operation ownership was lost.', 'BACKUP_OPERATION_OWNERSHIP_LOST');
    }
    const remote = createStorage(config, storage);
    safeLog(logger, 'offsite_upload_started', { keyId: config.keyId, sizeBytes: encrypted.sizeBytes });
    await remote.putObject({
      key: objectKey,
      filePath: artifactPath,
      sizeBytes: encrypted.sizeBytes,
      metadata: {
        formatversion: String(verified.header.version),
        keyid: verified.header.keyId,
        ciphertextsha256: verified.header.ciphertextSha256
      }
    });
    const head = await remote.headObject(objectKey);
    if (head.sizeBytes !== encrypted.sizeBytes || head.metadata.ciphertextsha256 !== verified.header.ciphertextSha256 ||
        head.metadata.keyid !== config.keyId || head.metadata.formatversion !== String(verified.header.version)) {
      throw new OffsiteBackupError('Remote backup verification failed.', 'REMOTE_VERIFICATION_FAILED');
    }
    if (typeof operationLock.isOwner === 'function' && !operationLock.isOwner()) {
      throw new OffsiteBackupError('Backup operation ownership was lost.', 'BACKUP_OPERATION_OWNERSHIP_LOST');
    }
    let retention;
    try { retention = await applyRemoteRetention({ storage: remote, config, protectedObjectKey: objectKey }); }
    catch (error) { retention = { kept: null, deletedCount: 0, failures: [{ code: normalizeOperationalCode(error.code, 'REMOTE_RETENTION_FAILED') }] }; }
    const successState = {
      lastAttemptAt: attemptAt,
      lastSuccessAt: now().toISOString(),
      lastSuccessObjectKey: objectKey,
      lastFailureCode: null,
      retryEligibleAt: null,
      keyId: config.keyId,
      artifactSizeBytes: encrypted.sizeBytes,
      ciphertextSha256: verified.header.ciphertextSha256
    };
    writeOffsiteState(config, successState, fsApi);
    safeLog(logger, 'offsite_backup_completed', { keyId: config.keyId, sizeBytes: encrypted.sizeBytes, retentionFailureCount: retention.failures.length });
    return { success: true, objectKey, sizeBytes: encrypted.sizeBytes, keyId: config.keyId, retention };
  } catch (error) {
    try {
      writeOffsiteState(config, {
        ...readOffsiteState(config, fsApi),
        lastAttemptAt: attemptAt || now().toISOString(),
        lastFailureCode: normalizeOperationalCode(error.code),
        retryEligibleAt: new Date(new Date(attemptAt || now().toISOString()).getTime() + failureRetryMs).toISOString()
      }, fsApi);
    } catch (_) {}
    safeLog(logger, 'offsite_backup_failed', { code: error.code || 'OFFSITE_BACKUP_FAILED' });
    throw error;
  } finally {
    if (artifactPath && fsApi.existsSync(artifactPath)) {
      try { fsApi.unlinkSync(artifactPath); } catch (error) { safeLog(logger, 'offsite_staging_cleanup_failed', { code: error.code || 'STAGING_DELETE_FAILED' }); }
    }
    stopOperationHeartbeat();
    if (ownedOperationLock) ownedOperationLock.release();
  }
}

function inspectOffsiteFreshness({ env = process.env, fsApi = fs, now = () => new Date() } = {}) {
  if (!enabled(env)) return { enabled: false, status: 'disabled', lastSuccessAt: null, ageHours: null, keyId: null, remoteRetention: null };
  const config = resolveOffsiteConfig(env, { requireSecrets: false, createDirectories: false, fsApi });
  const state = readOffsiteState(config, fsApi);
  if (state.stateInvalid) {
    return {
      enabled: true, status: 'critical', lastSuccessAt: null, ageHours: null, keyId: null,
      remoteRetention: config.retention, lastFailureCode: 'INVALID_OFFSITE_STATE'
    };
  }
  if (!state.lastSuccessAt) {
    return { enabled: true, status: 'never_succeeded', lastSuccessAt: null, ageHours: null, keyId: state.keyId, remoteRetention: config.retention, lastFailureCode: state.lastFailureCode ? normalizeOperationalCode(state.lastFailureCode) : null };
  }
  const successTime = typeof state.lastSuccessAt === 'string' ? new Date(state.lastSuccessAt) : null;
  const successTimestamp = successTime?.getTime();
  const validTimestamp = Number.isFinite(successTimestamp) && successTime.toISOString() === state.lastSuccessAt;
  const validRecord = validTimestamp && typeof state.keyId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(state.keyId) &&
    Number.isSafeInteger(state.artifactSizeBytes) && state.artifactSizeBytes > 0 && state.artifactSizeBytes <= config.maxArtifactBytes &&
    typeof state.ciphertextSha256 === 'string' && /^[a-f0-9]{64}$/.test(state.ciphertextSha256) &&
    typeof state.lastSuccessObjectKey === 'string' && recognizedObjectKey(state.lastSuccessObjectKey, config.prefix);
  const currentTimestamp = now().getTime();
  if (!validRecord || successTimestamp > currentTimestamp + CLOCK_SKEW_TOLERANCE_MS) {
    return {
      enabled: true, status: 'critical', lastSuccessAt: null, ageHours: null, keyId: null,
      remoteRetention: config.retention, lastFailureCode: 'INVALID_OFFSITE_STATE'
    };
  }
  const ageHours = Math.max(0, (currentTimestamp - successTimestamp) / 3600000);
  const status = ageHours <= config.maxAgeHours ? 'healthy' : ageHours <= config.maxAgeHours * 2 ? 'warning' : 'critical';
  return {
    enabled: true,
    status,
    lastSuccessAt: state.lastSuccessAt,
    ageHours: Number(ageHours.toFixed(1)),
    keyId: state.keyId,
    remoteRetention: config.retention,
    lastFailureCode: state.lastFailureCode ? normalizeOperationalCode(state.lastFailureCode) : null
  };
}

async function prepareOffsiteRestore({ objectKey, env = process.env, storage, decryptionKey, decryptionKeyId, fsApi = fs, now = () => new Date(), logger = entry => console.log(JSON.stringify(entry)) } = {}) {
  const config = resolveOffsiteConfig(env, { requireSecrets: true, createDirectories: true, fsApi });
  if (!config.enabled) throw new OffsiteBackupError('Off-site backups are disabled.', 'OFFSITE_BACKUP_DISABLED');
  if (!recognizedObjectKey(objectKey, config.prefix)) throw new OffsiteBackupError('Remote backup object is not recognized.', 'UNRECOGNIZED_REMOTE_OBJECT');
  const remote = createStorage(config, storage);
  const encryptedPath = path.join(config.stagingDirectory, `.download-${crypto.randomUUID()}.tmp`);
  let plaintextTemporaryPath;
  try {
    const head = await remote.headObject(objectKey);
    const expectedSize = validateRemoteContentLength(head.sizeBytes, config.maxArtifactBytes);
    const body = await remote.getObject(objectKey, { expectedSize, maxBytes: config.maxArtifactBytes });
    validateRemoteContentLength(body.length, config.maxArtifactBytes);
    if (body.length !== expectedSize) {
      throw new OffsiteBackupError('Downloaded backup size did not match HEAD metadata.', 'REMOTE_OBJECT_SIZE_MISMATCH');
    }
    fsApi.writeFileSync(encryptedPath, body, { mode: 0o600, flag: 'wx' });
    fsApi.chmodSync(encryptedPath, 0o600);
    const parsed = parseArtifact(body, { maxArtifactBytes: config.maxArtifactBytes });
    if (head.sizeBytes !== body.length || head.metadata.ciphertextsha256 !== parsed.header.ciphertextSha256 ||
        head.metadata.keyid !== parsed.header.keyId || head.metadata.formatversion !== String(parsed.header.version)) {
      throw new OffsiteBackupError('Downloaded backup verification failed.', 'REMOTE_DOWNLOAD_VERIFICATION_FAILED');
    }
    const suppliedKeyId = configured(decryptionKeyId) || config.keyId;
    if (suppliedKeyId !== parsed.header.keyId) {
      throw new OffsiteBackupError('The encryption key required by this backup is not configured.', 'BACKUP_KEY_ID_UNAVAILABLE');
    }
    const key = decryptionKey ? decodeEncryptionKey(decryptionKey) : config.encryptionKey;
    const baseName = path.basename(objectKey, '.cqbackup');
    const finalPath = path.join(config.recoveryDirectory, `${baseName}.db`);
    if (fsApi.existsSync(finalPath)) throw new OffsiteBackupError('Restore candidate already exists.', 'RESTORE_CANDIDATE_EXISTS');
    plaintextTemporaryPath = path.join(config.recoveryDirectory, `.restore-candidate-${crypto.randomUUID()}.tmp`);
    decryptArtifactFile({
      artifactPath: encryptedPath,
      destinationPath: plaintextTemporaryPath,
      encryptionKey: key,
      fsApi,
      maxArtifactBytes: config.maxArtifactBytes
    });
    verifySqliteBackup(plaintextTemporaryPath, { fsApi });
    cleanupRestoreSidecars(plaintextTemporaryPath, 'partial_plaintext_sidecar', config, fsApi, logger);
    fsApi.renameSync(plaintextTemporaryPath, finalPath);
    plaintextTemporaryPath = null;
    safeLog(logger, 'offsite_restore_candidate_prepared', { keyId: parsed.header.keyId });
    return { success: true, restoreCandidatePath: finalPath, keyId: parsed.header.keyId };
  } catch (error) {
    safeLog(logger, 'offsite_restore_preparation_failed', { code: error.code || 'OFFSITE_RESTORE_PREPARATION_FAILED' });
    throw error;
  } finally {
    for (const [candidate, artifactClass] of [[encryptedPath, 'encrypted_staging'], [plaintextTemporaryPath, 'partial_plaintext']]) {
      if (candidate && fsApi.existsSync(candidate)) {
        try { fsApi.unlinkSync(candidate); }
        catch (error) {
          safeLog(logger, 'offsite_restore_cleanup_failed', {
            artifactClass,
            code: normalizeOperationalCode(error.code, 'RESTORE_CLEANUP_FAILED')
          });
        }
      }
      if (candidate) cleanupRestoreSidecars(candidate, `${artifactClass}_sidecar`, config, fsApi, logger);
    }
  }
}

module.exports = {
  DEFAULT_FAILURE_RETRY_MS,
  DEFAULT_MAX_AGE_HOURS,
  DEFAULT_PREFIX,
  DEFAULT_REMOTE_RETENTION,
  OffsiteBackupError,
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
  validateLocalSource,
  writeOffsiteState
};
