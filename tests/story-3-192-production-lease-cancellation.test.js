const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../lib/productionExecution'), 'utf8');
assert.match(source, /const claimController = new AbortController\(\)/);
assert.match(source, /if \(!renewal\.renewed\) claimController\.abort/);
assert.match(source, /signal: claimController\.signal/);

console.log('Story 3.192 Production Lease Cancellation tests passed');
