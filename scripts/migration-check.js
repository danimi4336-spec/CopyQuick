#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const Database = require('better-sqlite3');
const { prepareDatabaseStorage } = require('../lib/databasePath');
const { requireCompatibleMigrationState } = require('../lib/migrationStartupGate');

let db;
try {
  const storage = prepareDatabaseStorage(process.env, fs);
  if (fs.existsSync(storage.databasePath)) {
    db = new Database(storage.databasePath, { readonly: true, fileMustExist: true });
  }
  const status = requireCompatibleMigrationState({
    db,
    databaseExists: fs.existsSync(storage.databasePath),
    logger: () => {}
  });
  console.log(JSON.stringify({
    event: 'migration_compatibility_ok',
    safe: true,
    currentVersion: status.currentVersion,
    minSupportedVersion: status.minSupportedVersion,
    maxSupportedVersion: status.maxSupportedVersion,
    baselineStatus: status.baselineStatus,
    pendingCount: status.pendingCount
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    event: 'startup_blocked_migration_state',
    safe: false,
    condition: error.code || 'MIGRATION_HISTORY_INVALID'
  }));
  process.exitCode = 2;
} finally {
  if (db) db.close();
}
