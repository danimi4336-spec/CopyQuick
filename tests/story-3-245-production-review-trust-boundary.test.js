const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const viewPath = path.join(root, 'views', 'production-review.ejs');
const routeSource = fs.readFileSync(path.join(root, 'routes', 'production.js'), 'utf8');

function deliverable(id, title) {
  return { id, title, reason: `${title} supports the approved plan.` };
}

function renderReview({ assets = [], supporting = [], canAfford = true, blockingReason = null } = {}) {
  const productionNow = supporting.concat(assets);
  return ejs.render(fs.readFileSync(viewPath, 'utf8'), {
    error: null,
    csrfToken: 'csrf-test-token',
    readyToUseAssets: assets,
    planningFoundation: supporting,
    batch: { productionNow, completed: [], deferred: [] },
    cost: {
      productionUnitCount: assets.length,
      planningFoundationCount: supporting.length,
      currentUsage: 2,
      monthlyAllowance: 10,
      remainingAllowance: 8,
      canAfford,
      blockingReason
    }
  });
}

const fixture = renderReview({
  assets: [deliverable('consultation_conversion_page_copy', 'Consultation Conversion Page Copy')],
  supporting: [
    deliverable('conversion_diagnostic_brief', 'Conversion Diagnostic Brief'),
    deliverable('consultation_conversion_brief', 'Consultation Conversion Brief'),
    deliverable('conversion_measurement_plan', 'Conversion Measurement Plan')
  ]
});

assert.match(fixture, /Review what CopyQuick will create/);
assert.match(fixture, /Plan readiness[\s\S]*Ready to start/);
assert.match(fixture, /Finished assets[\s\S]*>1</);
assert.match(fixture, /Supporting documents[\s\S]*>3</);
assert.match(fixture, /What you'll receive[\s\S]*1 ready asset/);
assert.match(fixture, /Consultation Conversion Page Copy/);
assert.match(fixture, /Supporting work[\s\S]*3 supporting documents · included free/);
assert.match(fixture, /1 production credit/);
assert.match(fixture, /Current usage[\s\S]*>2</);
assert.match(fixture, /Monthly allowance[\s\S]*>10</);
assert.match(fixture, /Available after production[\s\S]*>7</);
assert.match(fixture, /Usage begins when you select Start Production/);
assert.match(fixture, /name="_csrf" value="csrf-test-token"/);
assert.doesNotMatch(fixture, /name="(?:provider|model|engine|runtime)/i);

[
  'Acceptance-isolated deterministic engine',
  'cannot call an external AI provider',
  'CopyQuick Deterministic',
  'Generation Method',
  'runtime mode',
  'test mode',
  'fixture mode',
  'fallback mode'
].forEach(value => assert.doesNotMatch(fixture, new RegExp(value, 'i')));
assert.doesNotMatch(fixture, /<dt>Provider<\/dt>|<dt>Model<\/dt>|provider id|model id/i);

const planningOnly = renderReview({
  supporting: [deliverable('conversion_diagnostic_brief', 'Conversion Diagnostic Brief')]
});
assert.match(planningOnly, /Planning work ready to start/);
assert.match(planningOnly, /0 ready assets/);
assert.match(planningOnly, /supporting work only; no ready-to-use asset is included/);
assert.match(planningOnly, /0 production credits/);

const mixed = renderReview({
  assets: [deliverable('priority_search_article', 'Priority Search Article'), deliverable('lead_capture_page', 'Lead Capture Page')],
  supporting: [deliverable('research_evidence_pack', 'Research Evidence Pack'), deliverable('priority_content_brief', 'Priority Content Brief')]
});
assert.match(mixed, /2 ready assets/);
assert.match(mixed, /2 supporting documents/);
assert.match(mixed, /Research &amp; Sources/);
assert.match(mixed, /2 production credits/);

const blocked = renderReview({
  assets: [deliverable('consultation_conversion_page_copy', 'Consultation Conversion Page Copy')],
  supporting: [deliverable('conversion_diagnostic_brief', 'Conversion Diagnostic Brief')],
  canAfford: false,
  blockingReason: 'This plan needs 1 Production credit, but only 0 remain.'
});
assert.match(blocked, /Action needed before Production/);
assert.match(blocked, /only 0 remain/);
assert.match(blocked, /Choose an Affordable Batch/);
assert.doesNotMatch(blocked, /<button[^>]*>Start Production<\/button>/);

assert.doesNotMatch(routeSource, /productionProviderStatus|productionSource/);
assert.doesNotMatch(routeSource.slice(routeSource.indexOf("router.post('/production/start'")), /req\.body\.(?:provider|model|engine|runtime)/);

console.log('Story 3.245 Production Review Trust Boundary tests passed');
