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
const { STRATEGY_POLICY_VERSION, buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const {
  createApprovedProductionSet,
  createDefaultSelection,
  planFingerprint
} = require('../lib/buildPlanApproval');
const { saveBuildPlan } = require('../lib/savedBuildPlans');
const strategySynthesisPath = require.resolve('../lib/aiStrategySynthesis');
const strategySynthesis = require(strategySynthesisPath);
let synthesisFailureMode = null;
require.cache[strategySynthesisPath].exports = {
  ...strategySynthesis,
  async buildStrategyWithAI(input) {
    if (synthesisFailureMode === 'throw') throw new Error('simulated strategy preparation failure');
    if (synthesisFailureMode === 'malformed') return { policyVersion: STRATEGY_POLICY_VERSION };
    return strategySynthesis.buildStrategyWithAI(input);
  }
};
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function unsure(label = "I'm not sure yet") {
  return { value: 'unsure', label, confidence: 1, source: 'user_confirmed' };
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

function policy(objective, input) {
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

function saasInput() {
  return {
    answers: {
      initial_description: 'B2B project-management software for small professional-services teams with self-service trial signup.',
      conversion_traffic: 'unsure',
      conversion_page: 'unsure',
      conversion_evidence: 'unsure',
      conversion_friction: 'unsure'
    },
    understanding: {
      businessType: confirmed('software', 'Software / SaaS'),
      industry: confirmed('technology', 'Technology'),
      currentOffer: confirmed('project_management_software', 'Project management software'),
      targetAudience: confirmed('small_professional_services_teams', 'Small professional-services teams'),
      funnelType: confirmed('trial_signup', 'Start a trial or account'),
      primaryCta: confirmed('start_free_trial', 'Start a free trial'),
      trafficSource: unsure(),
      pageExperience: unsure(),
      conversionEvidence: unsure(),
      conversionFriction: unsure()
    },
    unknowns: ['trafficSource', 'pageExperience', 'conversionEvidence', 'conversionFriction']
  };
}

function partialState() {
  const input = {
    answers: { initial_description: 'A software idea.' },
    understanding: { businessType: confirmed('software', 'Software / SaaS') },
    unknowns: []
  };
  return {
    objective: 'increase_conversion_rates',
    ...clone(input),
    completedQuestions: ['initial_description'],
    ...policy('increase_conversion_rates', input),
    reflectionStartedAt: '2026-10-14T12:00:00.000Z',
    startedAt: '2026-10-14T12:00:00.000Z',
    updatedAt: '2026-10-14T12:01:00.000Z'
  };
}

function saasStrategyState() {
  const input = saasInput();
  const now = '2026-10-14T12:00:00.000Z';
  const readiness = policy('increase_conversion_rates', input);
  assert.strictEqual(readiness.planningReadiness.ready, true, 'SaaS fixture must be planning-ready');
  const strategyResult = buildStrategy({
    objective: 'increase_conversion_rates',
    understanding: input.understanding,
    answers: input.answers,
    confirmedUnderstanding: input.understanding
  });
  return {
    objective: 'increase_conversion_rates',
    ...clone(input),
    completedQuestions: Object.keys(input.answers),
    ...readiness,
    reflectionStartedAt: now,
    planningConfirmedAt: now,
    confirmedUnderstanding: clone(input.understanding),
    strategyResult,
    strategyUpdatedAt: now,
    startedAt: now,
    updatedAt: now,
    nestedIsolationMarker: { arrays: [{ value: 'preserve-me' }] }
  };
}

function unpreparedState() {
  const state = saasStrategyState();
  delete state.strategyResult;
  delete state.strategyUpdatedAt;
  return state;
}

function planState({ selection = false, saved = false } = {}) {
  const state = saasStrategyState();
  const plan = buildPlan({
    objective: state.objective,
    confirmedUnderstanding: state.confirmedUnderstanding,
    strategyResult: state.strategyResult,
    answers: state.answers
  });
  assert.strictEqual(plan.readiness.ready, true);
  assert.deepStrictEqual(plan.phases.flatMap(phase => phase.deliverables).map(item => item.title), [
    'Conversion Diagnostic Brief',
    'Trial-Signup Conversion Brief',
    'Conversion Measurement Plan'
  ]);
  state.buildPlan = plan;
  state.buildPlanUpdatedAt = state.strategyUpdatedAt;
  state.buildPlanSource = {
    planningConfirmedAt: state.planningConfirmedAt,
    strategyUpdatedAt: state.strategyUpdatedAt
  };
  state.buildPlanFingerprint = planFingerprint(plan);
  if (selection || saved) {
    state.buildPlanSelection = createDefaultSelection(plan);
    state.buildPlanSelection.updatedAt = '2026-10-14T12:04:00.000Z';
  }
  if (saved) state.buildPlanSavedAt = '2026-10-14T12:05:00.000Z';
  return state;
}

function executableApprovedState() {
  const input = {
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
    },
    unknowns: []
  };
  const now = '2026-10-14T11:00:00.000Z';
  const state = {
    objective: 'launch_product',
    ...clone(input),
    completedQuestions: ['initial_description'],
    ...policy('launch_product', input),
    reflectionStartedAt: now,
    planningConfirmedAt: now,
    confirmedUnderstanding: clone(input.understanding),
    startedAt: now,
    updatedAt: now
  };
  state.strategyResult = buildStrategy({
    objective: state.objective,
    understanding: state.understanding,
    confirmedUnderstanding: state.confirmedUnderstanding,
    answers: state.answers
  });
  state.strategyUpdatedAt = now;
  state.buildPlan = buildPlan({
    objective: state.objective,
    confirmedUnderstanding: state.confirmedUnderstanding,
    strategyResult: state.strategyResult,
    answers: state.answers
  });
  state.buildPlanUpdatedAt = now;
  state.buildPlanSource = { planningConfirmedAt: now, strategyUpdatedAt: now };
  state.buildPlanFingerprint = planFingerprint(state.buildPlan);
  state.buildPlanSelection = createDefaultSelection(state.buildPlan);
  state.buildPlanSelection.updatedAt = '2026-10-14T11:01:00.000Z';
  const approval = createApprovedProductionSet({
    plan: state.buildPlan,
    selection: state.buildPlanSelection,
    strategyResult: state.strategyResult,
    confirmedUnderstanding: state.confirmedUnderstanding
  });
  assert.strictEqual(approval.valid, true);
  state.approvedProductionSet = approval.productionSet;
  state.approvedProductionSet.approvedAt = '2026-10-14T11:02:00.000Z';
  return state;
}

function fixture(name) {
  if (name === 'brand_new') return null;
  if (name === 'partial') return partialState();
  if (name === 'complete_unprepared') return unpreparedState();
  if (name === 'prepared') return saasStrategyState();
  if (name === 'stale_policy') {
    const state = saasStrategyState();
    state.discoveryPolicyVersion = DISCOVERY_POLICY_VERSION - 1;
    state.planningReadiness.policyVersion = DISCOVERY_POLICY_VERSION - 1;
    return state;
  }
  if (name === 'stale_strategy') {
    const state = saasStrategyState();
    state.strategyResult.policyVersion = STRATEGY_POLICY_VERSION - 1;
    return state;
  }
  if (name === 'inconsistent_understanding') {
    const state = saasStrategyState();
    state.understanding.targetAudience = confirmed('enterprise_teams', 'Enterprise teams');
    return state;
  }
  if (name === 'build_plan_prepared') return planState();
  if (name === 'selection_initialized') return planState({ selection: true });
  if (name === 'saved_planning_only') return planState({ selection: true, saved: true });
  if (name === 'approved') return executableApprovedState();
  if (name === 'approved_changed_understanding') {
    const state = executableApprovedState();
    state.understanding.targetAudience = confirmed('specialty_retail_buyers', 'Specialty retail buyers');
    return state;
  }
  if (name === 'notice') {
    const state = saasStrategyState();
    state.productionNotice = '<img src=x onerror=alert("strategy-notice")> Please review the plan.';
    return state;
  }
  if (name === 'legacy') {
    const state = saasStrategyState();
    delete state.strategyResult.policyVersion;
    state.legacyCompatibilityMarker = { nested: [{ preserved: true }] };
    return state;
  }
  if (name === 'malformed') {
    const state = saasStrategyState();
    state.strategyResult.strategy.primaryCustomer = { value: 'Missing presentation fields' };
    return state;
  }
  if (name === 'inconsistent_timestamp') {
    const state = saasStrategyState();
    state.strategyUpdatedAt = '2026-10-14T11:59:59.000Z';
    return state;
  }
  throw new Error(`Unknown fixture ${name}`);
}

function databaseSnapshot(db) {
  const tables = [
    'users', 'saved_build_plan_states', 'production_runs', 'production_jobs',
    'production_job_events', 'generations', 'generation_requests', 'usage_periods',
    'usage_events', 'business_memory_subjects', 'business_memory_records'
  ];
  return Object.fromEntries(tables.map(function(table) {
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    return [table, { count: rows.length, hash: hash(rows) }];
  }));
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

function assertPrivateNoStore(response) {
  assert.match(response.res.headers['cache-control'] || '', /private/);
  assert.match(response.res.headers['cache-control'] || '', /no-store/);
  assert.strictEqual(response.res.headers.pragma, 'no-cache');
  assert.strictEqual(response.res.headers.expires, '0');
}

async function storedWorkflow(agent) {
  return JSON.parse((await request(agent, 'GET', '/test/workflow')).body).workflow;
}

async function establish(agent, name) {
  const response = await request(agent, 'GET', `/test/authenticate/${name}`);
  assert.strictEqual(response.res.statusCode, 302);
  return storedWorkflow(agent);
}

async function run() {
  initDb({ logger() {} });
  const db = getDb();
  const userId = 3262;
  db.prepare('INSERT INTO users (id, email, name, builder_goal) VALUES (?, ?, ?, ?)')
    .run(userId, 'story-3-262@example.test', 'Read-only Strategy', 'increase_conversion_rates');
  saveBuildPlan(db, {
    userId,
    discoverySession: planState({ selection: true, saved: true }),
    now: new Date('2026-10-14T12:06:00.000Z')
  });

  const app = express();
  app.locals.copyquickDb = db;
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-262-session-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    res.locals.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) || null;
    next();
  });
  app.use(createSensitiveResponseCacheMiddleware());
  app.use(createCsrfProtection());
  app.get('/test/authenticate/:mode', (req, res) => {
    req.session.userId = userId;
    const state = fixture(req.params.mode);
    if (state) req.session.discoverySession = clone(state);
    else delete req.session.discoverySession;
    res.redirect('/discovery/strategy');
  });
  app.get('/test/workflow', (req, res) => res.json({
    workflow: req.session.discoverySession || null,
    csrfToken: req.csrfToken()
  }));
  app.use(discoveryRoutes);

  const server = await listen(app);
  try {
    const anonymous = { server, cookie: '' };
    const denied = await request(anonymous, 'GET', '/discovery/strategy');
    assert.strictEqual(denied.res.statusCode, 302);
    assert.strictEqual(denied.res.headers.location, '/login');

    const cases = [
      ['brand_new', 302, '/discovery/reflection'],
      ['partial', 302, '/discovery/reflection'],
      ['complete_unprepared', 302, '/discovery/reflection'],
      ['prepared', 200, null],
      ['stale_policy', 200, null],
      ['stale_strategy', 302, '/discovery/reflection'],
      ['inconsistent_understanding', 302, '/discovery/reflection'],
      ['build_plan_prepared', 200, null],
      ['selection_initialized', 200, null],
      ['saved_planning_only', 200, null],
      ['approved', 200, null],
      ['notice', 200, null],
      ['legacy', 302, '/discovery/reflection'],
      ['malformed', 302, '/discovery/reflection'],
      ['inconsistent_timestamp', 302, '/discovery/reflection']
    ];
    const matrixHashes = {};
    for (const [name, status, location] of cases) {
      const agent = { server, cookie: '' };
      const baseline = await establish(agent, name);
      const baselineSerialized = serialized(baseline);
      const baselineHash = hash(baseline);
      const databaseBefore = databaseSnapshot(db);
      for (let index = 0; index < 3; index += 1) {
        const response = await request(agent, 'GET', '/discovery/strategy');
        assert.strictEqual(response.res.statusCode, status, `${name} Strategy status`);
        if (location) assert.strictEqual(response.res.headers.location, location, `${name} Strategy redirect`);
        assertPrivateNoStore(response);
        if (status === 200) {
          assert.match(response.body, /Recommended Business Strategy/);
          assert.match(response.body, /Continue to Build Plan/);
        }
        if (name === 'complete_unprepared') {
          assert.doesNotMatch(response.body, /Recommended Business Strategy/,
            'an unprepared Strategy must not be presented from an ephemeral fallback');
        }
        if (name === 'stale_policy') {
          assert.match(response.body, /Recommended Business Strategy/,
            'current policy may be projected for a canonical prepared Strategy');
        }
        if (name === 'notice') {
          assert.match(response.body, /&lt;img src=x onerror=alert\(&#34;strategy-notice&#34;\)&gt; Please review the plan\./);
          assert.doesNotMatch(response.body, /<img src=x/);
        }
        const after = await storedWorkflow(agent);
        assert.strictEqual(serialized(after), baselineSerialized, `${name} serialization changed on GET ${index + 1}`);
        assert.strictEqual(hash(after), baselineHash, `${name} hash changed on GET ${index + 1}`);
        assert.deepStrictEqual(databaseSnapshot(db), databaseBefore, `${name} changed database rows on GET ${index + 1}`);
      }
      matrixHashes[name] = baselineHash;
    }
    assert.strictEqual(matrixHashes.brand_new, hash(null), 'brand-new GET must not create a workflow');

    const navigationAgent = { server, cookie: '' };
    const navigationBaseline = await establish(navigationAgent, 'prepared');
    const navigationDatabase = databaseSnapshot(db);
    for (const route of ['/discovery/strategy', '/discovery/reflection', '/discovery/strategy']) {
      const response = await request(navigationAgent, 'GET', route);
      assert.strictEqual(response.res.statusCode, 200);
    }
    assert.strictEqual(hash(await storedWorkflow(navigationAgent)), hash(navigationBaseline));
    assert.deepStrictEqual(databaseSnapshot(db), navigationDatabase);

    const preparedAgent = { server, cookie: '' };
    const unpreparedBaseline = await establish(preparedAgent, 'complete_unprepared');
    const reflection = await request(preparedAgent, 'GET', '/discovery/reflection');
    assert.strictEqual(reflection.res.statusCode, 200);
    const csrf = hiddenValue(reflection.body, '_csrf');
    assert(csrf);
    const databaseBeforePreparation = databaseSnapshot(db);
    const preparation = await request(preparedAgent, 'POST', '/discovery/reflection/plan', { _csrf: csrf });
    assert.strictEqual(preparation.res.statusCode, 303);
    assert.strictEqual(preparation.res.headers.location, '/discovery/strategy');
    const prepared = await storedWorkflow(preparedAgent);
    assert(prepared.strategyResult);
    assert(prepared.strategyUpdatedAt);
    assert.notStrictEqual(hash(prepared), hash(unpreparedBaseline));
    assert.deepStrictEqual(databaseSnapshot(db), databaseBeforePreparation,
      'Strategy preparation must not create saved plans, Production, usage, or memory rows');

    const preparedHash = hash(prepared);
    const replay = await request(preparedAgent, 'POST', '/discovery/reflection/plan', { _csrf: csrf });
    assert.strictEqual(replay.res.statusCode, 303);
    assert.strictEqual(hash(await storedWorkflow(preparedAgent)), preparedHash,
      'identical explicit preparation replay must be idempotent');
    assert.deepStrictEqual(databaseSnapshot(db), databaseBeforePreparation);

    const changedUnderstandingAgent = { server, cookie: '' };
    await establish(changedUnderstandingAgent, 'approved_changed_understanding');
    const changedReflection = await request(changedUnderstandingAgent, 'GET', '/discovery/reflection');
    const changedPreparation = await request(changedUnderstandingAgent, 'POST', '/discovery/reflection/plan', {
      _csrf: hiddenValue(changedReflection.body, '_csrf')
    });
    assert.strictEqual(changedPreparation.res.statusCode, 303);
    const changedPrepared = await storedWorkflow(changedUnderstandingAgent);
    assert.strictEqual(changedPrepared.confirmedUnderstanding.targetAudience.value, 'specialty_retail_buyers');
    for (const key of [
      'buildPlan', 'buildPlanUpdatedAt', 'buildPlanSource', 'buildPlanFingerprint',
      'buildPlanSelection', 'buildPlanSavedAt', 'buildPlanNotice', 'approvedProductionSet'
    ]) assert.strictEqual(changedPrepared[key], null, `${key} must be invalidated by Strategy replacement`);
    assert.deepStrictEqual(databaseSnapshot(db), databaseBeforePreparation,
      'Strategy replacement must not create saved plans, Production, usage, or memory rows');

    for (const failureMode of ['throw', 'malformed']) {
      const failureAgent = { server, cookie: '' };
      const failureBaseline = await establish(failureAgent, 'approved_changed_understanding');
      const failureDatabase = databaseSnapshot(db);
      const failureReflection = await request(failureAgent, 'GET', '/discovery/reflection');
      synthesisFailureMode = failureMode;
      const failure = await request(failureAgent, 'POST', '/discovery/reflection/plan', {
        _csrf: hiddenValue(failureReflection.body, '_csrf')
      });
      synthesisFailureMode = null;
      assert.strictEqual(failure.res.statusCode, 409);
      assert.match(failure.body, /The Strategy could not be prepared safely/);
      assert.strictEqual(hash(await storedWorkflow(failureAgent)), hash(failureBaseline),
        `${failureMode} preparation failure must preserve the exact workflow`);
      assert.deepStrictEqual(databaseSnapshot(db), failureDatabase,
        `${failureMode} preparation failure must not change database rows`);
    }

    const missingCsrfAgent = { server, cookie: '' };
    const missingCsrfBaseline = await establish(missingCsrfAgent, 'complete_unprepared');
    const missingCsrf = await request(missingCsrfAgent, 'POST', '/discovery/reflection/plan');
    assert.strictEqual(missingCsrf.res.statusCode, 403);
    assert.strictEqual(hash(await storedWorkflow(missingCsrfAgent)), hash(missingCsrfBaseline));

    const crossSessionAgent = { server, cookie: '' };
    const crossSessionBaseline = await establish(crossSessionAgent, 'complete_unprepared');
    const crossSession = await request(crossSessionAgent, 'POST', '/discovery/reflection/plan', { _csrf: csrf });
    assert.strictEqual(crossSession.res.statusCode, 403);
    assert.strictEqual(hash(await storedWorkflow(crossSessionAgent)), hash(crossSessionBaseline));

    const invalidAgent = { server, cookie: '' };
    const invalidBaseline = await establish(invalidAgent, 'partial');
    const invalidReflection = await request(invalidAgent, 'GET', '/discovery/reflection');
    const invalid = await request(invalidAgent, 'POST', '/discovery/reflection/plan', {
      _csrf: hiddenValue(invalidReflection.body, '_csrf')
    });
    assert.strictEqual(invalid.res.statusCode, 409);
    assert.strictEqual(hash(await storedWorkflow(invalidAgent)), hash(invalidBaseline));

    console.log(`Story 3.262 read-only Strategy matrix passed: ${JSON.stringify(matrixHashes)}`);
  } finally {
    server.close();
    db.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
