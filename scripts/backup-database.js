#!/usr/bin/env node
require('dotenv').config();
const { createDatabaseBackup } = require('../lib/databaseBackup');

createDatabaseBackup({
  logger: entry => console.log(`[database-backup] ${entry.event}${entry.filename ? ` ${entry.filename}` : ''}`)
}).then(result => {
  console.log(`Verified database backup created: ${result.filename}`);
  process.exitCode = 0;
}).catch(error => {
  console.error(`Database backup failed: ${error.code || 'BACKUP_FAILED'}`);
  process.exitCode = 1;
});
