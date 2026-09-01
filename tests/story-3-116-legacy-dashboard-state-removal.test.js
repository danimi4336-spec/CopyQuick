const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');

for (const deadDashboardState of [
  'getGroupsWithJourneys',
  'getAllJourneys',
  'goalLabels',
  'journeyGroupsData',
  'journeysData',
  'builderGoal',
  'campaignCount',
  'journeySafe'
]) {
  assert(!routeSource.includes(deadDashboardState), `dashboard route must not retain ${deadDashboardState}`);
}

assert.match(routeSource, /quickCount:[\s\S]*generation_type = 'quick'/);
assert.match(routeSource, /bundleCount:[\s\S]*generation_type = 'bundle'/);
assert.match(routeSource, /brainPct: brainPct/);
assert.match(routeSource, /aiCredits: aiCredits/);

console.log('Story 3.116 legacy dashboard state removal tests passed');
