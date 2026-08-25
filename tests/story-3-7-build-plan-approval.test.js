const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const {
  createApprovedProductionSet,
  createDefaultSelection,
  planFingerprint,
  updateSelection,
  validateSelection
} = require('../lib/buildPlanApproval');
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function facts() {
  return {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    targetAudience: confirmed('health-conscious adults', 'Health-conscious adults'),
    customerMotivation: confirmed('solve_problem', 'It solves a clear problem'),
    salesChannel: confirmed('amazon', 'Amazon'),
    competitiveDifferentiation: confirmed('partial', 'It is different in a few ways'),
    launchStage: confirmed('development', 'In development'),
    brand: confirmed('established', 'Established')
  };
}

function strategyFor(understanding) {
  return buildStrategy({
    objective: 'launch_product',
    understanding,
    confirmedUnderstanding: understanding,
    answers: { initial_description: 'Organic turmeric supplement' }
  });
}

function planFor(understanding = facts(), strategyResult = strategyFor(understanding)) {
  return buildPlan({
    objective: 'launch_product',
    confirmedUnderstanding: understanding,
    strategyResult,
    answers: { initial_description: 'Organic turmeric supplement' }
  });
}

function allItems(plan) {
  return plan.phases.flatMap(function(phase) { return phase.deliverables; });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function request(agent, method, url, body) {
  return new Promise((resolve, reject) => {
    const parameters = new URLSearchParams();
    Object.entries(body || {}).forEach(function(entry) {
      const values = Array.isArray(entry[1]) ? entry[1] : [entry[1]];
      values.forEach(function(value) { parameters.append(entry[0], value); });
    });
    const payload = parameters.toString();
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (agent.cookie) headers.Cookie = agent.cookie;
    const req = http.request({
      hostname: '127.0.0.1',
      port: agent.server.address().port,
      method,
      path: url,
      headers
    }, (res) => {
      const cookies = res.headers['set-cookie'];
      if (cookies) agent.cookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function discoveryState(mode = 'valid') {
  const understanding = facts();
  const strategyResult = strategyFor(understanding);
  const plan = planFor(understanding, strategyResult);
  const now = new Date().toISOString();
  const state = {
    objective: 'launch_product',
    answers: { initial_description: 'Organic turmeric supplement' },
    understanding,
    planningReadiness: { ready: true },
    reflectionStartedAt: now,
    startedAt: now,
    updatedAt: now
  };
  if (mode !== 'missing_reflection') {
    state.planningConfirmedAt = now;
    state.confirmedUnderstanding = understanding;
  }
  if (!['missing_reflection', 'missing_strategy'].includes(mode)) {
    state.strategyResult = strategyResult;
    state.strategyUpdatedAt = now;
  }
  if (!['missing_reflection', 'missing_strategy', 'missing_plan'].includes(mode)) {
    state.buildPlan = plan;
    state.buildPlanUpdatedAt = now;
    state.buildPlanSource = {
      planningConfirmedAt: state.planningConfirmedAt,
      strategyUpdatedAt: state.strategyUpdatedAt
    };
    state.buildPlanFingerprint = planFingerprint(plan);
    state.buildPlanSelection = createDefaultSelection(plan);
  }
  if (mode === 'stale_plan') state.buildPlanSource.strategyUpdatedAt = new Date(Date.now() - 60000).toISOString();
  return state;
}

async function run() {
  const plan = planFor();
  const items = allItems(plan);
  const defaults = createDefaultSelection(plan);
  const selected = new Set(defaults.selectedDeliverableIds);
  items.filter((item) => item.recommendationLevel === 'essential').forEach((item) => assert(selected.has(item.id)));
  items.filter((item) => item.recommendationLevel === 'recommended').forEach((item) => assert(selected.has(item.id)));
  items.filter((item) => item.recommendationLevel === 'optional').forEach((item) => assert(!selected.has(item.id)));

  const withoutSocial = defaults.selectedDeliverableIds.filter((id) => id !== 'social_launch_campaign');
  const customized = updateSelection({ plan, currentSelection: defaults, requestedDeliverableIds: withoutSocial });
  assert.strictEqual(customized.valid, true);
  assert(!customized.selection.selectedDeliverableIds.includes('social_launch_campaign'));

  const withOptional = updateSelection({
    plan,
    currentSelection: customized.selection,
    requestedDeliverableIds: customized.selection.selectedDeliverableIds.concat('amazon_a_plus')
  });
  assert(withOptional.selection.selectedDeliverableIds.includes('amazon_a_plus'));

  const onlyBullets = updateSelection({
    plan,
    currentSelection: createDefaultSelection(plan),
    requestedDeliverableIds: ['amazon_bullet_points']
  });
  assert.strictEqual(onlyBullets.valid, true);
  assert(onlyBullets.selection.selectedDeliverableIds.includes('amazon_listing'));
  assert(onlyBullets.selection.selectedDeliverableIds.includes('core_messaging'));
  assert(onlyBullets.selection.messages.some((message) => /was kept|was added/.test(message) && /depends on/.test(message)));

  const attemptedDependencyRemoval = updateSelection({
    plan,
    currentSelection: defaults,
    requestedDeliverableIds: defaults.selectedDeliverableIds.filter((id) => id !== 'product_positioning')
  });
  assert(attemptedDependencyRemoval.selection.selectedDeliverableIds.includes('product_positioning'));
  assert(attemptedDependencyRemoval.selection.messages.some((message) => /Product Positioning was kept/.test(message)));

  const emptySelection = {
    ...defaults,
    selectedDeliverableIds: [],
    requiredDependencyIds: [],
    deselectedDeliverableIds: items.map((item) => item.id)
  };
  assert.strictEqual(validateSelection(plan, emptySelection).valid, false);

  const brokenSelection = {
    ...defaults,
    selectedDeliverableIds: ['amazon_listing'],
    requiredDependencyIds: []
  };
  const broken = validateSelection(plan, brokenSelection);
  assert.strictEqual(broken.valid, false);
  assert.match(broken.error, /requires/);

  const circularPlan = {
    objective: 'launch_product',
    phases: [{
      id: 'foundation', title: 'Foundation', deliverables: [
        { id: 'one', title: 'One', phase: 'foundation', recommendationLevel: 'optional', dependencies: ['two'] },
        { id: 'two', title: 'Two', phase: 'foundation', recommendationLevel: 'optional', dependencies: ['one'] }
      ]
    }]
  };
  const circularCurrent = {
    selectedDeliverableIds: [],
    planFingerprint: planFingerprint(circularPlan)
  };
  const circular = updateSelection({ plan: circularPlan, currentSelection: circularCurrent, requestedDeliverableIds: ['one'] });
  assert.strictEqual(circular.valid, false);
  assert.match(circular.error, /circular dependency/);

  const approved = createApprovedProductionSet({ plan, selection: withOptional.selection, strategyResult: strategyFor(facts()) });
  assert.strictEqual(approved.valid, true);
  assert(approved.productionSet.approvedAt);
  assert.strictEqual(approved.productionSet.selectedDeliverables.length, withOptional.selection.selectedDeliverableIds.length);
  assert(!approved.productionSet.productionOrder.includes('social_launch_campaign'));
  const order = approved.productionSet.productionOrder;
  assert(order.indexOf('customer_profile') < order.indexOf('product_positioning'));
  assert(order.indexOf('core_messaging') < order.indexOf('amazon_listing'));
  assert(order.indexOf('amazon_listing') < order.indexOf('amazon_a_plus'));
  assert.strictEqual(approved.productionSet.planFingerprint, planFingerprint(plan));

  const changedPlan = JSON.parse(JSON.stringify(plan));
  changedPlan.phases[0].deliverables[0].strategicDirection = 'Changed strategic direction';
  assert.notStrictEqual(planFingerprint(changedPlan), planFingerprint(plan));
  assert.strictEqual(validateSelection(changedPlan, defaults).valid, false);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-7-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:mode', (req, res) => {
    req.session.userId = 37;
    req.session.discoverySession = discoveryState(req.params.mode);
    req.session.credits = 19;
    req.session.usageCount = 8;
    req.session.generations = ['existing'];
    req.session.brandBrain = { company: 'Unchanged' };
    req.session.billingState = { subscription: 'unchanged' };
    res.redirect('/discovery/build-plan');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json({ ...req.session, testCsrfToken: req.csrfToken() }));
  app.use(discoveryRoutes);

  const server = await listen(app);
  const anonymous = { server, cookie: '' };
  const missingReflection = { server, cookie: '' };
  const missingStrategy = { server, cookie: '' };
  const missingPlan = { server, cookie: '' };
  const stalePlan = { server, cookie: '' };
  const valid = { server, cookie: '' };
  try {
    const denied = await request(anonymous, 'POST', '/discovery/build-plan/approve');
    assert.strictEqual(denied.res.statusCode, 403, 'CSRF runs before authentication for unsafe anonymous requests');
    const deniedPage = await request(anonymous, 'GET', '/discovery/production-ready');
    assert.strictEqual(deniedPage.res.statusCode, 302);
    assert.strictEqual(deniedPage.res.headers.location, '/login');

    await request(missingReflection, 'GET', '/test/authenticate/missing_reflection');
    assert.strictEqual((await request(missingReflection, 'POST', '/discovery/build-plan/approve', { _csrf: 'invalid' })).res.statusCode, 403);
    const missingReflectionPage = await request(missingReflection, 'GET', '/discovery/build-plan');
    assert.strictEqual(missingReflectionPage.res.headers.location, '/discovery/reflection');

    await request(missingStrategy, 'GET', '/test/authenticate/missing_strategy');
    assert.strictEqual((await request(missingStrategy, 'GET', '/discovery/build-plan')).res.headers.location, '/discovery/reflection');

    await request(missingPlan, 'GET', '/test/authenticate/missing_plan');
    const rebuiltPlan = await request(missingPlan, 'GET', '/discovery/build-plan');
    assert.strictEqual(rebuiltPlan.res.statusCode, 200, 'the canonical Story 3.6 route may build a missing plan');

    await request(stalePlan, 'GET', '/test/authenticate/stale_plan');
    const staleSessionPage = await request(stalePlan, 'GET', '/test/session');
    const staleToken = JSON.parse(staleSessionPage.body).testCsrfToken;
    const staleApproval = await request(stalePlan, 'POST', '/discovery/build-plan/approve', { _csrf: staleToken });
    assert.strictEqual(staleApproval.res.statusCode, 302);
    assert.strictEqual(staleApproval.res.headers.location, '/discovery/build-plan');

    await request(valid, 'GET', '/test/authenticate/valid');
    const page = await request(valid, 'GET', '/discovery/build-plan');
    assert.strictEqual(page.res.statusCode, 200);
    assert.match(page.body, /Approve &amp; Prepare for Production/);
    assert.match(page.body, /Save Plan Choices/);
    assert.match(page.body, /Include in production|Included as a prerequisite/);
    assert.match(page.body, /Essential:/);
    assert.match(page.body, /Recommended:/);
    assert.match(page.body, /Optional:/);
    assert.match(page.body, /Strategic direction/);
    assert.match(page.body, /Amazon is the confirmed sales channel/);
    assert.doesNotMatch(page.body, /priority|estimatedCredits|estimatedTime|\d+ credits|\d+ seconds/i);
    const token = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];

    const csrfDenied = await request(valid, 'POST', '/discovery/build-plan/selection', {
      selectedDeliverableIds: defaults.selectedDeliverableIds
    });
    assert.strictEqual(csrfDenied.res.statusCode, 403);

    const selectedWithoutSocial = defaults.selectedDeliverableIds.filter((id) => id !== 'social_launch_campaign');
    const saved = await request(valid, 'POST', '/discovery/build-plan/selection', {
      _csrf: token,
      selectedDeliverableIds: selectedWithoutSocial.concat('amazon_a_plus')
    });
    assert.strictEqual(saved.res.statusCode, 303);
    assert.strictEqual(saved.res.headers.location, '/discovery/build-plan');
    const persistedPage = await request(valid, 'GET', '/discovery/build-plan');
    assert.match(persistedPage.body, /value="amazon_a_plus"[^>]*checked/);
    assert.doesNotMatch(persistedPage.body, /value="social_launch_campaign"[^>]*checked/);
    const approvalToken = persistedPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];

    const approvalResponse = await request(valid, 'POST', '/discovery/build-plan/approve', { _csrf: approvalToken });
    assert.strictEqual(approvalResponse.res.statusCode, 303);
    assert.strictEqual(approvalResponse.res.headers.location, '/discovery/production-ready');
    const handoff = await request(valid, 'GET', '/discovery/production-ready');
    assert.strictEqual(handoff.res.statusCode, 200);
    assert.match(handoff.body, /Your production plan is ready\./);
    assert.match(handoff.body, /Nothing has been generated yet/);
    assert.match(handoff.body, /Review Cost &amp; Start Production/);
    assert.match(handoff.body, /No usage is consumed until/);

    const stored = JSON.parse((await request(valid, 'GET', '/test/session')).body);
    assert(stored.discoverySession.buildPlanSelection.approvedAt);
    assert(stored.discoverySession.approvedProductionSet.approvedAt);
    assert(!stored.discoverySession.approvedProductionSet.productionOrder.includes('social_launch_campaign'));
    assert.strictEqual(stored.credits, 19);
    assert.strictEqual(stored.usageCount, 8);
    assert.deepStrictEqual(stored.generations, ['existing']);
    assert.deepStrictEqual(stored.brandBrain, { company: 'Unchanged' });
    assert.deepStrictEqual(stored.billingState, { subscription: 'unchanged' });

    console.log('Story 3.7 Build Plan Approval tests passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
