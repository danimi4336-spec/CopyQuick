const SEVERITY_RANK = { healthy: 0, warning: 1, critical: 2 };

function safeStatus(value, allowed, fallback = 'unknown') {
  return allowed.includes(value) ? value : fallback;
}

function safeCode(value, fallback = null) {
  const normalized = typeof value === 'string' ? value : '';
  return /^[A-Z0-9_:-]{1,160}$/.test(normalized) ? normalized : fallback;
}

function safeTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function buildOperationalStatus({
  production = false,
  migration = {},
  storage = {},
  billing = {},
  generation = {},
  productionRecovery = {}
} = {}) {
  const conditions = [];
  function condition(code, severity) {
    if (!conditions.some(item => item.code === code)) conditions.push({ code, severity });
  }

  if (!migration.safe) condition(safeCode(migration.code, 'MIGRATION_STATE_UNAVAILABLE'), 'critical');
  if (storage.status === 'critical') condition('STORAGE_HEALTH_CRITICAL', 'critical');
  else if (storage.status === 'warning') condition('STORAGE_HEALTH_WARNING', 'warning');
  if (storage.offsiteStatus === 'critical' || storage.offsiteStatus === 'never_succeeded') {
    condition('OFFSITE_BACKUP_CRITICAL', 'critical');
  } else if (storage.offsiteStatus === 'warning') condition('OFFSITE_BACKUP_WARNING', 'warning');
  if (production && storage.offsiteEnabled === false) condition('OFFSITE_BACKUP_DISABLED', 'critical');
  if (production && storage.offsiteEnabled && !storage.offsiteScheduleEnabled) condition('OFFSITE_SCHEDULER_DISABLED', 'critical');

  if (billing.enabled) {
    if (billing.lastFailureCode) condition('BILLING_RECONCILIATION_FAILED', 'critical');
    if (Number(billing.unresolvedCount) > 0) condition('BILLING_RECONCILIATION_UNRESOLVED', 'critical');
    if (!billing.lastSuccessAt) condition('BILLING_RECONCILIATION_NEVER_SUCCEEDED', 'warning');
    if (billing.lastMode === 'dry_run' && Number(billing.driftCount) > 0 && Number(billing.unresolvedCount) === 0) {
      condition('BILLING_DRIFT_DETECTED', 'warning');
    }
  } else if (production) condition('BILLING_RECONCILIATION_DISABLED', 'warning');

  if (generation.mode === 'paused') {
    condition(generation.code === 'GENERATION_PAUSED' ? 'GENERATION_OPERATOR_PAUSED' : 'GENERATION_CONTROL_UNAVAILABLE',
      generation.code === 'GENERATION_PAUSED' ? 'warning' : 'critical');
  }
  if (Number(productionRecovery.recoveryRequiredCount) > 0) {
    condition('PRODUCTION_RECOVERY_REQUIRED', 'critical');
  }

  const severity = conditions.reduce(function(current, item) {
    return SEVERITY_RANK[item.severity] > SEVERITY_RANK[current] ? item.severity : current;
  }, 'healthy');
  return {
    status: severity,
    conditions,
    migration: {
      safe: Boolean(migration.safe),
      code: safeCode(migration.code, null),
      currentVersion: Number.isInteger(migration.currentVersion) ? migration.currentVersion : null,
      pendingCount: Number.isInteger(migration.pendingCount) ? migration.pendingCount : null
    },
    storage: {
      status: safeStatus(storage.status, ['healthy', 'warning', 'critical']),
      quickCheck: storage.quickCheck === 'ok' ? 'ok' : 'failed',
      capacityStatus: safeStatus(storage.capacityStatus, ['healthy', 'warning', 'critical', 'unknown']),
      freePercent: Number.isFinite(storage.freePercent) ? storage.freePercent : null,
      localBackupStatus: safeStatus(storage.localBackupStatus, ['healthy', 'warning', 'critical', 'missing', 'invalid', 'unavailable']),
      latestVerifiedBackupAt: safeTimestamp(storage.latestVerifiedBackupAt),
      offsiteEnabled: Boolean(storage.offsiteEnabled),
      offsiteStatus: safeStatus(storage.offsiteStatus, ['healthy', 'warning', 'critical', 'never_succeeded', 'disabled', 'unavailable']),
      offsiteScheduleEnabled: Boolean(storage.offsiteScheduleEnabled),
      offsiteLastSuccessAt: safeTimestamp(storage.offsiteLastSuccessAt)
    },
    billing: {
      enabled: Boolean(billing.enabled),
      lastRunAt: safeTimestamp(billing.lastRunAt),
      lastSuccessAt: safeTimestamp(billing.lastSuccessAt),
      lastFailureCode: safeCode(billing.lastFailureCode, billing.lastFailureCode ? 'RECONCILIATION_FAILED' : null),
      driftCount: Number(billing.driftCount || 0),
      unresolvedCount: Number(billing.unresolvedCount || 0),
      lastMode: ['dry_run', 'apply'].includes(billing.lastMode) ? billing.lastMode : null
    },
    generation: {
      mode: generation.mode === 'running' ? 'running' : 'paused',
      code: safeCode(generation.code, 'GENERATION_CONTROL_UNAVAILABLE'),
      updatedAt: safeTimestamp(generation.updatedAt)
    },
    production: {
      recoveryRequiredCount: Number(productionRecovery.recoveryRequiredCount || 0),
      failedCount: Number(productionRecovery.failedCount || 0),
      skippedCount: Number(productionRecovery.skippedCount || 0)
    }
  };
}

function exitCodeForOperationalStatus(status) {
  return status?.status === 'healthy' ? 0 : status?.status === 'warning' ? 1 : 2;
}

module.exports = { SEVERITY_RANK, buildOperationalStatus, exitCodeForOperationalStatus, safeCode, safeStatus, safeTimestamp };
