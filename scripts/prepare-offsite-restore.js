#!/usr/bin/env node
require('dotenv').config();
const { normalizeOperationalCode, prepareOffsiteRestore } = require('../lib/offsiteBackup');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

prepareOffsiteRestore({
  objectKey: argumentValue('--object'),
  decryptionKey: process.env.OFFSITE_BACKUP_DECRYPTION_KEY || null,
  decryptionKeyId: process.env.OFFSITE_BACKUP_DECRYPTION_KEY_ID || null,
  logger: entry => console.log(`[offsite-restore] ${entry.event}`)
}).then(result => {
  console.log(`Verified local restore candidate prepared: ${result.restoreCandidatePath}`);
  console.log('Production was not restored. Use the Story 3.13 offline restore command after review.');
  process.exitCode = 0;
}).catch(error => {
  console.error(`Off-site restore preparation failed: ${normalizeOperationalCode(error.code, 'OFFSITE_RESTORE_PREPARATION_FAILED')}`);
  process.exitCode = 1;
});
