const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { assertIsolatedTestDatabase } = require('./helpers/isolatedTestDatabase');
assertIsolatedTestDatabase();
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
const { initDb } = require('../db/init');
const { getDb } = require('../db/database');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function facts() {
  return {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    intendedOutcome: confirmed('everyday_wellness', 'Everyday wellness'),
    conceptMaturity: confirmed('formula_in_mind', 'Ingredients or formula in mind'),
    existingProductDefinition: {
      ...confirmed('An organic turmeric capsule concept with a preliminary formula.', 'An organic turmeric capsule concept with a preliminary formula.'),
      semanticRole: 'builder_provided_product_context'
    },
    targetAudience: confirmed('health-conscious adults', 'Health-conscious adults'),
    customerMotivation: confirmed('solve_problem', 'It solves a clear problem'),
    salesChannel: confirmed('amazon', 'Amazon'),
    competitiveDifferentiation: confirmed('partial', 'It is different in a few ways'),
    launchStage: confirmed('ready', 'Ready to launch'),
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
  if (mode === 'planning_only') {
    const understanding = {
      businessType: confirmed('software', 'Software / SaaS'),
      industry: confirmed('technology', 'Technology'),
      currentOffer: confirmed('project_management_software', 'Project management software'),
      targetAudience: confirmed('small_professional_services_teams', 'Small professional-services teams'),
      funnelType: confirmed('trial_signup', 'Start a trial or account'),
      primaryCta: confirmed('start_free_trial', 'Start a free trial'),
      trafficSource: confirmed('unsure', "I'm not sure yet"),
      pageExperience: confirmed('unsure', "I'm not sure yet"),
      conversionEvidence: confirmed('unsure', "I'm not sure yet"),
      conversionFriction: confirmed('unsure', "I'm not sure yet")
    };
    const answers = {
      initial_description: 'Project-management SaaS for small professional-services teams with a self-service free trial.',
      conversion_traffic: 'unsure', conversion_page: 'unsure',
      conversion_evidence: 'unsure', conversion_friction: 'unsure'
    };
    const strategyResult = buildStrategy({ objective: 'increase_conversion_rates', understanding, confirmedUnderstanding: understanding, answers });
    const plan = buildPlan({ objective: 'increase_conversion_rates', confirmedUnderstanding: understanding, strategyResult, answers });
    const now = new Date().toISOString();
    return {
      objective: 'increase_conversion_rates', answers, understanding, confirmedUnderstanding: understanding,
      planningReadiness: { ready: true }, reflectionStartedAt: now, planningConfirmedAt: now,
      strategyResult, strategyUpdatedAt: now, buildPlan: plan, buildPlanUpdatedAt: now,
      buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
      buildPlanFingerprint: planFingerprint(plan), buildPlanSelection: createDefaultSelection(plan),
      startedAt: now, updatedAt: now
    };
  }
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

  const tampered = updateSelection({
    plan,
    currentSelection: defaults,
    requestedDeliverableIds: defaults.selectedDeliverableIds.concat('operator_only_deliverable')
  });
  assert.strictEqual(tampered.valid, false);
  assert.match(tampered.error, /current Build Plan/);
  const malformed = updateSelection({ plan, currentSelection: defaults, requestedDeliverableIds: [{ id: 'customer_profile' }] });
  assert.strictEqual(malformed.valid, false);
  const oversized = updateSelection({
    plan,
    currentSelection: defaults,
    requestedDeliverableIds: Array(plan.phases.reduce((count, phase) => count + phase.deliverables.length, 0) + 1).fill('customer_profile')
  });
  assert.strictEqual(oversized.valid, false);

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
  initDb();
  getDb().prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)')
    .run(37, 'story-3-7@example.com', 'Build Plan Tester');
  getDb().prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)')
    .run(38, 'story-3-7-save-failure@example.com', 'Build Plan Save Failure Tester');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-7-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:mode', (req, res) => {
    req.session.userId = req.params.mode === 'persistence_failure' ? 38 : 37;
    const stateMode = req.params.mode === 'persistence_failure' ? 'valid' : req.params.mode;
    req.session.discoverySession = discoveryState(stateMode);
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
  const planningOnly = { server, cookie: '' };
  const persistenceFailure = { server, cookie: '' };
  try {
    const denied = await request(anonymous, 'POST', '/discovery/build-plan/approve');
    assert.strictEqual(denied.res.statusCode, 403, 'CSRF runs before authentication for unsafe anonymous requests');
    const deniedPage = await request(anonymous, 'GET', '/discovery/production-ready');
    assert.strictEqual(deniedPage.res.statusCode, 302);
    assert.strictEqual(deniedPage.res.headers.location, '/login');

    await request(planningOnly, 'GET', '/test/authenticate/planning_only');
    const planningOnlyPage = await request(planningOnly, 'GET', '/discovery/build-plan');
    assert.strictEqual(planningOnlyPage.res.statusCode, 200);
    assert.match(planningOnlyPage.body, /This plan currently supports planning only/);
    assert.doesNotMatch(planningOnlyPage.body, /Approve &amp; Prepare for Production/);

    getDb().exec(`CREATE TRIGGER reject_story_3_7_saved_plan
      BEFORE INSERT ON saved_build_plan_states WHEN NEW.user_id = 38
      BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END`);
    await request(persistenceFailure, 'GET', '/test/authenticate/persistence_failure');
    const persistenceFailurePage = await request(persistenceFailure, 'GET', '/discovery/build-plan');
    const persistenceFailureResponse = await request(persistenceFailure, 'POST', '/discovery/build-plan/selection', {
      _csrf: persistenceFailurePage.body.match(/name="_csrf" value="([^"]+)"/)?.[1],
      selectedDeliverableIds: defaults.selectedDeliverableIds
    });
    assert.strictEqual(persistenceFailureResponse.res.statusCode, 409);
    assert.match(persistenceFailureResponse.body, /This plan could not be saved safely\. Review it and try again\./);
    assert.strictEqual(getDb().prepare('SELECT COUNT(*) AS count FROM saved_build_plan_states WHERE user_id = ?').get(38).count, 0);
    const failedSaveSession = JSON.parse((await request(persistenceFailure, 'GET', '/test/session')).body);
    assert.strictEqual(failedSaveSession.discoverySession.buildPlanSavedAt, undefined);
    assert.strictEqual(failedSaveSession.discoverySession.buildPlanNotice, undefined);
    assert.deepStrictEqual(
      failedSaveSession.discoverySession.buildPlanSelection.selectedDeliverableIds,
      defaults.selectedDeliverableIds,
      'a failed upsert must not leave an unsaved selection in the session'
    );
    getDb().exec('DROP TRIGGER reject_story_3_7_saved_plan');

    await request(missingReflection, 'GET', '/test/authenticate/missing_reflection');
    assert.strictEqual((await request(missingReflection, 'POST', '/discovery/build-plan/approve', { _csrf: 'invalid' })).res.statusCode, 403);
    const missingReflectionPage = await request(missingReflection, 'GET', '/discovery/build-plan');
    assert.strictEqual(missingReflectionPage.res.headers.location, '/discovery/reflection');

    await request(missingStrategy, 'GET', '/test/authenticate/missing_strategy');
    assert.strictEqual((await request(missingStrategy, 'GET', '/discovery/build-plan')).res.headers.location, '/discovery/reflection');

    await request(missingPlan, 'GET', '/test/authenticate/missing_plan');
    const missingPlanGet = await request(missingPlan, 'GET', '/discovery/build-plan');
    assert.strictEqual(missingPlanGet.res.statusCode, 302, 'Build Plan GET must not create a missing plan');
    assert.strictEqual(missingPlanGet.res.headers.location, '/discovery/strategy');
    const missingPlanStrategy = await request(missingPlan, 'GET', '/discovery/strategy');
    const preparedPlan = await request(missingPlan, 'POST', '/discovery/build-plan/prepare', {
      _csrf: missingPlanStrategy.body.match(/name="_csrf" value="([^"]+)"/)?.[1],
      strategyPreparationToken: missingPlanStrategy.body.match(/name="strategyPreparationToken" value="([^"]+)"/)?.[1]
    });
    assert.strictEqual(preparedPlan.res.statusCode, 303);
    assert.strictEqual((await request(missingPlan, 'GET', '/discovery/build-plan')).res.statusCode, 200);

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
    assert.match(page.body, /Free planning foundation:/);
    assert.match(page.body, /Production credits:/);
    assert.match(page.body, /Total steps:/);
    assert.match(page.body, /Ready-to-use output deliverables/);
    assert.match(page.body, /<details class="planning-foundation-disclosure">/);
    assert(page.body.indexOf('Ready-to-use output deliverables') < page.body.indexOf('Free planning foundation documents'));
    assert.doesNotMatch(page.body, /Strategic direction|Builder-provided offer description|Treat this as unverified context/);
    assert.match(page.body, /Amazon is the confirmed sales channel/);
    assert.doesNotMatch(page.body, /priority|estimatedCredits|estimatedTime|\d+ credits|\d+ seconds/i);
    const token = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];

    const csrfDenied = await request(valid, 'POST', '/discovery/build-plan/selection', {
      selectedDeliverableIds: defaults.selectedDeliverableIds
    });
    assert.strictEqual(csrfDenied.res.statusCode, 403);

    assert.strictEqual(
      getDb().prepare('SELECT COUNT(*) AS count FROM saved_build_plan_states WHERE user_id = ? AND objective = ?')
        .get(37, 'launch_product').count,
      0,
      'the executable plan must also begin without a saved row'
    );
    const tamperedSelection = await request(valid, 'POST', '/discovery/build-plan/selection', {
      _csrf: token,
      selectedDeliverableIds: defaults.selectedDeliverableIds.concat('operator_only_deliverable')
    });
    assert.strictEqual(tamperedSelection.res.statusCode, 409);
    assert.match(tamperedSelection.body, /Choose only deliverables from the current Build Plan/);
    assert.strictEqual(
      getDb().prepare('SELECT COUNT(*) AS count FROM saved_build_plan_states WHERE user_id = ? AND objective = ?')
        .get(37, 'launch_product').count,
      0,
      'a tampered selection must not create a saved row'
    );

    const selectedWithoutSocial = defaults.selectedDeliverableIds.filter((id) => id !== 'social_launch_campaign');
    const saved = await request(valid, 'POST', '/discovery/build-plan/selection', {
      _csrf: token,
      selectedDeliverableIds: selectedWithoutSocial.concat('amazon_a_plus')
    });
    assert.strictEqual(saved.res.statusCode, 303);
    assert.strictEqual(saved.res.headers.location, '/discovery/build-plan');
    const persistedPage = await request(valid, 'GET', '/discovery/build-plan');
    assert.match(persistedPage.body, /Plan saved\./);
    assert.match(persistedPage.body, /No Production credits are used until you start Production\./);
    assert.match(persistedPage.body, /Start an Objective → Saved Plan/);
    assert.match(persistedPage.body, /value="amazon_a_plus"[^>]*checked/);
    assert.doesNotMatch(persistedPage.body, /value="social_launch_campaign"[^>]*checked/);
    assert.strictEqual(
      getDb().prepare('SELECT COUNT(*) AS count FROM saved_build_plan_states WHERE user_id = ? AND objective = ?')
        .get(37, 'launch_product').count,
      1,
      'the first valid selection save must create one row'
    );
    const persistedToken = persistedPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const savedForLater = await request(valid, 'POST', '/discovery/build-plan/save-later', { _csrf: persistedToken });
    assert.strictEqual(savedForLater.res.statusCode, 303);
    assert.strictEqual(savedForLater.res.headers.location, '/discovery/build-plan');
    const savedForLaterPage = await request(valid, 'GET', '/discovery/build-plan');
    assert.match(savedForLaterPage.body, /Plan saved\. Resume it anytime from Start an Objective/);
    const afterSaveForLater = JSON.parse((await request(valid, 'GET', '/test/session')).body);
    assert(afterSaveForLater.discoverySession.buildPlanSavedAt);
    assert.strictEqual(afterSaveForLater.credits, 19);
    assert.strictEqual(afterSaveForLater.usageCount, 8);
    const approvalToken = savedForLaterPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];

    const approvalResponse = await request(valid, 'POST', '/discovery/build-plan/approve', { _csrf: approvalToken });
    assert.strictEqual(approvalResponse.res.statusCode, 303);
    assert.strictEqual(approvalResponse.res.headers.location, '/discovery/production-ready');
    const handoff = await request(valid, 'GET', '/discovery/production-ready');
    assert.strictEqual(handoff.res.statusCode, 200);
    assert.match(handoff.body, /Your production plan is ready\./);
    assert.match(handoff.body, /Nothing has been generated yet/);
    assert.match(handoff.body, /Review Cost &amp; Start Production/);
    assert.match(handoff.body, /No usage is consumed until/);
    assert.match(handoff.body, /Ready-to-use output deliverables/);
    assert.match(handoff.body, /<details class="planning-foundation-disclosure">/);
    assert(handoff.body.indexOf('Ready-to-use output deliverables') < handoff.body.indexOf('Free planning foundation documents'));
    assert.doesNotMatch(handoff.body, /Builder-provided offer description|Treat this as unverified context|Inferred primary customer/);

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
