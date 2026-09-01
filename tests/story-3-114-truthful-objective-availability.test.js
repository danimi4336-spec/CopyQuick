const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  objectiveUniverse,
  getObjective,
  getAvailableObjective
} = require('../lib/businessJourneys');

assert(getObjective('launch_product'));
assert(getAvailableObjective('launch_product'));
assert.strictEqual(getAvailableObjective('get_more_customers'), null);
assert.strictEqual(getAvailableObjective('../invalid'), null);
assert.deepStrictEqual(
  objectiveUniverse.filter((objective) => objective.available).map((objective) => objective.id),
  ['launch_product']
);

const welcome = fs.readFileSync(path.join(__dirname, '..', 'views', 'welcome.ejs'), 'utf8');
const builder = fs.readFileSync(path.join(__dirname, '..', 'routes', 'builder.js'), 'utf8');
assert.match(welcome, /objective\.available \? 'required' : 'disabled'/);
assert.match(welcome, /objective-availability">Planned/);
assert.match(builder, /getAvailableObjective\(requestedGoal\)/);
assert.match(builder, /if \(!getAvailableObjective\(goal\)\)/);
assert.match(builder, /Choose an available business objective to continue/);

console.log('Story 3.114 truthful objective availability tests passed');
