const fs = require('fs');
const { getDatabaseStorage, getDb } = require('../db/database');
const {
  cleanupSnapshotSidecars,
  listRecognizedBackups,
  parseRetention,
  resolveBackupConfig,
  verifySqliteBackup
} = require('./databaseBackup');
const { inspectOffsiteFreshness } = require('./offsiteBackup');
const { inspectScheduleState, resolveScheduleConfig } = require('./offsiteBackupScheduler');
const { inspectRestoreDrillState } = require('./offsiteRestoreDrill');

const GIB = 1024 * 1024 * 1024;
const DEFAULT_LOCAL_BACKUP_MAX_AGE_HOURS = 36;
const MAX_LOCAL_BACKUP_MAX_AGE_HOURS = 24 * 30;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const DEFAULT_THRESHOLDS = {
  warningFreeBytes: GIB,
  criticalFreeBytes: 512 * 1024 * 1024,
  warningFreePercent: 20,
  criticalFreePercent: 10
};

function numericSetting(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number.`);
  return parsed;
}

function localBackupMaxAgeHours(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_LOCAL_BACKUP_MAX_AGE_HOURS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LOCAL_BACKUP_MAX_AGE_HOURS) {
    throw new Error(`DATABASE_BACKUP_MAX_AGE_HOURS must be between 1 and ${MAX_LOCAL_BACKUP_MAX_AGE_HOURS}.`);
  }
  return parsed;
}

function canonicalBackupTime(timestamp) {
  if (typeof timestamp !== 'string') return null;
  const expanded = timestamp.replace(/T(\d{2})(\d{2})(\d{2})Z$/, 'T$1:$2:$3Z');
  const parsed = new Date(expanded);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function resolveStorageThresholds(env = process.env) {
  const thresholds = {
    warningFreeBytes: numericSetting(env.DATABASE_STORAGE_WARNING_FREE_BYTES, DEFAULT_THRESHOLDS.warningFreeBytes, 'DATABASE_STORAGE_WARNING_FREE_BYTES'),
    criticalFreeBytes: numericSetting(env.DATABASE_STORAGE_CRITICAL_FREE_BYTES, DEFAULT_THRESHOLDS.criticalFreeBytes, 'DATABASE_STORAGE_CRITICAL_FREE_BYTES'),
    warningFreePercent: numericSetting(env.DATABASE_STORAGE_WARNING_FREE_PERCENT, DEFAULT_THRESHOLDS.warningFreePercent, 'DATABASE_STORAGE_WARNING_FREE_PERCENT'),
    criticalFreePercent: numericSetting(env.DATABASE_STORAGE_CRITICAL_FREE_PERCENT, DEFAULT_THRESHOLDS.criticalFreePercent, 'DATABASE_STORAGE_CRITICAL_FREE_PERCENT')
  };
  if (thresholds.criticalFreeBytes > thresholds.warningFreeBytes || thresholds.criticalFreePercent > thresholds.warningFreePercent) {
    throw new Error('Critical storage thresholds must not exceed warning thresholds.');
  }
  return thresholds;
}

function classifyStorageCapacity({ freeBytes, freePercent }, thresholds = DEFAULT_THRESHOLDS) {
  if (freeBytes == null && freePercent == null) return 'unknown';
  if ((freeBytes != null && freeBytes <= thresholds.criticalFreeBytes) ||
      (freePercent != null && freePercent <= thresholds.criticalFreePercent)) return 'critical';
  if ((freeBytes != null && freeBytes <= thresholds.warningFreeBytes) ||
      (freePercent != null && freePercent <= thresholds.warningFreePercent)) return 'warning';
  return 'healthy';
}

function safeFileSize(filename, fsApi = fs) {
  try {
    const stat = fsApi.statSync(filename);
    return stat.isFile() ? stat.size : null;
  } catch (_) {
    return null;
  }
}

function filesystemCapacity(directory, fsApi = fs) {
  if (typeof fsApi.statfsSync !== 'function') return { freeBytes: null, totalBytes: null, freePercent: null };
  try {
    const stats = fsApi.statfsSync(directory);
    const blockSize = Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * blockSize;
    const totalBytes = Number(stats.blocks) * blockSize;
    return { freeBytes, totalBytes, freePercent: totalBytes > 0 ? (freeBytes / totalBytes) * 100 : null };
  } catch (_) {
    return { freeBytes: null, totalBytes: null, freePercent: null };
  }
}

function inspectStorageHealth({ env = process.env, db, fsApi = fs, logger, now = () => new Date() } = {}) {
  const storage = db ? require('./databasePath').prepareDatabaseStorage(env, fsApi) : getDatabaseStorage();
  const databaseExists = fsApi.existsSync(storage.databasePath);
  const database = db || (databaseExists ? getDb() : null);
  let quickCheck = 'failed';
  try {
    if (!database) throw new Error('Database is missing.');
    const rows = database.pragma('quick_check');
    if (rows.length === 1 && rows[0].quick_check === 'ok') quickCheck = 'ok';
  } catch (_) { /* sanitized status below */ }

  let backupConfig;
  let backupDirectoryStatus = 'unavailable';
  let backups = [];
  try {
    backupConfig = resolveBackupConfig(env, { createDirectory: false, fsApi });
    if (fsApi.existsSync(backupConfig.backupDirectory)) {
      fsApi.accessSync(backupConfig.backupDirectory, fs.constants.R_OK | fs.constants.W_OK);
      backupDirectoryStatus = 'writable';
      backups = listRecognizedBackups(backupConfig.backupDirectory, fsApi, {
        maxEntries: backupConfig.maxDirectoryEntries
      });
    } else {
      backupDirectoryStatus = 'not_initialized';
    }
  } catch (_) { /* safe unavailable status */ }

  let latestVerifiedBackupAt = null;
  for (const backup of backups) {
    try {
      try {
        verifySqliteBackup(backup.path, { fsApi });
      } finally {
        cleanupSnapshotSidecars(backup.path, {
          liveDatabasePath: storage.databasePath,
          fsApi,
          logger
        });
      }
      latestVerifiedBackupAt = canonicalBackupTime(backup.timestamp)?.toISOString() || null;
      break;
    } catch (_) { /* inspect next recognized backup */ }
  }

  let readable = false;
  let writable = false;
  try { fsApi.accessSync(storage.databasePath, fs.constants.R_OK); readable = true; } catch (_) {}
  try { fsApi.accessSync(storage.databasePath, fs.constants.W_OK); writable = true; } catch (_) {}
  const capacity = filesystemCapacity(storage.parentDirectory, fsApi);
  const thresholds = resolveStorageThresholds(env);
  const capacityStatus = classifyStorageCapacity(capacity, thresholds);
  const currentTime = now();
  const latestBackupTime = latestVerifiedBackupAt ? new Date(latestVerifiedBackupAt) : null;
  const maximumBackupAgeHours = localBackupMaxAgeHours(env.DATABASE_BACKUP_MAX_AGE_HOURS);
  const latestVerifiedBackupAgeHours = latestBackupTime
    ? Math.max(0, (currentTime.getTime() - latestBackupTime.getTime()) / 3600000)
    : null;
  const latestBackupInFuture = latestBackupTime && latestBackupTime.getTime() > currentTime.getTime() + CLOCK_SKEW_TOLERANCE_MS;
  const localBackupStatus = backupDirectoryStatus !== 'writable'
    ? 'unavailable'
    : backups.length === 0 ? 'missing'
      : !latestVerifiedBackupAt || latestBackupInFuture ? 'invalid'
        : latestVerifiedBackupAgeHours > maximumBackupAgeHours ? 'stale' : 'healthy';
  const localRetentionBacklog = backupConfig
    ? Math.max(0, backups.length - backupConfig.retention)
    : 0;
  const status = quickCheck !== 'ok' || !readable || !writable ||
      backupDirectoryStatus !== 'writable' || capacityStatus === 'critical'
    ? 'critical'
    : capacityStatus === 'warning' || localRetentionBacklog > 0 || ['missing', 'invalid', 'stale'].includes(localBackupStatus)
      ? 'warning'
      : 'healthy';

  const offsiteBackup = inspectOffsiteFreshness({ env, fsApi });
  const restoreDrill = inspectRestoreDrillState({ env, fsApi });
  const scheduleConfig = resolveScheduleConfig(env);
  let scheduleState = { nextEligibleAttemptAt: null, retryEligibleAt: null };
  if (offsiteBackup.enabled) {
    try {
      const config = require('./offsiteBackup').resolveOffsiteConfig(env, { requireSecrets: false, createDirectories: false, fsApi });
      const state = require('./offsiteBackup').readOffsiteState(config, fsApi);
      scheduleState = inspectScheduleState({ state, intervalMs: scheduleConfig.intervalMs, retryDelayMs: scheduleConfig.retryDelayMs });
    } catch (_) { /* freshness status already reports invalid/unavailable state safely */ }
  }

  return {
    status,
    storageMode: storage.mode,
    database: {
      exists: databaseExists,
      readable,
      writable,
      sizeBytes: safeFileSize(storage.databasePath, fsApi),
      walSizeBytes: safeFileSize(`${storage.databasePath}-wal`, fsApi),
      shmPresent: safeFileSize(`${storage.databasePath}-shm`, fsApi) !== null,
      quickCheck
    },
    backups: {
      status: localBackupStatus,
      directoryStatus: backupDirectoryStatus,
      recognizedCount: backups.length,
      latestVerifiedBackupAt,
      latestVerifiedBackupAgeHours: latestVerifiedBackupAgeHours == null
        ? null : Number(latestVerifiedBackupAgeHours.toFixed(1)),
      maxAgeHours: maximumBackupAgeHours,
      retention: backupConfig ? backupConfig.retention : parseRetention(env.DATABASE_BACKUP_RETENTION),
      retentionRemainingCount: localRetentionBacklog
    },
    capacity: {
      status: capacityStatus,
      freeBytes: capacity.freeBytes,
      totalBytes: capacity.totalBytes,
      freePercent: capacity.freePercent == null ? null : Number(capacity.freePercent.toFixed(1))
    },
    offsiteBackup: {
      ...offsiteBackup,
      scheduleEnabled: scheduleConfig.enabled,
      nextEligibleAttemptAt: scheduleState.nextEligibleAttemptAt,
      retryEligibleAt: scheduleState.retryEligibleAt
    },
    restoreDrill
  };
}

module.exports = {
  DEFAULT_LOCAL_BACKUP_MAX_AGE_HOURS,
  DEFAULT_THRESHOLDS,
  classifyStorageCapacity,
  filesystemCapacity,
  inspectStorageHealth,
  localBackupMaxAgeHours,
  resolveStorageThresholds
};
