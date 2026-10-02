const fs = require('fs');
const Database = require('better-sqlite3');
const { prepareDatabaseStorage } = require('./databasePath');
const { inspectMigrationStatus } = require('../db/migrations');
const { evaluateMigrationCompatibility, classifyMigrationInspectionError } = require('./migrationCompatibility');

function inspectReleaseMigrationReadiness(env = process.env, options = {}) {
  const fsApi = options.fsApi || fs;
  const DatabaseClass = options.DatabaseClass || Database;
  let db;
  try {
    const storage = (options.prepareDatabaseStorage || prepareDatabaseStorage)(env, fsApi);
    if (!fsApi.existsSync(storage.databasePath)) {
      return { safe: false, code: 'MIGRATION_REQUIRED', currentVersion: 0, pendingCount: null };
    }
    db = new DatabaseClass(storage.databasePath, { readonly: true, fileMustExist: true });
    const status = (options.inspectMigrationStatus || inspectMigrationStatus)(db);
    const policy = evaluateMigrationCompatibility(status);
    return {
      safe: policy.safe,
      code: policy.condition,
      currentVersion: status.currentVersion,
      minSupportedVersion: status.minSupportedVersion,
      maxSupportedVersion: status.maxSupportedVersion,
      pendingCount: status.pendingCount
    };
  } catch (error) {
    const policy = classifyMigrationInspectionError(error);
    return { safe: false, code: policy.condition, currentVersion: null, pendingCount: null };
  } finally {
    if (db) db.close();
  }
}

module.exports = { inspectReleaseMigrationReadiness };
