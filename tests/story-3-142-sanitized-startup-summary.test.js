const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.match(source, /event: 'auth_configuration_loaded'/);
assert.match(source, /operation: 'google_oauth'/);
assert.match(source, /event: 'database_storage_ready'/);
assert.match(source, /outcome: databaseDiagnostics\.writable \? 'writable' : 'read_only'/);
assert.doesNotMatch(source, /console\.log\(`\s*path:/);
assert.doesNotMatch(source, /console\.log\(`\s*GOOGLE_/);
assert.doesNotMatch(source, /getSessionSecretStatus/);

console.log('Story 3.142 sanitized startup summary tests passed');
