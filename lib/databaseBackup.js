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

const DEFAULT_BACKUP_RETENTION = 7;
const MAX_BACKUP_RETENTION = 100;
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
    retention: parseRetention(env.DATABASE_BACKUP_RETENTION)
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
  while (true) {
    const filename = `${stem}${suffix ? `-${suffix}` : ''}.db`;
    const candidate = path.join(directory, filename);
    if (!fsApi.existsSync(candidate)) return { filename, path: candidate };
    suffix += 1;
  }
}

function listRecognizedBackups(directory, fsApi = fs) {
  if (!fsApi.existsSync(directory)) return [];
  return fsApi.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && BACKUP_PATTERN.test(entry.name))
    .map(entry => {
      const match = entry.name.match(BACKUP_PATTERN);
      return {
        name: entry.name,
        path: path.join(directory, entry.name),
        timestamp: match[1],
        collision: Number(match[2] || 0)
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.collision - a.collision);
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

function applyRetention(config, fsApi = fs) {
  const backups = listRecognizedBackups(config.backupDirectory, fsApi);
  const expired = backups.slice(config.retention);
  const deleted = [];
  const failures = [];
  for (const backup of expired) {
    try {
      fsApi.unlinkSync(backup.path);
      deleted.push(backup.name);
    } catch (error) {
      failures.push({ filename: backup.name, code: error.code || 'DELETE_FAILED' });
    }
  }
  return { kept: backups.length - deleted.length, deleted, failures };
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
  applyRetentionPolicy = true
} = {}) {
  if (backupInProgress) throw new DatabaseBackupError('A database backup is already in progress.', 'BACKUP_ALREADY_RUNNING');
  backupInProgress = true;
  let temporaryPath;
  try {
    const config = resolveBackupConfig(env, { createDirectory: true, fsApi });
    if (!db && !fsApi.existsSync(config.databasePath)) {
      throw new DatabaseBackupError('The live database does not exist; no backup was created.', 'BACKUP_SOURCE_MISSING');
    }
    const sourceDb = db || require('../db/database').getDb();
    const target = reserveBackupName(config.backupDirectory, now(), fsApi);
    temporaryPath = path.join(config.backupDirectory, `.copyquick-backup-${crypto.randomUUID()}.tmp`);
    logEvent(logger, 'backup_started', { filename: target.filename });
    if (backupOperation) await backupOperation(sourceDb, temporaryPath);
    else await sourceDb.backup(temporaryPath);
    fsApi.chmodSync(temporaryPath, 0o600);
    const verification = verifySqliteBackup(temporaryPath, { fsApi });
    fsApi.renameSync(temporaryPath, target.path);
    temporaryPath = null;
    let retentionResult;
    try {
      retentionResult = applyRetentionPolicy
        ? applyRetention(config, fsApi)
        : { kept: listRecognizedBackups(config.backupDirectory, fsApi).length, deleted: [], failures: [], deferred: true };
      logEvent(logger, retentionResult.deferred
        ? 'backup_retention_deferred'
        : retentionResult.failures.length ? 'backup_retention_failed' : 'backup_retention_completed', {
        deletedCount: retentionResult.deleted.length,
        failureCount: retentionResult.failures.length
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
    logEvent(logger, error.code === 'BACKUP_VERIFICATION_FAILED' ? 'backup_verification_failed' : 'backup_failed', {
      code: error.code || 'BACKUP_FAILED'
    });
    throw error;
  } finally {
    backupInProgress = false;
  }
}

module.exports = {
  BACKUP_PATTERN,
  DEFAULT_BACKUP_RETENTION,
  DatabaseBackupError,
  EXPECTED_TABLES,
  applyRetention,
  createDatabaseBackup,
  formatBackupTimestamp,
  listRecognizedBackups,
  parseRetention,
  resolveBackupConfig,
  verifySqliteBackup
};
