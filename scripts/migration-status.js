#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const Database = require('better-sqlite3');
const { prepareDatabaseStorage } = require('../lib/databasePath');
const { inspectMigrationStatus } = require('../db/migrations');

let db;
try {
  const storage = prepareDatabaseStorage(process.env, fs);
  if (!fs.existsSync(storage.databasePath)) {
    console.log(JSON.stringify({
      currentVersion: 0,
      minSupportedVersion: 1,
      maxSupportedVersion: 1,
      baselineStatus: 'new_database',
      pendingCount: 1,
      compatible: true
    }, null, 2));
  } else {
    db = new Database(storage.databasePath, { readonly: true, fileMustExist: true });
    const status = inspectMigrationStatus(db);
    console.log(JSON.stringify({
      currentVersion: status.currentVersion,
      minSupportedVersion: status.minSupportedVersion,
      maxSupportedVersion: status.maxSupportedVersion,
      baselineStatus: status.baselineStatus,
      pendingCount: status.pendingCount,
      compatible: status.compatible
    }, null, 2));
  }
} catch (error) {
  console.error(`Migration status failed: ${error.code || 'MIGRATION_STATUS_FAILED'}`);
  process.exitCode = 1;
} finally {
  if (db) db.close();
}
