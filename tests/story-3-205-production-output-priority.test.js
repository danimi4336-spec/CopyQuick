const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readyPolicy = { role: 'ready_to_use_asset' };
const foundationPolicy = { role: 'planning_foundation' };

['build-plan.ejs', 'production-ready.ejs'].forEach(function(viewName) {
  const source = fs.readFileSync(path.join(root, 'views', viewName), 'utf8');
  assert.match(source, /Ready-to-use output deliverables/);
  assert.match(source, /Free planning foundation deliverables/);
  assert.match(source, /<details class="planning-foundation-disclosure">/);
  assert(source.indexOf('Ready-to-use output deliverables') < source.indexOf('Free planning foundation deliverables'));
});

const reviewSource = fs.readFileSync(path.join(root, 'views', 'production-review.ejs'), 'utf8');
assert.match(reviewSource, /What you'll receive/);
assert.match(reviewSource, /<span>Supporting work<\/span>/);
assert.match(reviewSource, /<details class="planning-foundation-disclosure">/);
assert(reviewSource.indexOf("What you'll receive") < reviewSource.indexOf('<span>Supporting work</span>'));

ejs.renderFile(path.join(root, 'views', 'production-studio.ejs'), {
  production: { id: 12, status: 'completed', jobs: [], production_cost_units: 3, started_at: 'now', costingModel: 'ready_to_use_asset_unit' },
  phases: [
    { id: 'strategy', title: 'Plan', jobs: [
      { sequence_order: 0, title: 'Customer Acquisition Snapshot', artifactPolicy: foundationPolicy, dependencies: [], status: 'completed', generation_id: 38, error_message: null }
    ] },
    { id: 'assets', title: 'Create', jobs: [
      { sequence_order: 1, title: 'Paid Ad Copy Set', artifactPolicy: readyPolicy, dependencies: [], status: 'completed', generation_id: 42, error_message: null },
      { sequence_order: 2, title: 'Lead Capture Page', artifactPolicy: readyPolicy, dependencies: [], status: 'completed', generation_id: 43, error_message: null }
    ] }
  ],
  completedCount: 3,
  executionNotice: null,
  hasExpiredLease: false,
  csrfToken: 'test',
  planProgress: null,
  synthesis: null
}, {}, function(error, html) {
  if (error) throw error;
  assert.match(html, /id="ready-assets-title">Ready for review/);
  assert.match(html, /Open finished assets to review, copy, or download them/);
  assert.match(html, /<details class="production-foundation-disclosure">/);
  assert.match(html, /<span>Strategy &amp; Planning<\/span>/);
  assert.doesNotMatch(html, /<details class="production-foundation-disclosure" open/);
  assert(html.indexOf('Paid Ad Copy Set') < html.indexOf('Strategy &amp; Planning'));
  assert(html.indexOf('Lead Capture Page') < html.indexOf('Strategy &amp; Planning'));
  assert(html.indexOf('Strategy &amp; Planning') < html.indexOf('Customer Acquisition Snapshot'));
  assert.match(html, /<span class="production-job-order">1<\/span>[\s\S]*Paid Ad Copy Set/);
  assert.match(html, /<span class="production-job-order">2<\/span>[\s\S]*Lead Capture Page/);
  assert.match(html, /Strategy &amp; Planning[\s\S]*<span class="production-job-order">1<\/span>[\s\S]*Customer Acquisition Snapshot/);
  assert.strictEqual((html.match(/<li data-production-sequence=/g) || []).length, 3);
  console.log('Story 3.205 Production Output Priority tests passed');
});
