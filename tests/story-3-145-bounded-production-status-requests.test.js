const assert = require('assert');
const fs = require('fs');
const path = require('path');

const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');

assert.match(view, /var statusRequestTimeoutMs = 10000/);
assert.match(view, /var controller = new AbortController\(\)/);
assert.match(view, /controller\.abort\(\)/);
assert.match(view, /signal: controller\.signal/);
assert.match(view, /finally \{\s*window\.clearTimeout\(requestTimeout\)/);
assert.match(view, /catch \(err\)[\s\S]*retryProduction\(\)/);

console.log('Story 3.145 bounded production status request tests passed');
