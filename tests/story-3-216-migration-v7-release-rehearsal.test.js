const assert = require('assert');
const { spawnSync } = require('child_process');

const result = spawnSync(process.execPath, ['scripts/rehearse-migration-v7.js'], {
  cwd: require('path').join(__dirname, '..'),
  encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'test' }
});

assert.strictEqual(result.status, 0, result.stderr);
const report = JSON.parse(result.stdout);
assert.deepStrictEqual(report, {
  ok: true,
  fixtureVersion: 6,
  migratedVersion: 7,
  migrationAppliedOnce: true,
  restartVerified: true,
  businessRowsPreserved: true,
  preMigrationBackupVerified: true,
  restoreVerified: true,
  restoredVersion: 6,
  artifactsRetained: false
});

console.log('Story 3.216 Migration V7 Release Rehearsal tests passed');
