const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  buildProductionBatchStatus,
  dependencySafePrefix
} = require('../lib/productionBatchPlanning');
const { createDefaultSelection } = require('../lib/buildPlanApproval');

function item(id, title, phase, dependencies = []) {
  return {
    id, title, phase, recommendationLevel: 'recommended', reason: `${title} reason`,
    strategicDirection: `${title} direction`, dependencies
  };
}

const plan = {
  objective: 'launch_product',
  phases: [
    { id: 'define', title: 'Define & Validate', deliverables: [
      item('google_business_profile', 'Business Profile', 'define'),
      item('service_page', 'Service Page', 'define', ['google_business_profile'])
    ] },
    { id: 'feasibility', title: 'Establish Feasibility', deliverables: [
      item('software_product_demo', 'Product Demo', 'feasibility', ['service_page']),
      item('saas_trial_emails', 'Trial Emails', 'feasibility', ['software_product_demo'])
    ] },
    { id: 'operations', title: 'Prepare Operations', deliverables: [
      item('launch_announcement', 'Launch Announcement', 'operations', ['saas_trial_emails']),
      item('educational_content', 'Educational Content', 'operations', ['launch_announcement'])
    ] }
  ]
};
plan.phases.forEach(function(phase) {
  phase.deliverables.forEach(function(deliverable) { deliverable.phaseTitle = phase.title; });
});
const selection = createDefaultSelection(plan);

function fakeDb(completed = []) {
  return {
    prepare(sql) {
      assert.match(sql, /production_jobs/);
      return { all: () => completed };
    }
  };
}

const usage = { used: 6, monthlyLimit: 10, remaining: 4 };
const full = buildProductionBatchStatus({ db: fakeDb(), userId: 1, plan, selection, usageSnapshot: usage, mode: 'full' });
assert.strictEqual(full.valid, true);
assert.strictEqual(full.cost.productionUnitCount, 6);
assert.strictEqual(full.cost.canAfford, false);
assert.deepStrictEqual(full.affordableRecommendation.map(item => item.id), [
  'google_business_profile', 'service_page', 'software_product_demo', 'saas_trial_emails'
]);

const partial = buildProductionBatchStatus({ db: fakeDb(), userId: 1, plan, selection, usageSnapshot: usage, mode: 'affordable' });
assert.strictEqual(partial.cost.productionUnitCount, 4, 'produce the same dependency-safe batch promised by the build-plan estimate');
assert.strictEqual(partial.cost.canAfford, true);
assert.strictEqual(partial.deferred.length, 2);
assert.deepStrictEqual(
  partial.productionNow.map(item => item.id),
  full.affordableRecommendation.map(item => item.id),
  'the handoff batch must match the affordable recommendation shown to the user'
);

const completedRows = [
  { id: 'google_business_profile', generationId: 101, title: 'Business Profile', phase: 'define', phaseTitle: 'Define & Validate', strategicDirection: '', dependencies: '[]', completedAt: '2026-09-01T00:00:00Z' },
  { id: 'service_page', generationId: 102, title: 'Service Page', phase: 'define', phaseTitle: 'Define & Validate', strategicDirection: '', dependencies: '["google_business_profile"]', completedAt: '2026-09-01T00:01:00Z' }
];
const resumed = buildProductionBatchStatus({
  db: fakeDb(completedRows), userId: 1, plan, selection,
  usageSnapshot: { used: 8, monthlyLimit: 10, remaining: 2 }, mode: 'affordable'
});
assert.deepStrictEqual(resumed.completed.map(item => item.id), ['google_business_profile', 'service_page']);
assert.deepStrictEqual(resumed.productionNow.map(item => item.id), ['software_product_demo', 'saas_trial_emails']);
assert.strictEqual(resumed.cost.productionUnitCount, 2, 'completed work must not be charged again');
assert.deepStrictEqual(resumed.completedRecords.map(item => item.id), ['google_business_profile', 'service_page']);

const zero = buildProductionBatchStatus({
  db: fakeDb(), userId: 1, plan, selection,
  usageSnapshot: { used: 10, monthlyLimit: 10, remaining: 0 }, mode: 'affordable'
});
assert.strictEqual(zero.noAffordableBatch, true);
assert.strictEqual(zero.productionNow.length, 0);

assert.deepStrictEqual(dependencySafePrefix(plan.phases[1].deliverables, new Set(), 2), [], 'a batch cannot omit unresolved prerequisites');

const buildPlanView = fs.readFileSync(path.join(__dirname, '..', 'views', 'build-plan.ejs'), 'utf8');
const reviewView = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-review.ejs'), 'utf8');
const studioView = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');
assert.match(buildPlanView, /Available now/);
assert.match(buildPlanView, /Produce Affordable Batch Now/);
assert.match(buildPlanView, /id="optional-deliverables"/);
assert.match(buildPlanView, /data-review-optional/);
assert.match(buildPlanView, /scrollIntoView/);
assert.match(buildPlanView, /target\.focus/);
assert.match(buildPlanView, /\/discovery\/build-plan\/save-later/);
assert.match(buildPlanView, /Compare Plans/);
assert.match(reviewView, /Already completed/);
assert.match(reviewView, /Saved for later/);
assert.match(studioView, /Overall plan progress/);
assert.doesNotMatch(buildPlanView + reviewView + studioView, /strategic_direction|strategySnapshot|dependencyOutputs/);

const renderedBuildPlan = ejs.render(buildPlanView, {
  title: 'Build Plan',
  plan: { summary: { whyThisPlan: 'Test plan' } },
  approval: {
    messages: [], counts: { total: 1, essential: 0, recommended: 0, optional: 1 },
    phases: [{ id: 'operations', title: 'Prepare Operations', reason: 'Test', deliverables: [{
      id: 'optional_item', title: 'Optional Item', reason: 'Test', recommendationLevel: 'optional',
      selected: false, locked: false, dependencyNote: ''
    }] }]
  },
  affordability: null,
  notice: null,
  error: null,
  csrfToken: 'test-token'
});
assert.match(renderedBuildPlan, /id="optional-deliverables"/);
assert.doesNotMatch(renderedBuildPlan, /id=&(?:#34|quot);optional-deliverables/);

console.log('Story 3.196 Affordable Phased Production tests passed');
