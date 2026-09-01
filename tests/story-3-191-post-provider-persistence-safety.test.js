const assert = require('assert');
const fs = require('fs');

const executionSource = fs.readFileSync(require.resolve('../lib/productionExecution'), 'utf8');
assert.match(executionSource, /PRODUCTION_RESULT_PERSISTENCE_FAILED/);
assert.match(executionSource, /error\.ambiguous = true/);
assert.match(executionSource, /error\.safeToRetry = false/);

console.log('Story 3.191 Post-Provider Persistence Safety tests passed');
