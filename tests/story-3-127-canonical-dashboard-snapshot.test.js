const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
const dashboardStart = route.indexOf("router.get('/dashboard'");
const generationStart = route.indexOf("router.post('/dashboard/generate'");
const dashboardRoute = route.slice(dashboardStart, generationStart);

assert.match(dashboardRoute, /\.\.\.loadDashboardSnapshot\(db, user\)/);
assert.doesNotMatch(dashboardRoute, /SELECT COUNT|SELECT \* FROM generations|SELECT \* FROM brand_brain/);
assert.doesNotMatch(dashboardRoute, /console\.(?:log|warn|error)/);
assert.match(dashboardRoute, /event: 'dashboard_data_failed'/);
assert.match(dashboardRoute, /res\.status\(503\)\.render\('error'/);

console.log('Story 3.127 canonical dashboard snapshot tests passed');
