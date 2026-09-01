const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

for (const [event, code] of [
  ['database_runtime_lock_heartbeat_failed', 'RUNTIME_LOCK_HEARTBEAT_FAILED'],
  ['database_runtime_lock_release_failed', 'RUNTIME_LOCK_RELEASE_FAILED'],
  ['application_startup_failed', 'DATABASE_STARTUP_FAILED']
]) {
  assert.match(source, new RegExp(`'${event}'`));
  assert.match(source, new RegExp(`'${code}'`));
}

assert.match(source, /logRuntimeLockReleaseFailure\(release, 'shutdown'\)/);
assert.match(source, /logRuntimeLockReleaseFailure\(release, 'startup_failure'\)/);
assert.doesNotMatch(source, /console\.error\(`?Database (?:runtime lock release|startup) failed/);

console.log('Story 3.141 runtime ownership diagnostics tests passed');
