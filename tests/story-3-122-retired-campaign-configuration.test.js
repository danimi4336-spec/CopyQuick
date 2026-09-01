const assert = require('assert');
const modes = require('../lib/generatorModes');

assert.deepStrictEqual(Object.keys(modes).sort(), [
  'audiencePresets',
  'brandVoices',
  'bundleAssets',
  'resolveBundleAsset'
]);
assert.strictEqual(modes.campaignSections, undefined);
assert.strictEqual(modes.goals, undefined);
assert.ok(modes.bundleAssets.length > 0);
assert.ok(modes.brandVoices.length > 0);
assert.ok(modes.audiencePresets.length > 0);

console.log('Story 3.122 retired campaign configuration tests passed');
