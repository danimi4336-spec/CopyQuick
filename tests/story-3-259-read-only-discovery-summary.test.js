const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { assertIsolatedTestDatabase } = require('./helpers/isolatedTestDatabase');

process.env.TEST_DATABASE_PATH = assertIsolatedTestDatabase();
process.env.SESSION_SECRET = 'story-3-259-session-secret';
process.env.AI_DISCOVERY_ENABLED = 'false';
process.env.AI_STRATEGY_ENABLED = 'false';
process.env.OPENAI_API_KEY = '';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createDefaultSelection, planFingerprint } = require('../lib/buildPlanApproval');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createCsrfProtection } = require('../lib/csrf');
const { DISCOVERY_POLICY_VERSION, evaluateRequirements } = require('../lib/discoveryRequirements');
const { createSensitiveResponseCacheMiddleware } = require('../lib/sensitiveResponseCache');
const { saveBuildPlan } = require('../lib/savedBuildPlans');
const { buildStrategy } = require('../lib/strategyEngine');
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function unsure() {
  return confirmed('unsure', "I'm not sure yet");
}

function workflow(description = 'Project-management software for small professional-services teams. <script>alert("summary")</script>') {
  const answers = {
    initial_description: description,
    conversion_traffic: 'unsure',
    conversion_page: 'unsure',
    conversion_evidence: 'unsure',
    conversion_friction: 'unsure'
  };
  const understanding = {
    businessType: confirmed('software', 'Software / SaaS'),
    industry: confirmed('technology', 'Technology'),
    currentOffer: confirmed('project_management_software', 'Project-management software'),
    targetAudience: confirmed('professional_services_teams', 'Small professional-services teams'),
    funnelType: confirmed('trial_signup', 'Start a trial or account'),
    primaryCta: confirmed('start_free_trial', 'Start a free trial'),
    trafficSource: unsure(),
    pageExperience: unsure(),
    conversionEvidence: unsure(),
    conversionFriction: unsure()
  };
  const planningReadiness = evaluateRequirements({
    objective: 'increase_conversion_rates', understanding, answers
  });
  const strategyResult = buildStrategy({
    objective: 'increase_conversion_rates', understanding, confirmedUnderstanding: understanding, answers
  });
  const plan = buildPlan({
    objective: 'increase_conversion_rates', confirmedUnderstanding: understanding, strategyResult, answers
  });
  const fingerprint = planFingerprint(plan);
  return {
    objective: 'increase_conversion_rates', answers, understanding,
    confirmedUnderstanding: understanding, unknowns: [], completedQuestions: [], completion: {},
    knowledgeDomains: {}, remainingKnowledgeGaps: [], planningReadiness,
    discoveryCompleteForNow: true, discoveryPolicyVersion: DISCOVERY_POLICY_VERSION,
    startedAt: '2026-10-13T12:00:00.000Z', updatedAt: '2026-10-13T12:10:00.000Z',
    reflectionStartedAt: '2026-10-13T12:11:00.000Z',
    planningConfirmedAt: '2026-10-13T12:12:00.000Z',
    strategyResult, strategyUpdatedAt: '2026-10-13T12:13:00.000Z',
    buildPlan: plan, buildPlanUpdatedAt: '2026-10-13T12:14:00.000Z', buildPlanSource: 'strategy',
    buildPlanFingerprint: fingerprint, buildPlanSelection: createDefaultSelection(plan)
  };
}

function executableWorkflow() {
  const answers = {
    initial_description: 'A reusable insulated lunch container for busy parents sold through our own website.'
  };
  const understanding = {
    businessType: confirmed('physical_product', 'Physical Product'),
    targetAudience: confirmed('busy_parents', 'Busy parents'),
    customerMotivation: confirmed('convenience', 'Make packed lunches easier'),
    launchStage: confirmed('ready', 'Ready to launch'),
    salesChannel: confirmed('own_website', 'Our own website'),
    competitiveDifferentiation: unsure()
  };
  const planningReadiness = evaluateRequirements({ objective: 'launch_product', understanding, answers });
  const strategyResult = buildStrategy({
    objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers
  });
  const plan = buildPlan({
    objective: 'launch_product', confirmedUnderstanding: understanding, strategyResult, answers
  });
  const fingerprint = planFingerprint(plan);
  return {
    objective: 'launch_product', answers, understanding,
    confirmedUnderstanding: understanding, unknowns: [], completedQuestions: [], completion: {},
    knowledgeDomains: {}, remainingKnowledgeGaps: [], planningReadiness,
    discoveryCompleteForNow: true, discoveryPolicyVersion: DISCOVERY_POLICY_VERSION,
    startedAt: '2026-10-13T11:00:00.000Z', reflectionStartedAt: '2026-10-13T11:01:00.000Z',
    planningConfirmedAt: '2026-10-13T11:02:00.000Z', strategyResult,
    strategyUpdatedAt: '2026-10-13T11:03:00.000Z', buildPlan: plan,
    buildPlanUpdatedAt: '2026-10-13T11:04:00.000Z', buildPlanSource: 'strategy',
    buildPlanFingerprint: fingerprint, buildPlanSelection: createDefaultSelection(plan)
  };
}

function request(agent, url, userId = agent.userId) {
  return new Promise((resolve, reject) => {
    const headers = { 'X-Test-User': String(userId) };
    if (agent.cookie) headers.Cookie = agent.cookie;
    const req = http.get({ hostname: '127.0.0.1', port: agent.server.address().port, path: url, headers }, (res) => {
      const cookies = res.headers['set-cookie'];
      if (cookies?.length) agent.cookie = cookies.map(cookie => cookie.split(';')[0]).join('; ');
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`Timed out requesting ${url}`)));
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

function databaseSnapshot(db) {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);
  return Object.fromEntries(tables.map(table => {
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    return [table, JSON.stringify(rows)];
  }));
}

function rowSnapshot(db, userId) {
  return JSON.stringify(db.prepare('SELECT * FROM saved_build_plan_states WHERE user_id = ? ORDER BY id').all(userId));
}

function replaceSavedWorkflow(db, row, mutate) {
  const state = JSON.parse(row.workflow_state);
  mutate(state);
  db.prepare('UPDATE saved_build_plan_states SET workflow_state = ? WHERE id = ?')
    .run(JSON.stringify(state), row.id);
}

let productionRunSequence = 0;

function insertProductionRun(db, userId, overrides = {}) {
  const strategy = overrides.strategySnapshot ?? {
    confirmedOffer: { value: 'project_management_software', label: 'Project-management software', semanticRole: 'confirmed_fact' },
    primaryCustomer: { value: 'professional_services_teams', label: 'Small professional-services teams', semanticRole: 'confirmed_fact' },
    internalPrompt: { value: 'PRODUCTION_INTERNAL_MARKER', semanticRole: 'internal_strategy' }
  };
  const result = db.prepare(`
    INSERT INTO production_runs (
      user_id, objective, status, plan_fingerprint, idempotency_key, approved_at,
      started_at, completed_at, strategy_snapshot, production_plan_snapshot,
      production_cost_units, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    userId, 'increase_conversion_rates', overrides.status || 'completed', 'a'.repeat(20),
    `story-3-259-${userId}-${productionRunSequence += 1}`, '2026-10-13T13:00:00.000Z',
    '2026-10-13T13:01:00.000Z', '2026-10-13T13:02:00.000Z',
    typeof strategy === 'string' ? strategy : JSON.stringify(strategy),
    overrides.planSnapshot === undefined ? JSON.stringify({ selected: [] }) : overrides.planSnapshot,
    '2026-10-13T13:00:00.000Z', '2026-10-13T13:02:00.000Z'
  );
  return Number(result.lastInsertRowid);
}

function assertNoInternalLeak(body) {
  for (const token of [
    'buildPlanFingerprint', 'planFingerprint', 'confirmedUnderstanding', 'strategyResult',
    'planningReadiness&quot;', 'confidence', 'semanticRole', 'internalPrompt',
    'PRODUCTION_INTERNAL_MARKER', 'validation code', 'dependency payload'
  ]) assert(!body.includes(token), `must not render internal token ${token}`);
}

function errorPage(body) {
  return body.match(/<div class="error-page">[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
}

async function run() {
  initDb({ logger() {} });
  const db = getDb();
  const ownerId = Number(db.prepare('INSERT INTO users(email, name) VALUES (?, ?)')
    .run('summary-owner@example.test', 'Summary Owner').lastInsertRowid);
  const otherId = Number(db.prepare('INSERT INTO users(email, name) VALUES (?, ?)')
    .run('summary-other@example.test', 'Summary Other').lastInsertRowid);
  const executableOwnerId = Number(db.prepare('INSERT INTO users(email, name) VALUES (?, ?)')
    .run('summary-executable@example.test', 'Summary Executable').lastInsertRowid);
  const state = workflow();
  saveBuildPlan(db, { userId: ownerId, discoverySession: state, now: new Date('2026-10-13T12:15:00.000Z') });
  const executableState = executableWorkflow();
  assert(executableState.buildPlanSelection.selectedDeliverableIds.length > 0);
  assert(executableState.buildPlanSelection.deselectedDeliverableIds.length > 0);
  saveBuildPlan(db, {
    userId: executableOwnerId,
    discoverySession: executableState,
    now: new Date('2026-10-13T11:05:00.000Z')
  });
  const productionId = insertProductionRun(db, ownerId);
  const otherProductionId = insertProductionRun(db, otherId);

  const app = express();
  app.locals.copyquickDb = db;
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    const userId = Number(req.get('X-Test-User'));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    req.session.userId = userId;
    req.session.csrfSecret ||= 'pre-established-story-3-259-csrf-secret';
    res.locals.user = user;
    next();
  });
  app.use(createSensitiveResponseCacheMiddleware());
  app.use(createCsrfProtection());
  app.get('/test/state/:name', (req, res) => {
    if (req.params.name === 'complete') req.session.discoverySession = JSON.parse(JSON.stringify(state));
    else if (req.params.name === 'stale') {
      req.session.discoverySession = JSON.parse(JSON.stringify(state));
      req.session.discoverySession.discoveryPolicyVersion = DISCOVERY_POLICY_VERSION - 1;
      req.session.discoverySession.planningReadiness.policyVersion = DISCOVERY_POLICY_VERSION - 1;
    } else if (req.params.name === 'oversized') {
      req.session.discoverySession = JSON.parse(JSON.stringify(state));
      req.session.discoverySession.answers.initial_description = 'x'.repeat(2001);
    } else if (req.params.name === 'boundary') {
      req.session.discoverySession = JSON.parse(JSON.stringify(state));
      req.session.discoverySession.answers.initial_description = 'y'.repeat(2000);
    } else if (req.params.name === 'nul') {
      req.session.discoverySession = JSON.parse(JSON.stringify(state));
      req.session.discoverySession.answers.initial_description = 'safe-looking\0hidden';
    } else req.session.discoverySession = null;
    res.sendStatus(204);
  });
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.use((req, res, next) => {
    const originalRender = res.render;
    res.render = function render(view, options, callback) {
      if (view === 'layout') return originalRender.call(this, view, options, callback);
      return originalRender.call(this, view, options, (error, html) => {
        if (error) return next(error);
        return originalRender.call(this, 'layout', { ...options, ...res.locals, body: html }, callback);
      });
    };
    next();
  });
  app.use(discoveryRoutes);
  app.use((error, _req, res, _next) => res.status(500).send(`test-render-error:${error.message}`));

  const server = await listen(app);
  const agent = { server, cookie: '', userId: ownerId };
  try {
    const anonymous = { server, cookie: '', userId: '' };
    for (const url of [
      '/discovery/summary',
      '/discovery/summary/saved/increase_conversion_rates',
      `/discovery/summary/production/${productionId}`
    ]) {
      const denied = await request(anonymous, url);
      assert.strictEqual(denied.res.statusCode, 302);
      assert.strictEqual(denied.res.headers.location, '/login');
    }

    await request(agent, '/test/state/complete');
    const sessionBefore = (await request(agent, '/test/session')).body;
    const dbBefore = databaseSnapshot(db);
    const current = await request(agent, '/discovery/summary');
    assert.strictEqual(current.res.statusCode, 200);
    assert.strictEqual(current.res.headers['cache-control'], 'private, no-store');
    assert.match(current.body, /<h1>Discovery Summary<\/h1>/);
    assert.match(current.body, /Read-only snapshot/);
    assert.match(current.body, /Software \/ SaaS/);
    assert.match(current.body, /Project-management software/);
    assert.match(current.body, /4 planning inputs remain open/);
    for (const label of ['Traffic source', 'Page experience', 'Conversion evidence', 'Customer friction']) {
      assert.match(current.body, new RegExp(`${label}<\\/span> — Not established`));
    }
    assert.match(current.body, /<details>/);
    assert.match(current.body, /<summary>4 planning inputs remain open<\/summary>/);
    assert.match(current.body, /<ul aria-label="Open planning inputs">/);
    assert.match(current.body, /&lt;script&gt;alert\(&#34;summary&#34;\)&lt;\/script&gt;/);
    assert.doesNotMatch(current.body, /<script>alert\("summary"\)<\/script>/);
    assertNoInternalLeak(current.body);
    assert.doesNotMatch(current.body, /href="\/discovery\/(?:reflection|strategy|build-plan)/);
    assert.doesNotMatch(current.body, /saved-plan\/resume|production\/review|retry|regenerat/i);
    assert.strictEqual((await request(agent, '/test/session')).body, sessionBefore);
    assert.deepStrictEqual(databaseSnapshot(db), dbBefore);
    await request(agent, '/discovery/summary');
    assert.strictEqual((await request(agent, '/test/session')).body, sessionBefore);
    assert.deepStrictEqual(databaseSnapshot(db), dbBefore);

    await request(agent, '/test/state/oversized');
    const oversized = await request(agent, '/discovery/summary');
    assert.strictEqual(oversized.res.statusCode, 200);
    assert.match(oversized.body, /original customer description is not available/i);
    assert(!oversized.body.includes('x'.repeat(2001)));

    await request(agent, '/test/state/boundary');
    const boundary = await request(agent, '/discovery/summary');
    assert.strictEqual(boundary.res.statusCode, 200);
    assert(boundary.body.includes('y'.repeat(2000)), 'the exact 2,000-character boundary remains displayable');
    await request(agent, '/test/state/nul');
    const nul = await request(agent, '/discovery/summary');
    assert.strictEqual(nul.res.statusCode, 200);
    assert.match(nul.body, /original customer description is not available/i);
    assert.doesNotMatch(nul.body, /safe-looking/);

    await request(agent, '/test/state/stale');
    const stale = await request(agent, '/discovery/summary');
    assert.strictEqual(stale.res.statusCode, 200);
    assert.match(stale.body, /historical snapshot/i);
    assert.match(stale.body, /may not reflect the current Discovery policy/i);

    await request(agent, '/test/state/missing');
    const missingSession = await request(agent, '/discovery/summary');
    assert.strictEqual(missingSession.res.statusCode, 200);
    assert.match(missingSession.body, /Summary unavailable/);

    const savedBefore = rowSnapshot(db, ownerId);
    const saved = await request(agent, '/discovery/summary/saved/increase_conversion_rates');
    assert.strictEqual(saved.res.statusCode, 200);
    assert.match(saved.body, /Saved Build Plan snapshot/);
    assert.match(saved.body, /saved point-in-time snapshot/i);
    assert.match(saved.body, /Project-management software/);
    assert.strictEqual(rowSnapshot(db, ownerId), savedBefore, 'saved row must remain byte-for-byte unchanged');

    const missingSaved = await request(agent, '/discovery/summary/saved/launch_product');
    const foreignSaved = await request(agent, '/discovery/summary/saved/increase_conversion_rates', otherId);
    assert.strictEqual(missingSaved.res.statusCode, 404);
    assert.strictEqual(foreignSaved.res.statusCode, 404);
    assert.strictEqual(errorPage(missingSaved.body), errorPage(foreignSaved.body));

    const executableSaved = await request(agent, '/discovery/summary/saved/launch_product', executableOwnerId);
    assert.strictEqual(executableSaved.res.statusCode, 200);
    assert.match(executableSaved.body, /Reusable insulated lunch container/i);
    assert.match(executableSaved.body, /Saved Build Plan snapshot/);

    const row = db.prepare('SELECT * FROM saved_build_plan_states WHERE user_id = ?').get(ownerId);
    assert.deepStrictEqual(
      JSON.parse(row.workflow_state).buildPlanSelection.selectedDeliverableIds,
      ['conversion_diagnostic_brief', 'conversion_page_brief', 'conversion_measurement_plan'],
      'the supported planning-only snapshot retains its exact three selected planning documents'
    );
    for (const status of ['saved', 'active', 'partially_completed', 'completed']) {
      db.prepare('UPDATE saved_build_plan_states SET status = ? WHERE id = ?').run(status, row.id);
      const compatible = await request(agent, '/discovery/summary/saved/increase_conversion_rates');
      assert.strictEqual(compatible.res.statusCode, 200, `${status} version-1 snapshots remain readable`);
    }
    db.prepare('UPDATE saved_build_plan_states SET status = ? WHERE id = ?').run(row.status, row.id);

    db.prepare('UPDATE saved_build_plan_states SET state_version = 2 WHERE id = ?').run(row.id);
    const unsupported = await request(agent, '/discovery/summary/saved/increase_conversion_rates');
    assert.strictEqual(unsupported.res.statusCode, 409);
    assert.match(unsupported.body, /historical saved plan/i);
    assert.strictEqual(db.prepare('SELECT status FROM saved_build_plan_states WHERE id = ?').get(row.id).status, row.status);
    db.prepare('UPDATE saved_build_plan_states SET state_version = 1, workflow_state = ? WHERE id = ?').run('{bad json', row.id);
    const malformedSavedBefore = rowSnapshot(db, ownerId);
    assert.strictEqual((await request(agent, '/discovery/summary/saved/increase_conversion_rates')).res.statusCode, 409);
    assert.strictEqual(rowSnapshot(db, ownerId), malformedSavedBefore);
    const tampered = JSON.parse(row.workflow_state);
    tampered.buildPlanFingerprint = 'b'.repeat(20);
    db.prepare('UPDATE saved_build_plan_states SET workflow_state = ? WHERE id = ?').run(JSON.stringify(tampered), row.id);
    assert.strictEqual((await request(agent, '/discovery/summary/saved/increase_conversion_rates')).res.statusCode, 409);
    const tamperedSelection = JSON.parse(row.workflow_state);
    tamperedSelection.buildPlanSelection.selectedDeliverableIds = ['not-a-current-deliverable'];
    db.prepare('UPDATE saved_build_plan_states SET workflow_state = ? WHERE id = ?').run(JSON.stringify(tamperedSelection), row.id);
    assert.strictEqual((await request(agent, '/discovery/summary/saved/increase_conversion_rates')).res.statusCode, 409);

    for (const mutate of [
      state => state.buildPlanSelection.selectedDeliverableIds.push(state.buildPlanSelection.selectedDeliverableIds[0]),
      state => { state.buildPlanSelection.selectedDeliverableIds.pop(); },
      state => { state.buildPlanSelection.requiredDependencyIds = []; }
    ]) {
      db.prepare('UPDATE saved_build_plan_states SET workflow_state = ? WHERE id = ?').run(row.workflow_state, row.id);
      replaceSavedWorkflow(db, row, mutate);
      assert.strictEqual(
        (await request(agent, '/discovery/summary/saved/increase_conversion_rates')).res.statusCode,
        409,
        'duplicate, incomplete-partition, and dependency-tampered selections fail closed'
      );
    }
    db.prepare('UPDATE saved_build_plan_states SET workflow_state = ?, plan_fingerprint = ?, state_version = 1 WHERE id = ?')
      .run(row.workflow_state, row.plan_fingerprint, row.id);

    await request(agent, '/test/state/complete');
    const production = await request(agent, `/discovery/summary/production/${productionId}`);
    assert.strictEqual(production.res.statusCode, 200);
    assert.match(production.body, /partial historical snapshot/i);
    assert.match(production.body, /Project-management software/);
    assert.match(production.body, new RegExp(`href="/production/${productionId}"`));
    assert.doesNotMatch(production.body, /Small professional-services teams\. &lt;script/);
    assertNoInternalLeak(production.body);
    const missingProduction = await request(agent, '/discovery/summary/production/999999');
    const foreignProduction = await request(agent, `/discovery/summary/production/${otherProductionId}`);
    assert.strictEqual(missingProduction.res.statusCode, 404);
    assert.strictEqual(foreignProduction.res.statusCode, 404);
    assert.strictEqual(errorPage(missingProduction.body), errorPage(foreignProduction.body));

    const productionStatuses = {
      awaiting_start: 'Approved; not started',
      queued: 'Queued for Production',
      running: 'In Production',
      completed: 'Completed',
      partially_completed: 'Partially completed',
      failed: 'Failed',
      blocked: 'Blocked',
      canceled: 'Canceled'
    };
    for (const [status, label] of Object.entries(productionStatuses)) {
      const runId = insertProductionRun(db, ownerId, { status });
      const response = await request(agent, `/discovery/summary/production/${runId}`);
      assert.strictEqual(response.res.statusCode, 200);
      assert.match(response.body, new RegExp(`<strong>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/strong>`));
    }
    assert.strictEqual((await request(agent, '/discovery/summary/production/0')).res.statusCode, 404);
    assert.strictEqual((await request(agent, '/discovery/summary/production/1e2')).res.statusCode, 404);
    assert.strictEqual((await request(agent, '/discovery/summary/production/__proto__')).res.statusCode, 404);

    const malformedProductionId = insertProductionRun(db, ownerId, { strategySnapshot: '{bad json' });
    const malformedProduction = await request(agent, `/discovery/summary/production/${malformedProductionId}`);
    assert.strictEqual(malformedProduction.res.statusCode, 409);
    assert.match(malformedProduction.body, /cannot be summarized safely/i);
    assert.doesNotMatch(malformedProduction.body, /bad json|JSON|SyntaxError|validation/i);

    const finalSnapshot = databaseSnapshot(db);
    await request(agent, '/discovery/summary');
    await request(agent, '/discovery/summary/saved/increase_conversion_rates');
    await request(agent, `/discovery/summary/production/${productionId}`);
    assert.deepStrictEqual(databaseSnapshot(db), finalSnapshot);

    const summaryTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'discovery-summary.ejs'), 'utf8');
    assert.doesNotMatch(summaryTemplate, /<%-/);
    assert.doesNotMatch(summaryTemplate, /<form|method=|<button/i);
    assert.match(summaryTemplate, /<details>/);
    assert.match(summaryTemplate, /<summary>/);
    assert.match(summaryTemplate, /<ul aria-label="Open planning inputs"/);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    assert.match(css, /@media \(max-width: 640px\)/);
    assert.match(css, /overflow-wrap: anywhere/);
    for (const [file, text] of [
      ['business-reflection.ejs', 'View read-only Discovery Summary'],
      ['welcome.ejs', 'View saved Discovery Summary'],
      ['production-studio.ejs', 'View Discovery snapshot']
    ]) assert(fs.readFileSync(path.join(__dirname, '..', 'views', file), 'utf8').includes(text));

  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('Story 3.259 read-only Discovery Summary tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
