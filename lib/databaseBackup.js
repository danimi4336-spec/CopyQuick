const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  DatabaseConfigurationError,
  isWithinDirectory,
  prepareDatabaseStorage,
  resolvePersistentDataDir
} = require('./databasePath');
const { acquireBackupOperationLock, startBackupOperationHeartbeat } = require('./backupOperationLock');

const DEFAULT_BACKUP_RETENTION = 7;
const MAX_BACKUP_RETENTION = 100;
const DEFAULT_MAX_DIRECTORY_ENTRIES = 10000;
const MAX_DIRECTORY_ENTRIES = 100000;
const DEFAULT_RETENTION_DELETE_LIMIT = 100;
const MAX_RETENTION_DELETE_LIMIT = 1000;
const MAX_BACKUP_NAME_COLLISIONS = 1000;
const BACKUP_PATTERN = /^copyquick-(\d{4}-\d{2}-\d{2}T\d{6}Z)(?:-(\d+))?\.db$/;
const EXPECTED_TABLES = [
  'users', 'sessions', 'generations', 'usage_events',
  'production_runs', 'production_jobs', 'production_job_events'
];
let backupInProgress = false;

class DatabaseBackupError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DatabaseBackupError';
    this.code = code;
  }
}

function configuredValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRetention(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_BACKUP_RETENTION;
  const retention = Number(value);
  if (!Number.isInteger(retention) || retention < 1 || retention > MAX_BACKUP_RETENTION) {
    throw new DatabaseBackupError(
      `DATABASE_BACKUP_RETENTION must be an integer between 1 and ${MAX_BACKUP_RETENTION}.`,
      'INVALID_BACKUP_RETENTION'
    );
  }
  return retention;
}

function parseBoundedInteger(value, fallback, name, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new DatabaseBackupError(`${name} must be an integer between 1 and ${maximum}.`, 'INVALID_BACKUP_CONFIGURATION');
  }
  return parsed;
}

function resolveBackupConfig(env = process.env, { createDirectory = false, fsApi = fs } = {}) {
  const storage = prepareDatabaseStorage(env, fsApi);
  const persistentRoot = resolvePersistentDataDir(env);
  const explicit = configuredValue(env.DATABASE_BACKUP_DIR);
  const backupDirectory = path.resolve(explicit || (storage.production
    ? path.join(persistentRoot, 'backups')
    : path.join(storage.parentDirectory, 'backups')));

  if (backupDirectory === path.parse(backupDirectory).root || backupDirectory === storage.databasePath) {
    throw new DatabaseConfigurationError('Database backup directory is unsafe.', 'BACKUP_DIRECTORY_UNSAFE');
  }
  if (storage.production && !isWithinDirectory(backupDirectory, persistentRoot)) {
    throw new DatabaseConfigurationError(
      'Production backup directory must remain beneath configured persistent storage.',
      'BACKUP_DIRECTORY_OUTSIDE_PERSISTENT_ROOT'
    );
  }
  if (createDirectory && !fsApi.existsSync(backupDirectory)) {
    fsApi.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  }
  if (fsApi.existsSync(backupDirectory)) {
    const stats = fsApi.statSync(backupDirectory);
    if (!stats.isDirectory()) throw new DatabaseBackupError('Backup location is not a directory.', 'BACKUP_DIRECTORY_INVALID');
    fsApi.accessSync(backupDirectory, fs.constants.R_OK | fs.constants.W_OK);
  }

  return {
    ...storage,
    backupDirectory,
    retention: parseRetention(env.DATABASE_BACKUP_RETENTION),
    maxDirectoryEntries: parseBoundedInteger(
      env.DATABASE_BACKUP_MAX_DIRECTORY_ENTRIES,
      DEFAULT_MAX_DIRECTORY_ENTRIES,
      'DATABASE_BACKUP_MAX_DIRECTORY_ENTRIES',
      MAX_DIRECTORY_ENTRIES
    ),
    retentionDeleteLimit: parseBoundedInteger(
      env.DATABASE_BACKUP_RETENTION_DELETE_LIMIT,
      DEFAULT_RETENTION_DELETE_LIMIT,
      'DATABASE_BACKUP_RETENTION_DELETE_LIMIT',
      MAX_RETENTION_DELETE_LIMIT
    )
  };
}

function formatBackupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(
    /^(\d{4})(\d{2})(\d{2})T/,
    '$1-$2-$3T'
  );
}

function reserveBackupName(directory, date, fsApi = fs) {
  const stem = `copyquick-${formatBackupTimestamp(date)}`;
  let suffix = 0;
  while (suffix <= MAX_BACKUP_NAME_COLLISIONS) {
    const filename = `${stem}${suffix ? `-${suffix}` : ''}.db`;
    const candidate = path.join(directory, filename);
    if (!fsApi.existsSync(candidate)) return { filename, path: candidate };
    suffix += 1;
  }
  throw new DatabaseBackupError('Backup filename collision bound exceeded.', 'BACKUP_NAME_COLLISION_LIMIT_EXCEEDED');
}

function listRecognizedBackups(directory, fsApi = fs, { maxEntries = DEFAULT_MAX_DIRECTORY_ENTRIES } = {}) {
  if (!fsApi.existsSync(directory)) return [];
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_DIRECTORY_ENTRIES) {
    throw new DatabaseBackupError('Backup directory inspection bound is invalid.', 'INVALID_BACKUP_CONFIGURATION');
  }
  const recognized = [];
  const handle = fsApi.opendirSync(directory);
  let entryCount = 0;
  try {
    let entry;
    while ((entry = handle.readSync()) !== null) {
      entryCount += 1;
      if (entryCount > maxEntries) {
        throw new DatabaseBackupError('Backup directory entry bound exceeded.', 'BACKUP_DIRECTORY_ENTRY_LIMIT_EXCEEDED');
      }
      if (!entry.isFile() || !BACKUP_PATTERN.test(entry.name)) continue;
      const match = entry.name.match(BACKUP_PATTERN);
      recognized.push({
        name: entry.name,
        path: path.join(directory, entry.name),
        timestamp: match[1],
        collision: Number(match[2] || 0)
      });
    }
  } finally {
    try { handle.closeSync(); } catch (_) {}
  }
  return recognized.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.collision - a.collision);
}

function verifySqliteBackup(databasePath, { expectedTables = EXPECTED_TABLES, DatabaseClass = Database, fsApi = fs } = {}) {
  let db;
  try {
    const stats = fsApi.statSync(databasePath);
    if (!stats.isFile() || stats.size === 0) throw new Error('Backup is empty or is not a regular file.');
    db = new DatabaseClass(databasePath, { readonly: true, fileMustExist: true });
    const quickCheckRows = db.pragma('quick_check');
    const quickCheck = quickCheckRows.length === 1 && quickCheckRows[0].quick_check === 'ok';
    if (!quickCheck) throw new Error('SQLite quick_check did not return ok.');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
    const missingTables = expectedTables.filter(table => !tables.has(table));
    if (missingTables.length) throw new Error(`Expected schema is incomplete (${missingTables.length} tables missing).`);
    const tableCounts = {};
    for (const table of expectedTables) {
      tableCounts[table] = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
    }
    return { valid: true, sizeBytes: stats.size, quickCheck: 'ok', tableCounts };
  } catch (error) {
    throw new DatabaseBackupError('Backup verification failed.', 'BACKUP_VERIFICATION_FAILED', error);
  } finally {
    if (db) db.close();
  }
}

function cleanupSnapshotSidecars(snapshotPath, {
  liveDatabasePath,
  fsApi = fs,
  logger
} = {}) {
  if (!snapshotPath || !liveDatabasePath) {
    try { logEvent(logger, 'snapshot_sidecar_cleanup_refused', { code: 'PATH_GUARD_REQUIRED' }); } catch (_) {}
    return { refused: true, deleted: [], failures: [] };
  }
  const resolvedSnapshotPath = path.resolve(String(snapshotPath));
  const resolvedLiveDatabasePath = path.resolve(String(liveDatabasePath));
  if (resolvedSnapshotPath === resolvedLiveDatabasePath) {
    try { logEvent(logger, 'snapshot_sidecar_cleanup_refused', { code: 'LIVE_DATABASE_PROTECTED' }); } catch (_) {}
    return { refused: true, deleted: [], failures: [] };
  }

  const deleted = [];
  const failures = [];
  for (const suffix of ['-wal', '-shm']) {
    try {
      fsApi.unlinkSync(`${resolvedSnapshotPath}${suffix}`);
      deleted.push(suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') failures.push({ suffix, code: error.code || 'SIDECAR_DELETE_FAILED' });
    }
  }
  if (failures.length) {
    try {
      logEvent(logger, 'snapshot_sidecar_cleanup_failed', {
        failureCount: failures.length,
        codes: failures.map(failure => failure.code)
      });
    } catch (_) { /* optional cleanup and logging cannot invalidate a verified snapshot */ }
  }
  return { refused: false, deleted, failures };
}

function applyRetention(config, fsApi = fs, logger) {
  const backups = listRecognizedBackups(config.backupDirectory, fsApi, {
    maxEntries: config.maxDirectoryEntries || DEFAULT_MAX_DIRECTORY_ENTRIES
  });
  const expired = backups.slice(config.retention);
  const boundedExpired = expired.slice(0, config.retentionDeleteLimit || DEFAULT_RETENTION_DELETE_LIMIT);
  const deleted = [];
  const failures = [];
  for (const backup of boundedExpired) {
    try {
      fsApi.unlinkSync(backup.path);
      deleted.push(backup.name);
      const sidecarCleanup = cleanupSnapshotSidecars(backup.path, {
        liveDatabasePath: config.databasePath,
        fsApi,
        logger
      });
      if (sidecarCleanup.failures.length) {
        failures.push({ filename: backup.name, code: 'SIDECAR_CLEANUP_FAILED' });
      }
    } catch (error) {
      failures.push({ filename: backup.name, code: error.code || 'DELETE_FAILED' });
      break;
    }
  }
  return {
    kept: backups.length - deleted.length,
    deleted,
    failures,
    remainingCount: expired.length - deleted.length
  };
}

function logEvent(logger, event, details = {}) {
  if (!logger) return;
  logger({ event, ...details });
}

async function createDatabaseBackup({
  db,
  env = process.env,
  now = () => new Date(),
  fsApi = fs,
  logger = details => console.log(JSON.stringify(details)),
  backupOperation,
  applyRetentionPolicy = true,
  operationLock = null
} = {}) {
  if (backupInProgress) throw new DatabaseBackupError('A database backup is already in progress.', 'BACKUP_ALREADY_RUNNING');
  backupInProgress = true;
  let temporaryPath;
  let liveDatabasePath;
  let ownedOperationLock = null;
  let stopOperationHeartbeat = () => {};
  try {
    const config = resolveBackupConfig(env, { createDirectory: true, fsApi });
    if (!operationLock) {
      ownedOperationLock = acquireBackupOperationLock(config.backupDirectory, { fsApi });
      stopOperationHeartbeat = startBackupOperationHeartbeat(ownedOperationLock);
    }
    if (operationLock && typeof operationLock.isOwner === 'function' && !operationLock.isOwner()) {
      throw new DatabaseBackupError('Backup operation ownership was lost.', 'BACKUP_OPERATION_OWNERSHIP_LOST');
    }
    liveDatabasePath = config.databasePath;
    if (!db && !fsApi.existsSync(config.databasePath)) {
      throw new DatabaseBackupError('The live database does not exist; no backup was created.', 'BACKUP_SOURCE_MISSING');
    }
    const sourceDb = db || require('../db/database').getDb();
    const target = reserveBackupName(config.backupDirectory, now(), fsApi);
    temporaryPath = path.join(config.backupDirectory, `.copyquick-backup-${crypto.randomUUID()}.tmp`);
    logEvent(logger, 'backup_started', { filename: target.filename });
    if (backupOperation) await backupOperation(sourceDb, temporaryPath);
    else await sourceDb.backup(temporaryPath);
    if ((operationLock || ownedOperationLock)?.isOwner && !(operationLock || ownedOperationLock).isOwner()) {
      throw new DatabaseBackupError('Backup operation ownership was lost.', 'BACKUP_OPERATION_OWNERSHIP_LOST');
    }
    fsApi.chmodSync(temporaryPath, 0o600);
    const verification = verifySqliteBackup(temporaryPath, { fsApi });
    cleanupSnapshotSidecars(temporaryPath, { liveDatabasePath, fsApi, logger });
    fsApi.renameSync(temporaryPath, target.path);
    temporaryPath = null;
    let retentionResult;
    try {
      retentionResult = applyRetentionPolicy
        ? applyRetention(config, fsApi, logger)
        : {
          kept: listRecognizedBackups(config.backupDirectory, fsApi, { maxEntries: config.maxDirectoryEntries }).length,
          deleted: [], failures: [], remainingCount: 0, deferred: true
        };
      logEvent(logger, retentionResult.deferred
        ? 'backup_retention_deferred'
        : retentionResult.failures.length ? 'backup_retention_failed' : 'backup_retention_completed', {
        deletedCount: retentionResult.deleted.length,
        failureCount: retentionResult.failures.length,
        retentionRemainingCount: Number(retentionResult.remainingCount || 0)
      });
    } catch (error) {
      retentionResult = { kept: null, deleted: [], failures: [{ code: error.code || 'RETENTION_FAILED' }] };
      logEvent(logger, 'backup_retention_failed', { failureCount: 1 });
    }
    logEvent(logger, 'backup_completed', { filename: target.filename, sizeBytes: verification.sizeBytes });
    return { success: true, filename: target.filename, verification, retention: retentionResult };
  } catch (error) {
    if (temporaryPath && fsApi.existsSync(temporaryPath)) {
      try { fsApi.unlinkSync(temporaryPath); } catch (_) { /* preserve original failure */ }
    }
    if (temporaryPath) cleanupSnapshotSidecars(temporaryPath, { liveDatabasePath, fsApi, logger });
    logEvent(logger, error.code === 'BACKUP_VERIFICATION_FAILED' ? 'backup_verification_failed' : 'backup_failed', {
      code: error.code || 'BACKUP_FAILED'
    });
    throw error;
  } finally {
    stopOperationHeartbeat();
    if (ownedOperationLock) ownedOperationLock.release();
    backupInProgress = false;
  }
}

module.exports = {
  BACKUP_PATTERN,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_MAX_DIRECTORY_ENTRIES,
  DEFAULT_RETENTION_DELETE_LIMIT,
  DatabaseBackupError,
  EXPECTED_TABLES,
  MAX_BACKUP_NAME_COLLISIONS,
  MAX_DIRECTORY_ENTRIES,
  MAX_RETENTION_DELETE_LIMIT,
  applyRetention,
  cleanupSnapshotSidecars,
  createDatabaseBackup,
  formatBackupTimestamp,
  listRecognizedBackups,
  parseRetention,
  resolveBackupConfig,
  verifySqliteBackup
};
