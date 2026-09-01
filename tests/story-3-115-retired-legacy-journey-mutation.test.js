const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.ejs'), 'utf8');

assert.doesNotMatch(routeSource, /router\.post\('\/dashboard\/update-goal'/);
assert.doesNotMatch(routeSource, /getJourney\(goal\)/);
assert.doesNotMatch(dashboard, /dashboard\/update-goal/);
assert.match(routeSource, /router\.post\('\/dashboard\/generate'/);

console.log('Story 3.115 retired legacy journey mutation tests passed');
