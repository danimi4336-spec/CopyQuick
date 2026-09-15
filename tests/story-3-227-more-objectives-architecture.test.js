const assert = require('assert');
const {
  OBJECTIVE_CATALOG_VERSION, OBJECTIVE_DEFINITIONS, REQUIRED_OBJECTIVE_CAPABILITIES,
  getAvailableObjective, objectiveUniverse, validateObjectiveCatalog
} = require('../lib/objectiveFramework');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');

assert.strictEqual(OBJECTIVE_CATALOG_VERSION, 1);
assert.strictEqual(validateObjectiveCatalog().valid, true);
assert.strictEqual(new Set(OBJECTIVE_DEFINITIONS.map(item => item.id)).size, OBJECTIVE_DEFINITIONS.length);
assert(OBJECTIVE_DEFINITIONS.every(item => /^[a-z][a-z0-9_]*$/.test(item.id)));

const notice = objectiveUniverse.find(item => item.id === 'more_objectives');
assert.strictEqual(notice.catalogKind, 'expansion_notice');
assert.strictEqual(notice.availabilityStatus, 'planned');
assert.strictEqual(notice.available, false);
assert.strictEqual(getAvailableObjective('more_objectives'), null);
assert.throws(() => createObjectiveRuntime('more_objectives'), error => error.code === 'OBJECTIVE_JOURNEY_UNAVAILABLE');
assert.throws(() => createObjectiveRuntime('unregistered_future_goal'), error => error.code === 'OBJECTIVE_JOURNEY_UNAVAILABLE');

const incomplete = {
  id: 'incomplete_future_goal', available: true, title: 'Incomplete', description: 'Not ready.',
  outcome: 'Must remain unavailable.', planName: 'Incomplete Plan', journey: { discovery: { policy: 'only_one_boundary' } }
};
const invalid = validateObjectiveCatalog([...OBJECTIVE_DEFINITIONS, incomplete]);
assert.strictEqual(invalid.valid, false);
assert(invalid.errors.includes('incomplete_available_journey:incomplete_future_goal'));

for (const objective of OBJECTIVE_DEFINITIONS.filter(item => item.available)) {
  const runtime = createObjectiveRuntime(objective.id);
  assert(runtime.definition.planName);
  REQUIRED_OBJECTIVE_CAPABILITIES.forEach(capability => assert(runtime.definition.journey[capability]?.policy));
}

console.log('Story 3.227 More Objectives Architecture tests passed');
