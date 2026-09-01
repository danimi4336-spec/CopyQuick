const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.ejs'), 'utf8');

  assert.match(dashboard, /href="\/welcome"[^>]*>🚀 Start a Guided Objective →<\/a>/);
  assert.match(dashboard, /href="\/welcome"[^>]*id="mode-campaign-trigger"/);
  assert.match(dashboard, /Add Brand Context/);
  assert.match(dashboard, /Update Brand Context/);
  assert.doesNotMatch(dashboard, /Continue to Brand Brain/);
  assert.doesNotMatch(dashboard, /selectedJourneyId|bjCtaBtn|dashboard\/update-goal/);
  assert.doesNotMatch(dashboard, /Estimated Assets|Estimated Time|Select a Business Journey/);
  console.log('Story 3.26 Objective Entry Consolidation tests passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
