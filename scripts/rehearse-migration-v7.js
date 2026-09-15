#!/usr/bin/env node
const { rehearseMigrationV7 } = require('../lib/migrationV7Rehearsal');

rehearseMigrationV7({ logger: () => {} }).then(result => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}).catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: String(error?.code || 'MIGRATION_V7_REHEARSAL_FAILED') })}\n`);
  process.exitCode = 1;
});
