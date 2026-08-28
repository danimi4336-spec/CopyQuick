const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { cleanupSnapshotSidecars, EXPECTED_TABLES, verifySqliteBackup } = require('./databaseBackup');
const { prepareDatabaseStorage } = require('./databasePath');
const {
  normalizeOperationalCode,
  recognizedObjectKey,
  resolveOffsiteConfig,
  retrieveAndDecryptOffsiteBackup
} = require('./offsiteBackup');

const DRILL_STATE_VERSION = 1;
const DRILL_CRITICAL_TABLES = [...new Set([
  ...EXPECTED_TABLES,
  'usage_periods',
  'subscriptions'
])];

class OffsiteRestoreDrillError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OffsiteRestoreDrillError';
    this.code = code;
  }
}

function safeLog(logger, event, details = {}) {
  if (!logger) return;
  try { logger({ event, ...details }); } catch (_) {}
}

function emptyDrillState() {
  return {
    version: DRILL_STATE_VERSION,
    lastAttemptAt: null,
    lastSuccessAt: null,
    objectKey: null,
    keyId: null,
    artifactHash: null,
    durationMs: null,
    failureCode: null
  };
}

function resolveDrillStateConfig(env = process.env, fsApi = fs) {
  const storage = prepareDatabaseStorage(env, fsApi);
  const root = storage.production ? storage.persistentDataDir : storage.parentDirectory;
  return { storage, statePath: path.join(root, '.offsite-restore-drill-state.json') };
}

function readRestoreDrillState(config, fsApi = fs) {
  try {
    const parsed = JSON.parse(fsApi.readFileSync(config.statePath, 'utf8'));
    if (!parsed || parsed.version !== DRILL_STATE_VERSION) return { ...emptyDrillState(), stateInvalid: true };
    return {
      version: DRILL_STATE_VERSION,
      lastAttemptAt: typeof parsed.lastAttemptAt === 'string' ? parsed.lastAttemptAt.slice(0, 32) : null,
      lastSuccessAt: typeof parsed.lastSuccessAt === 'string' ? parsed.lastSuccessAt.slice(0, 32) : null,
      objectKey: typeof parsed.objectKey === 'string' ? parsed.objectKey.slice(0, 512) : null,
      keyId: typeof parsed.keyId === 'string' ? parsed.keyId.slice(0, 64) : null,
      artifactHash: typeof parsed.artifactHash === 'string' && /^[a-f0-9]{64}$/.test(parsed.artifactHash) ? parsed.artifactHash : null,
      durationMs: Number.isSafeInteger(parsed.durationMs) && parsed.durationMs >= 0 ? parsed.durationMs : null,
      failureCode: parsed.failureCode ? normalizeOperationalCode(parsed.failureCode, 'RESTORE_DRILL_FAILED') : null
    };
  } catch (error) {
    return error?.code === 'ENOENT' ? emptyDrillState() : { ...emptyDrillState(), stateInvalid: true };
  }
}

function writeRestoreDrillState(config, state, fsApi = fs) {
  const temporaryPath = `${config.statePath}.${crypto.randomUUID()}.tmp`;
  const safeState = {
    version: DRILL_STATE_VERSION,
    lastAttemptAt: state.lastAttemptAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    objectKey: state.objectKey || null,
    keyId: state.keyId || null,
    artifactHash: state.artifactHash || null,
    durationMs: Number.isSafeInteger(state.durationMs) && state.durationMs >= 0 ? state.durationMs : null,
    failureCode: state.failureCode ? normalizeOperationalCode(state.failureCode, 'RESTORE_DRILL_FAILED') : null
  };
  try {
    fsApi.writeFileSync(temporaryPath, JSON.stringify(safeState), { mode: 0o600, flag: 'wx' });
    fsApi.chmodSync(temporaryPath, 0o600);
    fsApi.renameSync(temporaryPath, config.statePath);
  } finally {
    if (fsApi.existsSync(temporaryPath)) {
      try { fsApi.unlinkSync(temporaryPath); } catch (_) {}
    }
  }
}

function sameIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino;
}

function captureLiveState(databasePath, fsApi = fs) {
  let database;
  try { database = fsApi.statSync(databasePath); } catch (error) {
    throw new OffsiteRestoreDrillError('The live database is unavailable.', 'LIVE_DATABASE_UNAVAILABLE', error);
  }
  if (!database.isFile()) throw new OffsiteRestoreDrillError('The live database is invalid.', 'LIVE_DATABASE_UNAVAILABLE');
  const auxiliary = {};
  for (const suffix of ['-wal', '-shm']) {
    try {
      const stat = fsApi.statSync(`${databasePath}${suffix}`);
      auxiliary[suffix] = {
        exists: true, dev: stat.dev, ino: stat.ino,
        sizeBytes: stat.size, mtimeMs: stat.mtimeMs
      };
    } catch (_) { auxiliary[suffix] = { exists: false }; }
  }
  return {
    database: {
      dev: database.dev, ino: database.ino,
      sizeBytes: database.size, mtimeMs: database.mtimeMs
    },
    auxiliary
  };
}

function assertLiveStatePreserved(databasePath, before, fsApi = fs) {
  const after = captureLiveState(databasePath, fsApi);
  if (!sameIdentity(before.database, after.database)) {
    throw new OffsiteRestoreDrillError('Live database identity changed during verification.', 'LIVE_DATABASE_IDENTITY_CHANGED');
  }
  // WAL/SHM can legitimately rotate while the live application is writing.
  // They are captured for audit/tests, but the drill never opens or cleans
  // them and therefore does not treat normal live sidecar churn as failure.
  return after;
}

function assertIsolatedPath(candidate, liveDatabasePath, fsApi = fs) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedLive = path.resolve(liveDatabasePath);
  if ([resolvedLive, `${resolvedLive}-wal`, `${resolvedLive}-shm`].includes(resolvedCandidate)) {
    throw new OffsiteRestoreDrillError('Restore drill path is not isolated.', 'DRILL_PATH_NOT_ISOLATED');
  }
  if (fsApi.existsSync(resolvedCandidate)) {
    let candidateReal;
    let liveReal;
    try {
      candidateReal = fsApi.realpathSync(resolvedCandidate);
      liveReal = fsApi.realpathSync(resolvedLive);
    } catch (error) {
      throw new OffsiteRestoreDrillError('Restore drill path identity cannot be verified.', 'DRILL_PATH_IDENTITY_UNAVAILABLE', error);
    }
    if (candidateReal === liveReal || sameIdentity(fsApi.statSync(candidateReal), fsApi.statSync(liveReal))) {
      throw new OffsiteRestoreDrillError('Restore drill path aliases the live database.', 'DRILL_PATH_NOT_ISOLATED');
    }
  }
  return resolvedCandidate;
}

function verifyDrillDatabase(databasePath, { fsApi = fs, DatabaseClass = Database } = {}) {
  const verification = verifySqliteBackup(databasePath, { fsApi, DatabaseClass });
  let database;
  try {
    database = new DatabaseClass(databasePath, { readonly: true, fileMustExist: true });
    for (const table of DRILL_CRITICAL_TABLES) {
      const exists = database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) throw new Error('Critical schema is incomplete.');
      const row = database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
      if (!row || !Number.isSafeInteger(row.count) || row.count < 0) throw new Error('Critical table is unreadable.');
    }
    return { ...verification, criticalTablesReadable: true };
  } catch (error) {
    if (error?.code === 'BACKUP_VERIFICATION_FAILED') throw error;
    throw new OffsiteRestoreDrillError('Isolated database invariant verification failed.', 'DRILL_INVARIANT_FAILED', error);
  } finally {
    if (database) database.close();
  }
}

function cleanupOwnedArtifacts(paths, liveDatabasePath, fsApi, logger) {
  const failures = [];
  for (const [artifactClass, candidate] of paths) {
    if (!candidate) continue;
    if (path.resolve(candidate) === path.resolve(liveDatabasePath)) {
      failures.push({ artifactClass, code: 'LIVE_DATABASE_PROTECTED' });
      continue;
    }
    try { fsApi.unlinkSync(candidate); } catch (error) {
      if (error.code !== 'ENOENT') failures.push({ artifactClass, code: normalizeOperationalCode(error.code, 'DRILL_CLEANUP_FAILED') });
    }
    const sidecars = cleanupSnapshotSidecars(candidate, { liveDatabasePath, fsApi });
    for (const failure of sidecars.failures || []) {
      failures.push({ artifactClass: `${artifactClass}_sidecar`, code: normalizeOperationalCode(failure.code, 'DRILL_CLEANUP_FAILED') });
    }
  }
  for (const failure of failures) safeLog(logger, 'offsite_restore_drill_cleanup_failed', failure);
  return failures;
}

async function runOffsiteRestoreDrill({
  objectKey,
  env = process.env,
  storage,
  decryptionKey,
  decryptionKeyId,
  fsApi = fs,
  osApi = os,
  DatabaseClass = Database,
  backupOperation,
  now = () => new Date(),
  logger = event => console.log(JSON.stringify(event))
} = {}) {
  const startedMs = now().getTime();
  const attemptAt = new Date(startedMs).toISOString();
  let stateConfig;
  let priorState = emptyDrillState();
  let drillDirectory;
  let encryptedPath;
  let sourcePath;
  let restoredPath;
  let result;
  let primaryError;
  let liveBefore;

  try {
    stateConfig = resolveDrillStateConfig(env, fsApi);
    priorState = readRestoreDrillState(stateConfig, fsApi);
    const config = resolveOffsiteConfig(env, { requireSecrets: true, createDirectories: false, fsApi });
    if (!config.enabled) throw new OffsiteRestoreDrillError('Off-site backups are disabled.', 'OFFSITE_BACKUP_DISABLED');
    if (!objectKey || !String(objectKey).trim()) throw new OffsiteRestoreDrillError('An explicit remote object key is required.', 'RESTORE_DRILL_OBJECT_REQUIRED');
    if (!recognizedObjectKey(objectKey, config.prefix)) throw new OffsiteRestoreDrillError('Remote backup object is not recognized.', 'UNRECOGNIZED_REMOTE_OBJECT');

    writeRestoreDrillState(stateConfig, { ...priorState, lastAttemptAt: attemptAt, failureCode: null }, fsApi);
    liveBefore = captureLiveState(stateConfig.storage.databasePath, fsApi);
    drillDirectory = fsApi.mkdtempSync(path.join(osApi.tmpdir(), 'copyquick-restore-drill-'));
    fsApi.chmodSync(drillDirectory, 0o700);
    encryptedPath = assertIsolatedPath(path.join(drillDirectory, 'remote.cqbackup'), stateConfig.storage.databasePath, fsApi);
    sourcePath = assertIsolatedPath(path.join(drillDirectory, 'decrypted-source.db'), stateConfig.storage.databasePath, fsApi);
    restoredPath = assertIsolatedPath(path.join(drillDirectory, 'isolated-restored.db'), stateConfig.storage.databasePath, fsApi);

    const retrieved = await retrieveAndDecryptOffsiteBackup({
      objectKey, config, storage, encryptedPath, plaintextPath: sourcePath,
      decryptionKey, decryptionKeyId, fsApi
    });
    assertIsolatedPath(sourcePath, stateConfig.storage.databasePath, fsApi);
    try { verifySqliteBackup(sourcePath, { fsApi, DatabaseClass }); }
    finally { cleanupSnapshotSidecars(sourcePath, { liveDatabasePath: stateConfig.storage.databasePath, fsApi, logger }); }

    const sourceDatabase = new DatabaseClass(sourcePath, { readonly: true, fileMustExist: true });
    try {
      if (backupOperation) await backupOperation(sourceDatabase, restoredPath);
      else await sourceDatabase.backup(restoredPath);
    } finally { sourceDatabase.close(); }
    fsApi.chmodSync(restoredPath, 0o600);
    assertIsolatedPath(restoredPath, stateConfig.storage.databasePath, fsApi);
    try { verifyDrillDatabase(restoredPath, { fsApi, DatabaseClass }); }
    finally { cleanupSnapshotSidecars(restoredPath, { liveDatabasePath: stateConfig.storage.databasePath, fsApi, logger }); }
    assertLiveStatePreserved(stateConfig.storage.databasePath, liveBefore, fsApi);
    result = {
      success: true,
      keyId: retrieved.header.keyId,
      artifactHash: retrieved.artifactHash,
      durationMs: Math.max(0, now().getTime() - startedMs)
    };
  } catch (error) {
    primaryError = error;
  }

  const cleanupFailures = cleanupOwnedArtifacts([
    ['encrypted_artifact', encryptedPath],
    ['decrypted_snapshot', sourcePath],
    ['isolated_database', restoredPath]
  ], stateConfig?.storage?.databasePath || path.resolve('__protected_live_database__'), fsApi, logger);
  if (drillDirectory) {
    try { fsApi.rmdirSync(drillDirectory); } catch (error) {
      if (error.code !== 'ENOENT') {
        const failure = { artifactClass: 'drill_directory', code: normalizeOperationalCode(error.code, 'DRILL_CLEANUP_FAILED') };
        cleanupFailures.push(failure);
        safeLog(logger, 'offsite_restore_drill_cleanup_failed', failure);
      }
    }
  }
  if (!primaryError && cleanupFailures.length) {
    primaryError = new OffsiteRestoreDrillError('Restore drill cleanup was incomplete.', 'DRILL_CLEANUP_FAILED');
  }

  const finishedAt = now().toISOString();
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - startedMs);
  if (stateConfig) {
    try {
      if (primaryError) {
        writeRestoreDrillState(stateConfig, {
          ...priorState,
          lastAttemptAt: attemptAt,
          durationMs,
          failureCode: normalizeOperationalCode(primaryError.code, 'RESTORE_DRILL_FAILED')
        }, fsApi);
      } else {
        writeRestoreDrillState(stateConfig, {
          ...priorState,
          lastAttemptAt: attemptAt,
          lastSuccessAt: finishedAt,
          objectKey,
          keyId: result.keyId,
          artifactHash: result.artifactHash,
          durationMs,
          failureCode: null
        }, fsApi);
      }
    } catch (stateError) {
      safeLog(logger, 'offsite_restore_drill_state_write_failed', {
        code: normalizeOperationalCode(stateError.code, 'DRILL_STATE_WRITE_FAILED')
      });
      if (!primaryError) primaryError = new OffsiteRestoreDrillError('Restore drill state could not be recorded.', 'DRILL_STATE_WRITE_FAILED');
    }
  }

  if (primaryError) {
    safeLog(logger, 'offsite_restore_drill_failed', { code: normalizeOperationalCode(primaryError.code, 'RESTORE_DRILL_FAILED') });
    throw primaryError;
  }
  safeLog(logger, 'offsite_restore_drill_completed', { keyId: result.keyId, durationMs });
  return { ...result, durationMs };
}

function inspectRestoreDrillState({ env = process.env, fsApi = fs, now = () => new Date() } = {}) {
  try {
    const config = resolveDrillStateConfig(env, fsApi);
    const state = readRestoreDrillState(config, fsApi);
    const successMs = state.lastSuccessAt ? new Date(state.lastSuccessAt).getTime() : NaN;
    return {
      lastSuccessAt: Number.isFinite(successMs) ? state.lastSuccessAt : null,
      ageHours: Number.isFinite(successMs) ? Number(Math.max(0, (now().getTime() - successMs) / 3600000).toFixed(1)) : null,
      lastFailureCode: state.stateInvalid ? 'RESTORE_DRILL_STATE_INVALID' : state.failureCode,
      keyId: state.keyId,
      durationMs: state.durationMs
    };
  } catch (_) {
    return { lastSuccessAt: null, ageHours: null, lastFailureCode: 'RESTORE_DRILL_STATE_UNAVAILABLE', keyId: null, durationMs: null };
  }
}

module.exports = {
  DRILL_CRITICAL_TABLES,
  DRILL_STATE_VERSION,
  OffsiteRestoreDrillError,
  assertIsolatedPath,
  assertLiveStatePreserved,
  captureLiveState,
  cleanupOwnedArtifacts,
  emptyDrillState,
  inspectRestoreDrillState,
  readRestoreDrillState,
  resolveDrillStateConfig,
  runOffsiteRestoreDrill,
  verifyDrillDatabase,
  writeRestoreDrillState
};
