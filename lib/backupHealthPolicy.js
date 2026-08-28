const SEVERITY_RANK = { warning: 1, critical: 2 };

const CONDITION_DETAILS = {
  OFFSITE_NEVER_SUCCEEDED: {
    severity: 'critical',
    description: 'Scheduled encrypted off-site backups have never completed successfully.',
    action: 'Check the off-site backup configuration and run the manual off-site backup command.'
  },
  OFFSITE_BACKUP_STALE: {
    severity: 'warning',
    description: 'The most recent verified encrypted off-site backup is older than the freshness target.',
    action: 'Review scheduler and R2 status, then run a manual off-site backup if needed.'
  },
  OFFSITE_BACKUP_CRITICAL: {
    severity: 'critical',
    description: 'The most recent verified encrypted off-site backup is critically stale.',
    action: 'Investigate immediately and create a verified off-site backup.'
  },
  OFFSITE_BACKUP_ATTEMPT_FAILED: {
    severity: 'warning',
    description: 'The latest encrypted off-site backup attempt failed.',
    action: 'Inspect sanitized scheduler logs and verify R2 connectivity and configuration.'
  },
  OFFSITE_BACKUP_REPEATED_FAILURE: {
    severity: 'critical',
    description: 'Multiple consecutive encrypted off-site backup attempts have failed.',
    action: 'Escalate the backup incident and restore successful off-site backup delivery.'
  },
  OFFSITE_STATE_INVALID: {
    severity: 'critical',
    description: 'The durable off-site backup state is invalid or inconsistent.',
    action: 'Inspect the private backup state and verify the most recent R2 object independently.'
  },
  OFFSITE_SCHEDULER_DISABLED: {
    severity: 'critical',
    description: 'Scheduled off-site backups are expected in production but the scheduler is disabled.',
    action: 'Restore the approved scheduler configuration and verify scheduler startup.'
  },
  SQLITE_INTEGRITY_FAILED: {
    severity: 'critical',
    description: 'SQLite integrity verification did not complete successfully.',
    action: 'Stop unsafe writes, preserve the database, and follow the database recovery runbook.'
  },
  DATABASE_STORAGE_CRITICAL: {
    severity: 'critical',
    description: 'Persistent database storage has reached a critical capacity threshold.',
    action: 'Review disk usage immediately. Do not delete live SQLite files or application data.'
  },
  LOCAL_BACKUP_DIRECTORY_UNWRITABLE: {
    severity: 'critical',
    description: 'The local backup directory is unavailable or not writable.',
    action: 'Verify the persistent disk mount, directory permissions, and available capacity.'
  },
  LOCAL_BACKUP_MISSING_OR_INVALID: {
    severity: 'warning',
    description: 'No independently verified local SQLite backup is currently available.',
    action: 'Create a verified local backup and inspect any unverified backup artifacts.'
  }
};

function condition(id, evidenceFingerprint, overrides = {}) {
  const detail = CONDITION_DETAILS[id];
  return {
    id,
    severity: overrides.severity || detail.severity,
    description: detail.description,
    suggestedAction: detail.action,
    evidenceFingerprint: String(evidenceFingerprint || id).slice(0, 256)
  };
}

function evaluateBackupHealth(health, {
  env = process.env,
  repeatedFailureThreshold = 3
} = {}) {
  const conditions = [];
  const offsite = health?.offsiteBackup || {};
  const productionAlertsExpected = env.NODE_ENV === 'production' &&
    String(env.OFFSITE_BACKUP_ENABLED || '').toLowerCase() === 'true' &&
    String(env.BACKUP_HEALTH_ALERTS_ENABLED || '').toLowerCase() === 'true';

  if (productionAlertsExpected && !offsite.scheduleEnabled) {
    conditions.push(condition('OFFSITE_SCHEDULER_DISABLED', 'production-schedule-disabled'));
  }

  if (offsite.status === 'never_succeeded') {
    conditions.push(condition('OFFSITE_NEVER_SUCCEEDED', offsite.lastAttemptAt || 'never-succeeded'));
  } else if (offsite.lastFailureCode === 'INVALID_OFFSITE_STATE') {
    conditions.push(condition('OFFSITE_STATE_INVALID', 'invalid-offsite-state'));
  } else if (offsite.status === 'critical') {
    conditions.push(condition('OFFSITE_BACKUP_CRITICAL', offsite.lastSuccessAt || 'critical'));
  } else if (offsite.status === 'warning') {
    conditions.push(condition('OFFSITE_BACKUP_STALE', offsite.lastSuccessAt || 'stale'));
  }

  if (offsite.lastFailureCode && offsite.lastFailureCode !== 'INVALID_OFFSITE_STATE') {
    conditions.push(condition('OFFSITE_BACKUP_ATTEMPT_FAILED', `${offsite.lastFailureAt || offsite.lastAttemptAt || 'failed'}:${offsite.lastFailureCode}`));
  }
  if (Number(offsite.consecutiveFailureCount) >= repeatedFailureThreshold) {
    conditions.push(condition('OFFSITE_BACKUP_REPEATED_FAILURE', `${offsite.lastFailureAt || 'failed'}:${offsite.consecutiveFailureCount}`));
  }

  if (health?.database?.quickCheck !== 'ok') {
    conditions.push(condition('SQLITE_INTEGRITY_FAILED', 'sqlite-quick-check-failed'));
  }
  if (health?.capacity?.status === 'critical') {
    conditions.push(condition('DATABASE_STORAGE_CRITICAL', 'storage-capacity-critical'));
  }
  if (health?.backups?.directoryStatus !== 'writable') {
    conditions.push(condition('LOCAL_BACKUP_DIRECTORY_UNWRITABLE', health?.backups?.directoryStatus || 'unavailable'));
  }
  if (health?.backups?.status === 'missing' || health?.backups?.status === 'invalid') {
    conditions.push(condition('LOCAL_BACKUP_MISSING_OR_INVALID', health.backups.status));
  }

  return conditions;
}

module.exports = { CONDITION_DETAILS, SEVERITY_RANK, evaluateBackupHealth };
