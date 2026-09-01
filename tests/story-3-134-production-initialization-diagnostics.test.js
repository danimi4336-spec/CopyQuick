const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'production.js'), 'utf8');

assert.match(route, /event: 'production_initialization_failed'/);
assert.match(route, /code: 'PRODUCTION_INITIALIZATION_FAILED'/);
assert.match(route, /requestId: req\.requestId/);
assert.match(route, /route: req\.route\?\.path \|\| 'unmatched'/);
assert.doesNotMatch(route, /console\.(?:log|warn|error)/);
assert.doesNotMatch(route, /err\.(?:message|stack)/);

console.log('Story 3.134 production initialization diagnostics tests passed');
