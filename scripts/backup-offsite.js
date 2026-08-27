#!/usr/bin/env node
require('dotenv').config();
const { createOffsiteBackup, normalizeOperationalCode } = require('../lib/offsiteBackup');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

createOffsiteBackup({
  source: argumentValue('--source'),
  logger: entry => console.log(`[offsite-backup] ${entry.event}`)
}).then(result => {
  console.log(`Verified encrypted off-site backup uploaded (${result.sizeBytes} bytes, key ${result.keyId}).`);
  process.exitCode = 0;
}).catch(error => {
  console.error(`Off-site backup failed: ${normalizeOperationalCode(error.code)}`);
  process.exitCode = 1;
});
