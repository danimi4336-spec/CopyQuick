const fs = require('fs');
const path = require('path');
const { prepareDatabaseStorage } = require('./databasePath');
const {
  DEFAULT_BACKUP_OPERATION_LEASE_MS,
  acquireBackupOperationLock,
  startBackupOperationHeartbeat
} = require('./backupOperationLock');

function resolveBillingLockDirectory(env = process.env, fsApi = fs) {
  const storage = prepareDatabaseStorage(env, fsApi);
  const directory = path.join(storage.parentDirectory, '.billing-reconciliation-lock');
  if (!fsApi.existsSync(directory)) fsApi.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function acquireBillingReconciliationLock({ env = process.env, fsApi = fs, leaseMs = DEFAULT_BACKUP_OPERATION_LEASE_MS, ...options } = {}) {
  try {
    return acquireBackupOperationLock(resolveBillingLockDirectory(env, fsApi), { fsApi, leaseMs, ...options });
  } catch (error) {
    if (error?.code === 'BACKUP_OPERATION_LOCKED') {
      const locked = new Error('Another billing reconciliation is already running.');
      locked.code = 'RECONCILIATION_LOCKED';
      throw locked;
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_RECONCILIATION_LOCK_LEASE_MS: DEFAULT_BACKUP_OPERATION_LEASE_MS,
  acquireBillingReconciliationLock,
  resolveBillingLockDirectory,
  startBillingReconciliationHeartbeat: startBackupOperationHeartbeat
};
