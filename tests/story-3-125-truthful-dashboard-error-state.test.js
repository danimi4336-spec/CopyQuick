const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');

assert.match(route, /function loadDashboardSnapshot\(db, user/);
assert.match(route, /totalGenerations: db\.prepare/);
assert.match(route, /quickCount: db\.prepare/);
assert.match(route, /bundleCount: db\.prepare/);
assert.match(route, /brainPct: usesConfirmedMemory \? memoryProjection\.confirmedCoverage : Math\.round/);
assert.match(route, /brainFilled = usesConfirmedMemory \? memoryProjection\.confirmedCount : legacyBrainFilled/);
assert.doesNotMatch(route.slice(route.indexOf("router.post('/dashboard/generate'")), /quickCount: 0|bundleCount: 0|brainPct: 0/);

console.log('Story 3.125 truthful dashboard error state tests passed');
