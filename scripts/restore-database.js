#!/usr/bin/env node
require('dotenv').config();
const { restoreDatabase } = require('../lib/databaseRestore');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

restoreDatabase({
  source: argumentValue('--source'),
  confirmProductionRestore: process.argv.includes('--confirm-production-restore'),
  confirmApplicationStopped: process.argv.includes('--confirm-application-stopped'),
  logger: entry => console.log(`[database-restore] ${entry.event}`)
}).then(() => {
  console.log('Database restore completed and verified.');
  process.exitCode = 0;
}).catch(error => {
  console.error(`Database restore refused or failed: ${error.code || 'RESTORE_FAILED'}`);
  process.exitCode = 1;
});
