const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.ejs'), 'utf8');

assert.match(dashboard, /Start a Guided Objective/);
assert.match(dashboard, /Build a validated strategy, plan, and production-ready set of deliverables/);
assert.match(dashboard, /href="\/welcome" class="mode-launch-card" id="guided-objective-trigger"/);
assert.match(dashboard, /href="\/brand-brain" class="btn btn-outline btn-lg"/);
assert.doesNotMatch(dashboard, /needs to learn about your business/i);
assert.doesNotMatch(dashboard, /Complete your Brand Brain profile/i);
assert.doesNotMatch(dashboard, /Generate a complete multi-channel campaign/i);
assert.doesNotMatch(dashboard, /estimatedAssets|estimatedTime|journeysData|journeyGroupsData/);
assert.doesNotMatch(dashboard, /class="bj-section|class="bj-card|id="bjBlueprintPanel/);
assert.doesNotMatch(dashboard, /data-mode-trigger="campaign"/);

// Quick and bundle entry points remain direct tools rather than being forced
// through objective discovery.
assert.match(dashboard, /id="mode-quick-trigger" data-mode-trigger="quick"/);
assert.match(dashboard, /id="mode-bundle-trigger" data-mode-trigger="bundle"/);

console.log('Story 3.113 canonical dashboard objective entry tests passed');
