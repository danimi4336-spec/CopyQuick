const SAFE_CONDITION = 'MIGRATION_COMPATIBLE';

function evaluateMigrationCompatibility(status) {
  if (!status || status.compatible !== true ||
      !Number.isInteger(status.currentVersion) ||
      !Number.isInteger(status.minSupportedVersion) ||
      !Number.isInteger(status.maxSupportedVersion)) {
    return {
      safe: false,
      condition: 'MIGRATION_HISTORY_INVALID',
      event: 'migration_history_invalid'
    };
  }

  if (status.currentVersion > status.maxSupportedVersion ||
      status.currentVersion < status.minSupportedVersion) {
    return {
      safe: false,
      condition: 'MIGRATION_INCOMPATIBLE',
      event: 'migration_incompatible'
    };
  }

  if (status.fresh || status.adoptable || status.baselineStatus !== 'recorded' || status.pendingCount > 0) {
    return {
      safe: false,
      condition: 'MIGRATION_REQUIRED',
      event: 'migration_required'
    };
  }

  return { safe: true, condition: SAFE_CONDITION, event: 'migration_compatibility_ok' };
}

function classifyMigrationInspectionError(error) {
  if (['SCHEMA_VERSION_TOO_NEW', 'SCHEMA_VERSION_TOO_OLD'].includes(error?.code)) {
    return { safe: false, condition: 'MIGRATION_INCOMPATIBLE', event: 'migration_incompatible' };
  }
  if (error?.code === 'PREMIGRATION_BACKUP_REQUIRED') {
    return { safe: false, condition: 'MIGRATION_REQUIRED', event: 'migration_required' };
  }
  return { safe: false, condition: 'MIGRATION_HISTORY_INVALID', event: 'migration_history_invalid' };
}

module.exports = {
  SAFE_CONDITION,
  classifyMigrationInspectionError,
  evaluateMigrationCompatibility
};
