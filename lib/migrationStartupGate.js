const { inspectMigrationStatus } = require('../db/migrations');
const {
  classifyMigrationInspectionError,
  evaluateMigrationCompatibility
} = require('./migrationCompatibility');

class MigrationStartupBlockedError extends Error {
  constructor(condition) {
    super('Application startup blocked by migration state.');
    this.name = 'MigrationStartupBlockedError';
    this.code = condition;
  }
}

function safeGateLog(logger, entry) {
  try { logger?.(entry); } catch (_) {}
}

function blockStartup(policy, logger) {
  safeGateLog(logger, { event: policy.event, condition: policy.condition });
  safeGateLog(logger, { event: 'startup_blocked_migration_state', condition: policy.condition });
  throw new MigrationStartupBlockedError(policy.condition);
}

function requireCompatibleMigrationState({
  db,
  databaseExists = true,
  inspect = inspectMigrationStatus,
  inspectOptions = {},
  logger = entry => console.log(JSON.stringify(entry))
} = {}) {
  if (!databaseExists || !db) {
    return blockStartup({
      safe: false,
      condition: 'MIGRATION_REQUIRED',
      event: 'migration_required'
    }, logger);
  }

  let status;
  try {
    status = inspect(db, inspectOptions);
  } catch (error) {
    return blockStartup(classifyMigrationInspectionError(error), logger);
  }

  const policy = evaluateMigrationCompatibility(status);
  if (!policy.safe) return blockStartup(policy, logger);

  safeGateLog(logger, {
    event: policy.event,
    currentVersion: status.currentVersion,
    minSupportedVersion: status.minSupportedVersion,
    maxSupportedVersion: status.maxSupportedVersion,
    pendingCount: status.pendingCount
  });
  return status;
}

module.exports = { MigrationStartupBlockedError, requireCompatibleMigrationState };
