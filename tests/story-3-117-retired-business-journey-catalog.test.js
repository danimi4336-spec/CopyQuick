const assert = require('assert');
const fs = require('fs');
const path = require('path');
const journeys = require('../lib/businessJourneys');

assert.deepStrictEqual(
  Object.keys(journeys).sort(),
  ['getAvailableObjective', 'getObjective', 'objectiveUniverse']
);
assert.strictEqual(journeys.getAvailableObjective('launch_product')?.id, 'launch_product');
assert.strictEqual(journeys.getAvailableObjective('build_brand'), null);

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'businessJourneys.js'), 'utf8');
assert.doesNotMatch(source, /estimatedAssets|estimatedTime|journeyGroups|const journeys =|getGroupsWithJourneys|getPlatformsForJourney|getAssetCount/);
assert.doesNotMatch(source, /≈ 1 minute|Product Images ✏️|Facebook Ads/);

console.log('Story 3.117 retired business journey catalog tests passed');
