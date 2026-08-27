const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { prepareDatabaseStorage } = require('./databasePath');
const { cleanupSnapshotSidecars, createDatabaseBackup, verifySqliteBackup } = require('./databaseBackup');
const { readRuntimeLock } = require('./databaseRuntimeLock');

class DatabaseRestoreError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DatabaseRestoreError';
    this.code = code;
  }
}

function validateRestoreRequest({ source, env, confirmProductionRestore, confirmApplicationStopped, fsApi = fs }) {
  if (!source || !String(source).trim()) throw new DatabaseRestoreError('An explicit backup source is required.', 'RESTORE_SOURCE_REQUIRED');
  const storage = prepareDatabaseStorage(env, fsApi);
  const sourcePath = path.resolve(String(source));
  if (sourcePath === storage.databasePath) throw new DatabaseRestoreError('Restore source must differ from the live database.', 'RESTORE_SOURCE_IS_DESTINATION');
  let stats;
  try { stats = fsApi.statSync(sourcePath); } catch (error) {
    throw new DatabaseRestoreError('Restore source does not exist.', 'RESTORE_SOURCE_MISSING', error);
  }
  if (!stats.isFile()) throw new DatabaseRestoreError('Restore source must be a regular file.', 'RESTORE_SOURCE_INVALID');
  if (!confirmApplicationStopped) {
    throw new DatabaseRestoreError('Offline restore confirmation is required.', 'RESTORE_OFFLINE_CONFIRMATION_REQUIRED');
  }
  if (storage.production && !confirmProductionRestore) {
    throw new DatabaseRestoreError('Production restore requires explicit confirmation.', 'PRODUCTION_RESTORE_CONFIRMATION_REQUIRED');
  }
  if (readRuntimeLock(storage.databasePath, fsApi).active) {
    throw new DatabaseRestoreError('Restore refused because the application database is active.', 'RESTORE_DATABASE_ACTIVE');
  }
  return { sourcePath, storage };
}

async function restoreDatabase({
  source,
  env = process.env,
  confirmProductionRestore = false,
  confirmApplicationStopped = false,
  fsApi = fs,
  logger = details => console.log(JSON.stringify(details))
} = {}) {
  const { sourcePath, storage } = validateRestoreRequest({ source, env, confirmProductionRestore, confirmApplicationStopped, fsApi });
  try {
    verifySqliteBackup(sourcePath, { fsApi });
  } finally {
    cleanupSnapshotSidecars(sourcePath, { liveDatabasePath: storage.databasePath, fsApi, logger });
  }
  logger({ event: 'restore_verification_completed', sourceFilename: path.basename(sourcePath) });

  let currentDb;
  let temporaryPath;
  const quarantined = [];
  try {
    if (fsApi.existsSync(storage.databasePath)) {
      currentDb = new Database(storage.databasePath, { readonly: true, fileMustExist: true });
      // Retention is deliberately deferred so the selected restore source can
      // never be removed during the restore operation.
      await createDatabaseBackup({ db: currentDb, env, fsApi, logger, applyRetentionPolicy: false });
      currentDb.close();
      currentDb = null;
    }

    temporaryPath = path.join(storage.parentDirectory, `.copyquick-restore-${crypto.randomUUID()}.tmp`);
    const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try { await sourceDb.backup(temporaryPath); } finally { sourceDb.close(); }
    cleanupSnapshotSidecars(sourcePath, { liveDatabasePath: storage.databasePath, fsApi, logger });
    fsApi.chmodSync(temporaryPath, 0o600);
    verifySqliteBackup(temporaryPath, { fsApi });
    cleanupSnapshotSidecars(temporaryPath, { liveDatabasePath: storage.databasePath, fsApi, logger });

    for (const suffix of ['-wal', '-shm']) {
      const auxiliary = `${storage.databasePath}${suffix}`;
      if (!fsApi.existsSync(auxiliary)) continue;
      const quarantine = `${auxiliary}.pre-restore-${crypto.randomUUID()}`;
      fsApi.renameSync(auxiliary, quarantine);
      quarantined.push({ auxiliary, quarantine });
    }

    try {
      fsApi.renameSync(temporaryPath, storage.databasePath);
      temporaryPath = null;
    } catch (error) {
      for (const item of quarantined.reverse()) {
        if (fsApi.existsSync(item.quarantine)) fsApi.renameSync(item.quarantine, item.auxiliary);
      }
      throw error;
    }
    for (const item of quarantined) {
      if (fsApi.existsSync(item.quarantine)) fsApi.unlinkSync(item.quarantine);
    }
    const verification = verifySqliteBackup(storage.databasePath, { fsApi });
    logger({ event: 'restore_completed', sizeBytes: verification.sizeBytes });
    return { success: true, verification };
  } catch (error) {
    logger({ event: 'restore_failed', code: error.code || 'RESTORE_FAILED' });
    if (error instanceof DatabaseRestoreError) throw error;
    throw new DatabaseRestoreError('Database restore failed safely.', 'RESTORE_FAILED', error);
  } finally {
    if (currentDb) currentDb.close();
    if (temporaryPath && fsApi.existsSync(temporaryPath)) {
      try { fsApi.unlinkSync(temporaryPath); } catch (_) {}
    }
    if (temporaryPath) cleanupSnapshotSidecars(temporaryPath, {
      liveDatabasePath: storage.databasePath,
      fsApi,
      logger
    });
  }
}

module.exports = { DatabaseRestoreError, restoreDatabase, validateRestoreRequest };
