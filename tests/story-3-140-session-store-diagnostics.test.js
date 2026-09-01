const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sessionStore.js'), 'utf8');

assert.match(source, /event: 'session_data_rejected'/);
assert.match(source, /code: 'SESSION_DATA_INVALID'/);
assert.match(source, /outcome: 'discarded'/);
assert.match(source, /event: 'session_cleanup_failed'/);
assert.match(source, /code: 'SESSION_CLEANUP_FAILED'/);
assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
assert.doesNotMatch(source, /\bsid\b[^\n]*operationalLogger|operationalLogger[^\n]*\bsid\b/);

console.log('Story 3.140 session store diagnostics tests passed');
