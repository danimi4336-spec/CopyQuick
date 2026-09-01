const assert = require('assert');
const fs = require('fs');
const path = require('path');

const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');

assert.match(view, /var retryDelayMs = 5000/);
assert.match(view, /var maxRetryDelayMs = 60000/);
assert.match(view, /retryDelayMs = Math\.min\(maxRetryDelayMs, retryDelayMs \* 2\)/);
assert.match(view, /latestRunStatus = state\.runStatus;\s*retryDelayMs = 5000/);
assert.match(view, /function scheduleRefresh\(delay\)[\s\S]*if \(pollTimer\) window\.clearTimeout\(pollTimer\)/);
assert.match(view, /window\.addEventListener\('pagehide'[\s\S]*activeController\.abort\(\)/);
assert.match(view, /window\.addEventListener\('pageshow'[\s\S]*event\.persisted[\s\S]*scheduleRefresh\(0\)/);
assert.match(view, /if \(pollingStopped \|\| terminal\.includes\(latestRunStatus\)\) return/);

console.log('Story 3.146 production polling backoff tests passed');
