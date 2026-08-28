#!/usr/bin/env node
require('dotenv').config();
const { normalizeOperationalCode } = require('../lib/offsiteBackup');
const { runOffsiteRestoreDrill } = require('../lib/offsiteRestoreDrill');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

runOffsiteRestoreDrill({
  objectKey: argumentValue('--object'),
  decryptionKey: process.env.OFFSITE_BACKUP_DECRYPTION_KEY || null,
  decryptionKeyId: process.env.OFFSITE_BACKUP_DECRYPTION_KEY_ID || null,
  logger: entry => console.log(`[offsite-restore-drill] ${entry.event}`)
}).then(result => {
  console.log('Verified encrypted off-site restore drill completed successfully.');
  console.log(`Duration: ${result.durationMs} ms`);
  console.log(`Key ID: ${result.keyId}`);
  console.log('The live production database was not restored or modified.');
  process.exitCode = 0;
}).catch(error => {
  console.error(`Off-site restore drill failed: ${normalizeOperationalCode(error.code, 'RESTORE_DRILL_FAILED')}`);
  process.exitCode = 1;
});
