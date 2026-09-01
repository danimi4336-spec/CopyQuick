const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'contactProtection.js'), 'utf8');

assert.match(source, /event: 'contact_delivery_failed'/);
assert.match(source, /code: 'CONTACT_DELIVERY_FAILED'/);
assert.match(source, /requestId: req\.requestId/);
assert.match(source, /route: req\.route\?\.path \|\| 'unmatched'/);
assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
assert.doesNotMatch(source, /err\.(?:message|stack)/);

console.log('Story 3.138 contact delivery diagnostics tests passed');
