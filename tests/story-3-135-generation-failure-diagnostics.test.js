const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');

for (const event of [
  'dashboard_generation_rejected',
  'dashboard_generation_failed',
  'generation_regeneration_failed'
]) {
  assert.match(route, new RegExp(`'${event}'`));
}

for (const code of [
  'GENERATION_REQUEST_INVALID',
  'GENERATION_TONE_INVALID',
  'GENERATION_LIMIT_REACHED',
  'GENERATION_CONTENT_TYPE_INVALID',
  'GENERATION_FAILED',
  'GENERATION_NOT_FOUND',
  'REGENERATION_FAILED'
]) {
  assert.match(route, new RegExp(`'${code}'`));
}

assert.match(route, /requestId: req\.requestId/);
assert.match(route, /route: req\.route\?\.path \|\| 'unmatched'/);
assert.doesNotMatch(route, /console\.(?:log|warn|error)/);

console.log('Story 3.135 generation failure diagnostics tests passed');
