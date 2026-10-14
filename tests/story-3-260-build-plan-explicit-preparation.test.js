const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { assertIsolatedTestDatabase } = require('./helpers/isolatedTestDatabase');

assertIsolatedTestDatabase();
process.env.AI_DISCOVERY_ENABLED = 'false';
process.env.AI_STRATEGY_ENABLED = 'false';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const {
  createApprovedProductionSet,
  createDefaultSelection,
  planFingerprint,
  updateSelection,
  validateSelection
} = require('../lib/buildPlanApproval');
const { validateWorkflowState } = require('../lib/savedBuildPlans');
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function launchInput() {
  const understanding = {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    intendedOutcome: confirmed('everyday_wellness', 'Everyday wellness'),
    conceptMaturity: confirmed('formula_in_mind', 'Ingredients or formula in mind'),
    existingProductDefinition: {
      ...confirmed('A builder-defined capsule concept.'), semanticRole: 'builder_provided_product_context'
    },
    targetAudience: confirmed('health-conscious adults', 'Health-conscious adults'),
    customerMotivation: confirmed('solve_problem', 'It solves a clear problem'),
    salesChannel: confirmed('amazon', 'Amazon'),
    competitiveDifferentiation: confirmed('partial', 'It is different in a few ways'),
    launchStage: confirmed('ready', 'Ready to launch'),
    brand: confirmed('established', 'Established')
  };
  return { understanding, answers: { initial_description: 'A sanitized wellness product fixture.' } };
}

function saasInput() {
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
    initial_description: 'Project-management SaaS for small professional-services teams with a self-service trial.',
    conversion_traffic: 'unsure', conversion_page: 'unsure',
    conversion_evidence: 'unsure', conversion_friction: 'unsure'
  };
  return { understanding, answers };
}

function strategyState(kind = 'launch') {
  const objective = kind === 'saas' ? 'increase_conversion_rates' : 'launch_product';
  const input = kind === 'saas' ? saasInput() : launchInput();
  const planningReadiness = analyzeDiscovery({
    objective, understanding: input.understanding, unknowns: [], answers: input.answers
  }).planningReadiness;
  const now = '2026-10-13T12:00:00.000Z';
  const strategyResult = buildStrategy({
    objective,
    understanding: input.understanding,
    confirmedUnderstanding: input.understanding,
    answers: input.answers
  });
  return {
    objective,
    answers: input.answers,
    understanding: input.understanding,
    unknowns: [],
    planningReadiness,
    discoveryPolicyVersion: planningReadiness.policyVersion,
    discoveryCompleteForNow: true,
    reflectionStartedAt: now,
    planningConfirmedAt: now,
    confirmedUnderstanding: input.understanding,
    strategyResult,
    strategyUpdatedAt: now,
    startedAt: now,
    updatedAt: now
  };
}

function preparedState(kind = 'launch') {
  const state = strategyState(kind);
  const plan = buildPlan({
    objective: state.objective,
    confirmedUnderstanding: state.confirmedUnderstanding,
    strategyResult: state.strategyResult,
    answers: state.answers
  });
  state.buildPlan = plan;
  state.buildPlanUpdatedAt = state.strategyUpdatedAt;
  state.buildPlanSource = {
    planningConfirmedAt: state.planningConfirmedAt,
    strategyUpdatedAt: state.strategyUpdatedAt
  };
  state.buildPlanFingerprint = planFingerprint(plan);
  state.buildPlanSelection = createDefaultSelection(plan);
  return state;
}

function fixture(mode) {
  if (mode === 'missing') return strategyState();
  if (mode === 'planning_missing') return strategyState('saas');
  if (mode === 'planning_only') return preparedState('saas');
  if (mode === 'missing_strategy') {
    const state = strategyState();
    delete state.strategyResult;
    delete state.strategyUpdatedAt;
    return state;
  }
  const state = preparedState();
  if (mode === 'selection_saved') {
    const requested = state.buildPlanSelection.selectedDeliverableIds.concat('amazon_a_plus');
    state.buildPlanSelection = updateSelection({
      plan: state.buildPlan,
      currentSelection: state.buildPlanSelection,
      requestedDeliverableIds: requested
    }).selection;
    state.buildPlanSavedAt = '2026-10-13T12:00:00.000Z';
  }
  if (mode === 'approved') {
    state.buildPlanSelection = updateSelection({
      plan: state.buildPlan,
      currentSelection: state.buildPlanSelection,
      requestedDeliverableIds: state.buildPlanSelection.selectedDeliverableIds.concat('amazon_a_plus')
    }).selection;
    const approved = createApprovedProductionSet({
      plan: state.buildPlan,
      selection: state.buildPlanSelection,
      strategyResult: state.strategyResult,
      confirmedUnderstanding: state.confirmedUnderstanding
    });
    state.buildPlanSelection.approvedAt = approved.approvedAt;
    state.buildPlanSelection.updatedAt = approved.approvedAt;
    state.approvedProductionSet = approved.productionSet;
  }
  if (mode === 'resumed') {
    state.buildPlanNotice = 'Saved plan resumed safely.';
    state.buildPlanSavedAt = '2026-10-13T12:00:00.000Z';
  }
  if (mode === 'notices') {
    state.buildPlanNotice = '<img src=x onerror=alert(1)> Saved notice';
    state.productionNotice = '<script>alert(2)</script> Production notice';
  }
  if (mode === 'stale_policy') {
    state.discoveryPolicyVersion = 1;
    state.strategyResult.policyVersion = 1;
  }
  if (mode === 'tampered_fingerprint') state.buildPlanFingerprint = 'tampered';
  if (mode === 'tampered_selection') state.buildPlanSelection.selectedDeliverableIds.push('unknown-deliverable');
  if (mode === 'legacy_source') state.buildPlanSource = 'strategy';
  return state;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce(function(result, key) {
    result[key] = canonical(value[key]);
    return result;
  }, {});
}

function workflowHash(state) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
}

function reverseObjectOrder(value) {
  if (Array.isArray(value)) return value.map(reverseObjectOrder);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).reverse().reduce(function(result, key) {
    result[key] = reverseObjectOrder(value[key]);
    return result;
  }, {});
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function request(agent, method, url, form = null) {
  return new Promise((resolve, reject) => {
    const parameters = new URLSearchParams();
    Object.entries(form || {}).forEach(function([key, value]) {
      (Array.isArray(value) ? value : [value]).forEach(item => parameters.append(key, item));
    });
    const payload = parameters.toString();
    const headers = {};
    if (agent.cookie) headers.Cookie = agent.cookie;
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const outgoing = http.request({
      hostname: '127.0.0.1', port: agent.server.address().port, method, path: url, headers
    }, (response) => {
      if (response.headers['set-cookie']) {
        agent.cookie = response.headers['set-cookie'].map(item => item.split(';')[0]).join('; ');
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ res: response, body }));
    });
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
}

function hiddenValue(html, name) {
  const value = html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  assert(value, `${name} must be present`);
  return value;
}

async function authenticate(agent, mode) {
  const response = await request(agent, 'GET', `/test/authenticate/${mode}`);
  assert.strictEqual(response.res.statusCode, 302);
}

async function storedWorkflow(agent) {
  return JSON.parse((await request(agent, 'GET', '/test/session')).body).discoverySession;
}

async function strategyForm(agent) {
  const page = await request(agent, 'GET', '/discovery/strategy');
  return {
    page,
    csrf: hiddenValue(page.body, '_csrf'),
    preparationToken: hiddenValue(page.body, 'strategyPreparationToken')
  };
}

function sideEffects(db, userId) {
  const count = (table, where = 'user_id = ?') => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(userId).count;
  return {
    savedPlans: count('saved_build_plan_states'),
    runs: count('production_runs'),
    jobs: count('production_jobs', 'production_run_id IN (SELECT id FROM production_runs WHERE user_id = ?)'),
    generations: count('generations'),
    requests: count('generation_requests'),
    usageEvents: count('usage_events'),
    memory: count('business_memory_records'),
    used: db.prepare('SELECT generations_used FROM users WHERE id = ?').get(userId).generations_used
  };
}

async function run() {
  initDb();
  const db = getDb();
  const userId = 3260;
  db.prepare('INSERT INTO users (id, email, name, builder_goal) VALUES (?, ?, ?, ?)')
    .run(userId, 'story-3-260@example.com', 'Explicit Build Plan', 'launch_product');

  const app = express();
  app.locals.copyquickDb = db;
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-260-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:mode', (req, res) => {
    req.session.userId = userId;
    req.session.discoverySession = fixture(req.params.mode);
    res.redirect('/discovery/strategy');
  });
  app.get('/test/advance-strategy', (req, res) => {
    const state = req.session.discoverySession;
    state.strategyResult = JSON.parse(JSON.stringify(state.strategyResult));
    state.strategyResult.strategy.communicationStyle.value = 'A newer plain-language direction';
    state.strategyUpdatedAt = new Date(Date.parse(state.strategyUpdatedAt) + 60000).toISOString();
    const plan = buildPlan({
      objective: state.objective,
      confirmedUnderstanding: state.confirmedUnderstanding,
      strategyResult: state.strategyResult,
      answers: state.answers
    });
    state.buildPlan = plan;
    state.buildPlanUpdatedAt = state.strategyUpdatedAt;
    state.buildPlanSource = {
      planningConfirmedAt: state.planningConfirmedAt,
      strategyUpdatedAt: state.strategyUpdatedAt
    };
    state.buildPlanFingerprint = planFingerprint(plan);
    state.buildPlanSelection = createDefaultSelection(plan);
    const approved = createApprovedProductionSet({
      plan,
      selection: state.buildPlanSelection,
      strategyResult: state.strategyResult,
      confirmedUnderstanding: state.confirmedUnderstanding
    });
    state.buildPlanSelection.approvedAt = approved.approvedAt;
    state.buildPlanSelection.updatedAt = approved.approvedAt;
    state.approvedProductionSet = approved.productionSet;
    res.sendStatus(204);
  });
  app.get('/test/change-strategy-only', (req, res) => {
    const state = req.session.discoverySession;
    state.strategyResult = JSON.parse(JSON.stringify(state.strategyResult));
    state.strategyResult.strategy.communicationStyle.value = 'A genuinely updated direct direction';
    state.strategyUpdatedAt = new Date(Date.parse(state.strategyUpdatedAt) + 120000).toISOString();
    res.sendStatus(204);
  });
  app.get('/test/reorder-strategy-source', (req, res) => {
    const state = req.session.discoverySession;
    state.answers = reverseObjectOrder(state.answers);
    state.confirmedUnderstanding = reverseObjectOrder(state.confirmedUnderstanding);
    state.strategyResult = reverseObjectOrder(state.strategyResult);
    res.sendStatus(204);
  });
  app.get('/test/invalidate-strategy-policy', (req, res) => {
    req.session.discoverySession.strategyResult.policyVersion = 1;
    res.sendStatus(204);
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json({ ...req.session, testCsrfToken: req.csrfToken() }));
  app.use(discoveryRoutes);

  const server = await listen(app);
  try {
    const hashCases = [
      ['missing', 302, '/discovery/strategy'],
      ['valid', 200, null],
      ['planning_only', 200, null],
      ['selection_saved', 200, null],
      ['approved', 200, null],
      ['resumed', 200, null],
      ['notices', 200, null],
      ['stale_policy', 302, '/discovery/reflection'],
      ['tampered_fingerprint', 302, '/discovery/strategy'],
      ['tampered_selection', 302, '/discovery/strategy'],
      ['legacy_source', 302, '/discovery/strategy']
    ];
    for (const [mode, status, location] of hashCases) {
      const agent = { server, cookie: '' };
      await authenticate(agent, mode);
      const before = workflowHash(await storedWorkflow(agent));
      const databaseBefore = sideEffects(db, userId);
      for (let index = 0; index < 3; index += 1) {
        const response = await request(agent, 'GET', '/discovery/build-plan');
        assert.strictEqual(response.res.statusCode, status, `${mode} GET status`);
        if (location) assert.strictEqual(response.res.headers.location, location, `${mode} redirect`);
        if (mode === 'notices') {
          assert.match(response.body, /&lt;img src=x onerror=alert\(1\)&gt; Saved notice/);
          assert.match(response.body, /&lt;script&gt;alert\(2\)&lt;\/script&gt; Production notice/);
          assert.doesNotMatch(response.body, /<script>alert\(2\)<\/script>/);
        }
        assert.strictEqual(workflowHash(await storedWorkflow(agent)), before, `${mode} GET mutated workflow state`);
        assert.deepStrictEqual(sideEffects(db, userId), databaseBefore, `${mode} GET mutated database state`);
      }
    }

    const missingCsrfAgent = { server, cookie: '' };
    await authenticate(missingCsrfAgent, 'missing');
    const missingCsrfForm = await strategyForm(missingCsrfAgent);
    const missingCsrfHash = workflowHash(await storedWorkflow(missingCsrfAgent));
    const missingCsrf = await request(missingCsrfAgent, 'POST', '/discovery/build-plan/prepare', {
      strategyPreparationToken: missingCsrfForm.preparationToken
    });
    assert.strictEqual(missingCsrf.res.statusCode, 403);
    assert.strictEqual(workflowHash(await storedWorkflow(missingCsrfAgent)), missingCsrfHash);

    const invalidTokenAgent = { server, cookie: '' };
    await authenticate(invalidTokenAgent, 'missing');
    const invalidTokenForm = await strategyForm(invalidTokenAgent);
    const invalidTokenHash = workflowHash(await storedWorkflow(invalidTokenAgent));
    for (const invalidToken of ['', 'not-a-token', [invalidTokenForm.preparationToken, invalidTokenForm.preparationToken]]) {
      const invalidTokenResponse = await request(invalidTokenAgent, 'POST', '/discovery/build-plan/prepare', {
        _csrf: invalidTokenForm.csrf,
        strategyPreparationToken: invalidToken
      });
      assert.strictEqual(invalidTokenResponse.res.statusCode, 409);
      assert.match(invalidTokenResponse.body, /Strategy changed in another step/);
      assert.strictEqual(workflowHash(await storedWorkflow(invalidTokenAgent)), invalidTokenHash);
    }

    const orderingAgent = { server, cookie: '' };
    await authenticate(orderingAgent, 'missing');
    const beforeReorder = await strategyForm(orderingAgent);
    await request(orderingAgent, 'GET', '/test/reorder-strategy-source');
    const afterReorder = await strategyForm(orderingAgent);
    assert.strictEqual(afterReorder.preparationToken, beforeReorder.preparationToken,
      'irrelevant object-key ordering must not alter the Strategy token');

    const otherSessionAgent = { server, cookie: '' };
    await authenticate(otherSessionAgent, 'missing');
    const otherSessionForm = await strategyForm(otherSessionAgent);
    assert.notStrictEqual(otherSessionForm.preparationToken, invalidTokenForm.preparationToken,
      'identical Strategy state in another session must have a different token');
    const otherSessionBefore = workflowHash(await storedWorkflow(otherSessionAgent));
    const crossSessionSubmit = await request(otherSessionAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: otherSessionForm.csrf,
      strategyPreparationToken: invalidTokenForm.preparationToken
    });
    assert.strictEqual(crossSessionSubmit.res.statusCode, 409);
    assert.strictEqual(workflowHash(await storedWorkflow(otherSessionAgent)), otherSessionBefore);

    const policyAgent = { server, cookie: '' };
    await authenticate(policyAgent, 'valid');
    const policyForm = await strategyForm(policyAgent);
    await request(policyAgent, 'GET', '/test/invalidate-strategy-policy');
    const policySubmit = await request(policyAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: policyForm.csrf,
      strategyPreparationToken: policyForm.preparationToken
    });
    assert.strictEqual(policySubmit.res.statusCode, 302);
    assert.strictEqual(policySubmit.res.headers.location, '/discovery/reflection');
    const invalidatedPolicyState = await storedWorkflow(policyAgent);
    for (const key of [
      'strategyResult', 'strategyUpdatedAt', 'buildPlan', 'buildPlanUpdatedAt',
      'buildPlanSource', 'buildPlanFingerprint', 'buildPlanSelection'
    ]) assert.strictEqual(invalidatedPolicyState[key], null, `${key} must clear as one policy transition`);

    const prepareAgent = { server, cookie: '' };
    await authenticate(prepareAgent, 'missing');
    const form = await strategyForm(prepareAgent);
    assert.match(form.page.body, /form action="\/discovery\/build-plan\/prepare" method="POST"/);
    const effectsBefore = sideEffects(db, userId);
    const prepared = await request(prepareAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: form.csrf,
      strategyPreparationToken: form.preparationToken
    });
    assert.strictEqual(prepared.res.statusCode, 303);
    assert.strictEqual(prepared.res.headers.location, '/discovery/build-plan');
    const firstState = await storedWorkflow(prepareAgent);
    assert.strictEqual(firstState.buildPlanSource.planningConfirmedAt, firstState.planningConfirmedAt);
    assert.strictEqual(firstState.buildPlanSource.strategyUpdatedAt, firstState.strategyUpdatedAt);
    assert.strictEqual(firstState.buildPlanFingerprint, planFingerprint(firstState.buildPlan));
    assert.strictEqual(validateWorkflowState(firstState, firstState.buildPlanFingerprint), true);
    assert.strictEqual(validateSelection(firstState.buildPlan, firstState.buildPlanSelection).valid, true);
    const firstHash = workflowHash(firstState);
    const repeated = await request(prepareAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: form.csrf,
      strategyPreparationToken: form.preparationToken
    });
    assert.strictEqual(repeated.res.statusCode, 303);
    assert.strictEqual(workflowHash(await storedWorkflow(prepareAgent)), firstHash);
    assert.deepStrictEqual(sideEffects(db, userId), effectsBefore);

    const planningAgent = { server, cookie: '' };
    await authenticate(planningAgent, 'planning_missing');
    const planningForm = await strategyForm(planningAgent);
    const planningPrepared = await request(planningAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: planningForm.csrf,
      strategyPreparationToken: planningForm.preparationToken
    });
    assert.strictEqual(planningPrepared.res.statusCode, 303);
    const planningPage = await request(planningAgent, 'GET', '/discovery/build-plan');
    assert.strictEqual(planningPage.res.statusCode, 200);
    const planningTitles = fixture('planning_only').buildPlan.phases
      .flatMap(phase => phase.deliverables).map(item => item.title);
    assert.deepStrictEqual(planningTitles, [
      'Conversion Diagnostic Brief',
      'Trial-Signup Conversion Brief',
      'Conversion Measurement Plan'
    ]);
    assert.strictEqual((await storedWorkflow(planningAgent)).objective, 'increase_conversion_rates');

    const approvedAgent = { server, cookie: '' };
    await authenticate(approvedAgent, 'approved');
    const approvedForm = await strategyForm(approvedAgent);
    const approvedBefore = await storedWorkflow(approvedAgent);
    const approvedHash = workflowHash(approvedBefore);
    const repeatApproved = await request(approvedAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: approvedForm.csrf,
      strategyPreparationToken: approvedForm.preparationToken
    });
    assert.strictEqual(repeatApproved.res.statusCode, 303);
    const approvedAfter = await storedWorkflow(approvedAgent);
    assert.strictEqual(workflowHash(approvedAfter), approvedHash);
    assert.deepStrictEqual(approvedAfter.buildPlanSelection, approvedBefore.buildPlanSelection);
    assert.deepStrictEqual(approvedAfter.approvedProductionSet, approvedBefore.approvedProductionSet);

    const staleAgent = { server, cookie: '' };
    await authenticate(staleAgent, 'valid');
    const tabA = await strategyForm(staleAgent);
    await request(staleAgent, 'GET', '/test/advance-strategy');
    const afterTabB = workflowHash(await storedWorkflow(staleAgent));
    const staleSubmit = await request(staleAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: tabA.csrf,
      strategyPreparationToken: tabA.preparationToken
    });
    assert.strictEqual(staleSubmit.res.statusCode, 409);
    assert.match(staleSubmit.body, /Strategy changed in another step/);
    assert.strictEqual(workflowHash(await storedWorkflow(staleAgent)), afterTabB);

    const changedAgent = { server, cookie: '' };
    await authenticate(changedAgent, 'approved');
    const oldChangedState = await storedWorkflow(changedAgent);
    await request(changedAgent, 'GET', '/test/change-strategy-only');
    const changedForm = await strategyForm(changedAgent);
    const changedPrepare = await request(changedAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: changedForm.csrf,
      strategyPreparationToken: changedForm.preparationToken
    });
    assert.strictEqual(changedPrepare.res.statusCode, 303);
    const newChangedState = await storedWorkflow(changedAgent);
    assert.notStrictEqual(newChangedState.buildPlanFingerprint, oldChangedState.buildPlanFingerprint);
    assert.strictEqual(newChangedState.approvedProductionSet, null);
    assert.strictEqual(newChangedState.buildPlanSource.strategyUpdatedAt, newChangedState.strategyUpdatedAt);
    assert.strictEqual(validateWorkflowState(newChangedState, newChangedState.buildPlanFingerprint), true);

    const fallbackAgent = { server, cookie: '' };
    await authenticate(fallbackAgent, 'missing_strategy');
    const fallbackPage = await request(fallbackAgent, 'GET', '/discovery/strategy');
    assert.strictEqual(fallbackPage.res.statusCode, 200);
    assert.doesNotMatch(fallbackPage.body, /action="\/discovery\/build-plan\/prepare"/);
    const fallbackSession = JSON.parse((await request(fallbackAgent, 'GET', '/test/session')).body);
    const fallbackPost = await request(fallbackAgent, 'POST', '/discovery/build-plan/prepare', {
      _csrf: fallbackSession.testCsrfToken,
      strategyPreparationToken: 'presentation-only'
    });
    assert.strictEqual(fallbackPost.res.statusCode, 302);
    assert.strictEqual(fallbackPost.res.headers.location, '/discovery/reflection');

    console.log('Story 3.260 explicit Build Plan preparation and immutable GET tests passed');
  } finally {
    server.close();
    db.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
