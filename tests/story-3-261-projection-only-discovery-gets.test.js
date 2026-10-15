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
process.env.OPENAI_API_KEY = '';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const { createSensitiveResponseCacheMiddleware } = require('../lib/sensitiveResponseCache');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { DISCOVERY_POLICY_VERSION } = require('../lib/discoveryRequirements');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const {
  createApprovedProductionSet,
  createDefaultSelection,
  planFingerprint,
  updateSelection
} = require('../lib/buildPlanApproval');
const { saveBuildPlan } = require('../lib/savedBuildPlans');
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce(function(result, key) {
    if (value[key] !== undefined) result[key] = canonical(value[key]);
    return result;
  }, {});
}

function serialized(value) {
  return JSON.stringify(canonical(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(serialized(value)).digest('hex');
}

function launchInput() {
  return {
    answers: { initial_description: 'A sanitized capsule product for health-conscious adults.' },
    understanding: {
      businessType: confirmed('physical_product', 'Physical Product'),
      industry: confirmed('health_wellness', 'Health & Wellness'),
      category: confirmed('dietary_supplement', 'Dietary Supplement'),
      intendedOutcome: confirmed('everyday_wellness', 'Everyday wellness'),
      conceptMaturity: confirmed('formula_in_mind', 'Ingredients or formula in mind'),
      existingProductDefinition: confirmed('A builder-defined capsule concept.'),
      targetAudience: confirmed('health_conscious_adults', 'Health-conscious adults'),
      customerMotivation: confirmed('solve_problem', 'It solves a clear problem'),
      salesChannel: confirmed('amazon', 'Amazon'),
      competitiveDifferentiation: confirmed('partial', 'It is different in a few ways'),
      launchStage: confirmed('ready', 'Ready to launch'),
      brand: confirmed('established', 'Established')
    }
  };
}

function policyState(objective, input) {
  const result = analyzeDiscovery({
    objective,
    understanding: input.understanding,
    unknowns: input.unknowns || [],
    answers: input.answers
  });
  return {
    completion: result.completion,
    knowledgeDomains: result.knowledgeDomains,
    nextQuestion: result.nextQuestion,
    reasoning: result.reasoning,
    remainingKnowledgeGaps: result.remainingKnowledgeGaps,
    planningReadiness: result.planningReadiness,
    discoveryCompleteForNow: result.discoveryCompleteForNow,
    discoveryPolicyVersion: DISCOVERY_POLICY_VERSION
  };
}

function partialState() {
  const input = {
    answers: { initial_description: 'A physical product concept.' },
    understanding: { businessType: confirmed('physical_product', 'Physical Product') },
    unknowns: []
  };
  return {
    objective: 'launch_product',
    ...clone(input),
    completedQuestions: ['initial_description'],
    ...policyState('launch_product', input),
    startedAt: '2026-10-13T12:00:00.000Z',
    updatedAt: '2026-10-13T12:01:00.000Z'
  };
}

function strategyState() {
  const input = launchInput();
  const now = '2026-10-13T12:00:00.000Z';
  const strategyResult = buildStrategy({
    objective: 'launch_product',
    understanding: input.understanding,
    confirmedUnderstanding: input.understanding,
    answers: input.answers
  });
  return {
    objective: 'launch_product',
    answers: input.answers,
    understanding: input.understanding,
    unknowns: [],
    completedQuestions: ['initial_description'],
    ...policyState('launch_product', input),
    reflectionStartedAt: now,
    planningConfirmedAt: now,
    confirmedUnderstanding: clone(input.understanding),
    strategyResult,
    strategyUpdatedAt: now,
    startedAt: now,
    updatedAt: now
  };
}

function preparedState() {
  const state = strategyState();
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

function savedSelectionState() {
  const state = preparedState();
  const optional = state.buildPlan.phases.flatMap(phase => phase.deliverables)
    .find(item => !state.buildPlanSelection.selectedDeliverableIds.includes(item.id));
  if (optional) {
    const update = updateSelection({
      plan: state.buildPlan,
      currentSelection: state.buildPlanSelection,
      requestedDeliverableIds: state.buildPlanSelection.selectedDeliverableIds.concat(optional.id)
    });
    assert.strictEqual(update.valid, true);
    state.buildPlanSelection = update.selection;
  }
  state.buildPlanSavedAt = '2026-10-13T12:05:00.000Z';
  return state;
}

function approvedState() {
  const state = savedSelectionState();
  const approval = createApprovedProductionSet({
    plan: state.buildPlan,
    selection: state.buildPlanSelection,
    strategyResult: state.strategyResult,
    confirmedUnderstanding: state.confirmedUnderstanding
  });
  assert.strictEqual(approval.valid, true);
  state.buildPlanSelection.approvedAt = approval.approvedAt;
  state.buildPlanSelection.updatedAt = approval.approvedAt;
  state.approvedProductionSet = approval.productionSet;
  return state;
}

function stalePolicyState() {
  const state = preparedState();
  delete state.understanding.targetAudience;
  state.discoveryPolicyVersion = DISCOVERY_POLICY_VERSION - 1;
  state.planningReadiness = {
    ...state.planningReadiness,
    policyVersion: DISCOVERY_POLICY_VERSION - 1,
    ready: true,
    discoveryCompleteForNow: true
  };
  state.discoveryCompleteForNow = true;
  delete state.reflectionStartedAt;
  return state;
}

function legacyState() {
  const state = preparedState();
  delete state.discoveryPolicyVersion;
  state.planningReadiness = { ready: true, discoveryCompleteForNow: true };
  state.buildPlanSource = 'strategy';
  state.legacyCompatibilityMarker = { nested: [{ preserved: true }] };
  return state;
}

function fixture(name) {
  if (name === 'brand_new') return null;
  if (name === 'partial') return partialState();
  if (name === 'completed') return strategyState();
  if (name === 'stale_policy') return stalePolicyState();
  if (name === 'strategy_prepared') return strategyState();
  if (name === 'build_plan_missing') return strategyState();
  if (name === 'build_plan_prepared') return preparedState();
  if (name === 'saved_selection') return savedSelectionState();
  if (name === 'approved') return approvedState();
  if (name === 'fingerprint_mismatch') {
    const state = approvedState();
    state.approvedProductionSet.planFingerprint = 'mismatched-approved-fingerprint';
    return state;
  }
  if (name === 'malformed_plan') {
    const state = approvedState();
    state.buildPlan.phases = { invalid: true };
    return state;
  }
  if (name === 'unsupported_approval') {
    const state = approvedState();
    state.approvedProductionSet.productionOrder = ['unsupported_deliverable'];
    return state;
  }
  if (name === 'legacy') return legacyState();
  if (name === 'notices') {
    const state = partialState();
    state.answers.initial_description = '<script>alert("stored")</script> A physical product concept.';
    state.productionNotice = '<img src=x onerror=alert("production")>';
    state.buildPlanNotice = '<script>alert("plan")</script>';
    return state;
  }
  if (name === 'approved_notices') {
    const state = approvedState();
    state.productionNotice = '<img src=x onerror=alert("production")>';
    state.buildPlanNotice = '<script>alert("plan")</script>';
    return state;
  }
  throw new Error(`Unknown fixture ${name}`);
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
    }, response => {
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
  return html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1] || '';
}

function databaseSnapshot(db) {
  const tables = [
    'users', 'saved_build_plan_states', 'production_runs', 'production_jobs',
    'generations', 'generation_requests', 'usage_periods', 'usage_events',
    'business_memory_subjects', 'business_memory_records'
  ];
  const snapshot = {};
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    snapshot[table] = { count: rows.length, hash: hash(rows) };
  }
  return snapshot;
}

function assertPrivateNoStore(response) {
  assert.match(response.res.headers['cache-control'] || '', /private/);
  assert.match(response.res.headers['cache-control'] || '', /no-store/);
  assert.strictEqual(response.res.headers.pragma, 'no-cache');
  assert.strictEqual(response.res.headers.expires, '0');
}

async function establish(agent, mode) {
  const authenticated = await request(agent, 'GET', `/test/authenticate/${mode}`);
  assert.strictEqual(authenticated.res.statusCode, 302);
  const state = JSON.parse((await request(agent, 'GET', '/test/workflow')).body);
  assert(state.csrfToken, 'authentication and CSRF state must exist before the baseline');
  return state.workflow;
}

async function storedWorkflow(agent) {
  return JSON.parse((await request(agent, 'GET', '/test/workflow')).body).workflow;
}

async function run() {
  initDb({ logger() {} });
  const db = getDb();
  const userId = 3261;
  db.prepare('INSERT INTO users (id, email, name, builder_goal) VALUES (?, ?, ?, ?)')
    .run(userId, 'story-3-261@example.test', 'Projection-only GET', 'launch_product');
  saveBuildPlan(db, { userId, discoverySession: savedSelectionState(), now: new Date('2026-10-13T12:06:00.000Z') });

  const app = express();
  app.locals.copyquickDb = db;
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-261-session-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:mode', (req, res) => {
    req.session.userId = userId;
    const state = fixture(req.params.mode);
    if (state) req.session.discoverySession = clone(state);
    else delete req.session.discoverySession;
    res.redirect('/discovery');
  });
  app.use((req, res, next) => {
    res.locals.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) || null;
    next();
  });
  app.use(createSensitiveResponseCacheMiddleware());
  app.use(createCsrfProtection());
  app.get('/test/workflow', (req, res) => res.json({
    workflow: req.session.discoverySession || null,
    csrfToken: req.csrfToken()
  }));
  app.use(discoveryRoutes);

  const server = await listen(app);
  try {
    const anonymous = { server, cookie: '' };
    for (const route of ['/discovery', '/discovery/production-ready']) {
      const response = await request(anonymous, 'GET', route);
      assert.strictEqual(response.res.statusCode, 302);
      assert.strictEqual(response.res.headers.location, '/login');
    }
    const anonymousPost = await request(anonymous, 'POST', '/discovery', {
      questionId: 'target_audience',
      choice: 'consumers'
    });
    assert.strictEqual(anonymousPost.res.statusCode, 403);
    assert.strictEqual(await storedWorkflow(anonymous), null);

    const discoveryCases = [
      ['brand_new', 200, null],
      ['partial', 200, null],
      ['completed', 302, '/discovery/reflection'],
      ['stale_policy', 200, null],
      ['strategy_prepared', 302, '/discovery/reflection'],
      ['build_plan_prepared', 302, '/discovery/reflection'],
      ['saved_selection', 302, '/discovery/reflection'],
      ['approved', 302, '/discovery/reflection'],
      ['legacy', 302, '/discovery/reflection'],
      ['notices', 200, null]
    ];
    for (const [mode, status, location] of discoveryCases) {
      const agent = { server, cookie: '' };
      const baseline = await establish(agent, mode);
      const baselineSerialization = serialized(baseline);
      const baselineHash = hash(baseline);
      const databaseBefore = databaseSnapshot(db);
      for (let index = 0; index < 3; index += 1) {
        const response = await request(agent, 'GET', '/discovery');
        assert.strictEqual(response.res.statusCode, status, `${mode} Discovery status`);
        if (location) assert.strictEqual(response.res.headers.location, location, `${mode} Discovery redirect`);
        assertPrivateNoStore(response);
        if (mode === 'brand_new') {
          assert.match(response.body, /What are you building\?/);
          assert.strictEqual(await storedWorkflow(agent), null);
        }
        if (mode === 'partial') {
          const expected = analyzeDiscovery({
            objective: baseline.objective,
            understanding: baseline.understanding,
            unknowns: baseline.unknowns,
            answers: baseline.answers
          }).nextQuestion;
          assert(response.body.includes(expected.prompt), 'partial workflow must render the projected current question');
        }
        if (mode === 'stale_policy') {
          const current = analyzeDiscovery({
            objective: baseline.objective,
            understanding: baseline.understanding,
            unknowns: baseline.unknowns,
            answers: baseline.answers
          });
          assert(response.body.includes(current.nextQuestion.prompt), 'stale state must present current policy');
          assert.doesNotMatch(response.body, /We have a strong foundation/);
        }
        if (mode === 'notices') {
          assert.match(response.body, /&lt;script&gt;alert\(&#34;stored&#34;\)&lt;\/script&gt;/);
          assert.doesNotMatch(response.body, /<script>alert\("stored"\)<\/script>/);
        }
        const after = await storedWorkflow(agent);
        assert.strictEqual(serialized(after), baselineSerialization, `${mode} Discovery serialization changed`);
        assert.strictEqual(hash(after), baselineHash, `${mode} Discovery hash changed`);
        assert.deepStrictEqual(databaseSnapshot(db), databaseBefore, `${mode} Discovery changed database state`);
      }
    }

    const productionReadyCases = [
      ['brand_new', 302, '/discovery/build-plan'],
      ['partial', 302, '/discovery/build-plan'],
      ['completed', 302, '/discovery/build-plan'],
      ['stale_policy', 302, '/discovery/build-plan'],
      ['strategy_prepared', 302, '/discovery/build-plan'],
      ['build_plan_missing', 302, '/discovery/build-plan'],
      ['build_plan_prepared', 302, '/discovery/build-plan'],
      ['saved_selection', 302, '/discovery/build-plan'],
      ['approved', 200, null],
      ['fingerprint_mismatch', 302, '/discovery/build-plan'],
      ['malformed_plan', 302, '/discovery/build-plan'],
      ['unsupported_approval', 302, '/discovery/build-plan'],
      ['legacy', 302, '/discovery/build-plan'],
      ['approved_notices', 200, null]
    ];
    for (const [mode, status, location] of productionReadyCases) {
      const agent = { server, cookie: '' };
      const baseline = await establish(agent, mode);
      const baselineSerialization = serialized(baseline);
      const baselineHash = hash(baseline);
      const databaseBefore = databaseSnapshot(db);
      for (let index = 0; index < 3; index += 1) {
        const response = await request(agent, 'GET', '/discovery/production-ready');
        assert.strictEqual(response.res.statusCode, status, `${mode} Production Ready status`);
        if (location) assert.strictEqual(response.res.headers.location, location, `${mode} Production Ready redirect`);
        assertPrivateNoStore(response);
        if (mode === 'approved' || mode === 'approved_notices') {
          assert.match(response.body, /Your production plan is ready/);
          assert.match(response.body, /Nothing has been generated yet/);
          assert.doesNotMatch(response.body, /<script>alert\("plan"\)<\/script>/);
        }
        const after = await storedWorkflow(agent);
        assert.strictEqual(serialized(after), baselineSerialization, `${mode} Production Ready serialization changed`);
        assert.strictEqual(hash(after), baselineHash, `${mode} Production Ready hash changed`);
        assert.deepStrictEqual(databaseSnapshot(db), databaseBefore, `${mode} Production Ready changed database state`);
      }
    }

    const rejectedAgent = { server, cookie: '' };
    const rejectedBaseline = await establish(rejectedAgent, 'stale_policy');
    const rejectedPage = await request(rejectedAgent, 'GET', '/discovery');
    const rejectedCsrf = hiddenValue(rejectedPage.body, '_csrf');
    const rejected = await request(rejectedAgent, 'POST', '/discovery', {
      _csrf: rejectedCsrf,
      questionId: 'not-the-current-question',
      choice: 'unsure'
    });
    assert.strictEqual(rejected.res.statusCode, 400);
    assert.strictEqual(hash(await storedWorkflow(rejectedAgent)), hash(rejectedBaseline),
      'invalid explicit POST must not accept or partially persist the policy transition');

    const csrfAgent = { server, cookie: '' };
    const csrfBaseline = await establish(csrfAgent, 'stale_policy');
    const csrfPage = await request(csrfAgent, 'GET', '/discovery');
    const csrfQuestion = hiddenValue(csrfPage.body, 'questionId');
    const missingCsrf = await request(csrfAgent, 'POST', '/discovery', {
      questionId: csrfQuestion,
      choice: 'steady_daily_wellness'
    });
    assert.strictEqual(missingCsrf.res.statusCode, 403);
    assert.strictEqual(hash(await storedWorkflow(csrfAgent)), hash(csrfBaseline));

    const malformedAgent = { server, cookie: '' };
    const malformedBaseline = await establish(malformedAgent, 'stale_policy');
    const malformedPage = await request(malformedAgent, 'GET', '/discovery');
    const malformed = await request(malformedAgent, 'POST', '/discovery', {
      _csrf: hiddenValue(malformedPage.body, '_csrf'),
      questionId: hiddenValue(malformedPage.body, 'questionId')
    });
    assert.strictEqual(malformed.res.statusCode, 400);
    assert.strictEqual(hash(await storedWorkflow(malformedAgent)), hash(malformedBaseline),
      'malformed explicit POST must not accept or partially persist the policy transition');

    const transitionAgent = { server, cookie: '' };
    const transitionBaseline = await establish(transitionAgent, 'stale_policy');
    const transitionPage = await request(transitionAgent, 'GET', '/discovery');
    const transitionCsrf = hiddenValue(transitionPage.body, '_csrf');
    const transitionQuestion = hiddenValue(transitionPage.body, 'questionId');
    assert.strictEqual(transitionQuestion, 'target_audience');
    assert.strictEqual(hash(await storedWorkflow(transitionAgent)), hash(transitionBaseline));
    const transitionDatabaseBefore = databaseSnapshot(db);
    const accepted = await request(transitionAgent, 'POST', '/discovery', {
      _csrf: transitionCsrf,
      questionId: transitionQuestion,
      choice: 'consumers'
    });
    assert.strictEqual(accepted.res.statusCode, 303);
    const transitioned = await storedWorkflow(transitionAgent);
    assert.strictEqual(transitioned.discoveryPolicyVersion, DISCOVERY_POLICY_VERSION);
    assert.strictEqual(transitioned.strategyResult, null);
    assert.strictEqual(transitioned.buildPlan, null);
    assert.strictEqual(transitioned.buildPlanSelection, null);
    assert.notStrictEqual(hash(transitioned), hash(transitionBaseline),
      'valid explicit POST must be the point that accepts current policy');
    assert.deepStrictEqual(databaseSnapshot(db), transitionDatabaseBefore,
      'accepting current policy through an answer must not create Production, usage, saved-plan, or memory rows');

    console.log('Story 3.261 projection-only Discovery GET tests passed');
  } finally {
    server.close();
    db.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
