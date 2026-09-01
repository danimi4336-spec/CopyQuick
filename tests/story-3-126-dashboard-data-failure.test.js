const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
const dashboardStart = route.indexOf("router.get('/dashboard'");
const generationStart = route.indexOf("router.post('/dashboard/generate'");
const dashboardRoute = route.slice(dashboardStart, generationStart);

assert.match(dashboardRoute, /event: 'dashboard_data_failed'/);
assert.match(dashboardRoute, /return res\.status\(503\)\.render\('error'/);
assert.match(dashboardRoute, /Your dashboard data could not be loaded safely/);
assert.doesNotMatch(dashboardRoute, /history: \[\]|totalGenerations: 0|brainPct: 0/);
assert.doesNotMatch(dashboardRoute, /err\.message|err\.stack/);

console.log('Story 3.126 dashboard data failure tests passed');
