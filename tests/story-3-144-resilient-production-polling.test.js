const assert = require('assert');
const fs = require('fs');
const path = require('path');

const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');

assert.match(view, /id="production-live-status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(view, /if \(!response\.ok\) throw new Error\('Production status request failed'\)/);
assert.match(view, /Live updates are temporarily unavailable\. Retrying automatically…/);
assert.match(view, /function retryProduction\(\)[\s\S]*scheduleRefresh\(delay\)/);
assert.match(view, /latestRunStatus = state\.runStatus/);
assert.match(view, /liveStatus\(''\)/);
assert.doesNotMatch(view, /if \(!response\.ok\) return;/);

console.log('Story 3.144 resilient production polling tests passed');
