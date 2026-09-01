const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.ejs'), 'utf8');
const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');

assert.match(dashboard, /href="\/welcome" class="mode-launch-card" id="guided-objective-trigger"/);
assert.doesNotMatch(dashboard, /id="mode-campaign"|data-mode="campaign"|results-area-campaign/);
assert.doesNotMatch(dashboard, /campaignSections|campaign-sec-btn|campaignProduct|campaignTargetAudience|campaignVoice|campaignGoal/);
assert.doesNotMatch(routeSource, /campaignSections|requestedCampaignSections/);

// Crafted legacy submissions still fail before generation, persistence, or
// usage accounting while old clients receive the canonical recovery URL.
assert.match(routeSource, /if \(genType === 'campaign'\)/);
assert.match(routeSource, /code: 'CAMPAIGN_OBJECTIVE_REQUIRED'/);
assert.match(routeSource, /actionUrl: '\/welcome'/);

console.log('Story 3.121 retired dashboard campaign panel tests passed');
