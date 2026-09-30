const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-story-3-8-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DATABASE_URL + suffix); } catch (err) { /* File does not exist. */ }
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createApprovedProductionSet, createDefaultSelection, planFingerprint } = require('../lib/buildPlanApproval');
const { calculateProductionCost } = require('../lib/productionCost');
const { getProductionReview, initializeProduction } = require('../lib/productionInitialization');
const { getProductionHandler } = require('../lib/productionHandlers');
const productionRoutes = require('../routes/production');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function understanding(overrides = {}) {
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
    brand: confirmed('established', 'Established'),
    ...overrides
  };
}

function createDiscoveryState(mode = 'valid', overrides = {}) {
  const facts = understanding(overrides);
  const answers = { initial_description: 'Organic turmeric supplement' };
  const strategyResult = buildStrategy({
    objective: 'launch_product', understanding: facts, confirmedUnderstanding: facts, answers
  });
  const buildPlanResult = buildPlan({
    objective: 'launch_product', confirmedUnderstanding: facts, strategyResult, answers
  });
  const selection = createDefaultSelection(buildPlanResult);
  const approval = createApprovedProductionSet({ plan: buildPlanResult, selection, strategyResult });
  selection.approvedAt = approval.approvedAt;
  selection.updatedAt = approval.approvedAt;
  const now = new Date().toISOString();
  const state = {
    objective: 'launch_product',
    answers,
    understanding: facts,
    planningReadiness: { ready: true },
    reflectionStartedAt: now,
    planningConfirmedAt: now,
    confirmedUnderstanding: facts,
    strategyResult,
    strategyUpdatedAt: now,
    buildPlan: buildPlanResult,
    buildPlanUpdatedAt: now,
    buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
    buildPlanFingerprint: planFingerprint(buildPlanResult),
    buildPlanSelection: selection,
    approvedProductionSet: approval.productionSet,
    updatedAt: now
  };
  if (mode === 'missing_approval') state.approvedProductionSet = null;
  if (mode === 'stale_plan') state.buildPlanSource.strategyUpdatedAt = new Date(Date.now() - 60000).toISOString();
  if (mode === 'changed_strategy') state.strategyUpdatedAt = new Date(Date.now() + 60000).toISOString();
  return state;
}

function createUser(db, monthlyLimit) {
  return Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, 'Production Owner', 'free', ?, 0)
  `).run(`story-3-8-${Date.now()}-${Math.random()}@example.com`, monthlyLimit).lastInsertRowid);
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function request(agent, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : '';
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (agent.cookie) headers.Cookie = agent.cookie;
    const req = http.request({
      hostname: '127.0.0.1', port: agent.server.address().port, method, path: url, headers
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

function usageState(db, userId) {
  return {
    events: db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count,
    units: db.prepare('SELECT COALESCE(SUM(units), 0) AS count FROM usage_events WHERE user_id = ?').get(userId).count,
    periodUsage: db.prepare('SELECT COALESCE(SUM(usage_count), 0) AS count FROM usage_periods WHERE user_id = ?').get(userId).count,
    legacy: db.prepare('SELECT generations_used FROM users WHERE id = ?').get(userId).generations_used
  };
}

async function run() {
  initDb();
  const db = getDb();
  const sufficientUserId = createUser(db, 50);
  const insufficientUserId = createUser(db, 2);
  const failureUserId = createUser(db, 50);
  const otherUserId = createUser(db, 50);
  const validateUserId = createUser(db, 50);
  const phasedUserId = createUser(db, 4);

  const approved = createDiscoveryState().approvedProductionSet;
  const deliverableCount = approved.selectedDeliverables.length;
  const cost = calculateProductionCost({
    approvedProductionSet: approved,
    usageSnapshot: { used: 3, monthlyLimit: 50, remaining: 47 }
  });
  const units = cost.productionUnitCount;
  assert.strictEqual(cost.valid, true);
  assert(units > 0 && units < deliverableCount, 'planning foundation must be free while customer-ready assets remain billable');
  assert.strictEqual(cost.planningFoundationCount + cost.readyToUseAssetCount, deliverableCount);
  assert.strictEqual(cost.currentUsage, 3);
  assert.strictEqual(cost.canAfford, true);
  assert.strictEqual(cost.costingModel, 'ready_to_use_asset_unit');
  const unknownCost = calculateProductionCost({
    approvedProductionSet: { selectedDeliverables: [{ id: 'unknown_free_asset' }] },
    usageSnapshot: { used: 0, monthlyLimit: 50, remaining: 50 }
  });
  assert.strictEqual(unknownCost.valid, false);
  assert.match(unknownCost.blockingReason, /without an authoritative production cost/);

  const reviewBefore = usageState(db, sufficientUserId);
  const directReview = getProductionReview({
    db,
    user: db.prepare('SELECT * FROM users WHERE id = ?').get(sufficientUserId),
    discoverySession: createDiscoveryState()
  });
  assert.strictEqual(directReview.valid, true);
  assert.deepStrictEqual(usageState(db, sufficientUserId), reviewBefore, 'cost review must not consume or initialize usage');
  const tamperedState = createDiscoveryState();
  tamperedState.approvedProductionSet.selectedDeliverables[0].strategicDirection = 'Unapproved direction';
  const tamperedReview = getProductionReview({
    db,
    user: db.prepare('SELECT * FROM users WHERE id = ?').get(sufficientUserId),
    discoverySession: tamperedState
  });
  assert.strictEqual(tamperedReview.valid, false);
  assert.match(tamperedReview.reason, /no longer matches/);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-8-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:userId/:mode', (req, res) => {
    req.session.userId = Number(req.params.userId);
    req.session.discoverySession = req.params.mode === 'no_session' ? null : createDiscoveryState(req.params.mode);
    res.redirect('/production/review');
  });
  app.use(createCsrfProtection());
  app.get('/test/token', (req, res) => res.json({ token: req.csrfToken() }));
  app.use(productionRoutes);

  const server = await listen(app);
  const sufficient = { server, cookie: '' };
  const insufficient = { server, cookie: '' };
  const missing = { server, cookie: '' };
  const stale = { server, cookie: '' };
  const changed = { server, cookie: '' };
  const failure = { server, cookie: '' };
  const other = { server, cookie: '' };
  const expiredSession = { server, cookie: '' };
  try {
    const anonymousReview = await request({ server, cookie: '' }, 'GET', '/production/review');
    assert.strictEqual(anonymousReview.res.statusCode, 302);
    assert.strictEqual(anonymousReview.res.headers.location, '/login');
    const anonymousStart = await request({ server, cookie: '' }, 'POST', '/production/start');
    assert.strictEqual(anonymousStart.res.statusCode, 403);

    await request(missing, 'GET', `/test/authenticate/${sufficientUserId}/missing_approval`);
    const missingReview = await request(missing, 'GET', '/production/review');
    assert.strictEqual(missingReview.res.statusCode, 302);
    assert.strictEqual(missingReview.res.headers.location, '/discovery/build-plan');

    await request(stale, 'GET', `/test/authenticate/${sufficientUserId}/stale_plan`);
    assert.strictEqual((await request(stale, 'GET', '/production/review')).res.headers.location, '/discovery/build-plan');
    await request(changed, 'GET', `/test/authenticate/${sufficientUserId}/changed_strategy`);
    assert.strictEqual((await request(changed, 'GET', '/production/review')).res.headers.location, '/discovery/build-plan');

    await request(insufficient, 'GET', `/test/authenticate/${insufficientUserId}/valid`);
    const insufficientPage = await request(insufficient, 'GET', '/production/review');
    assert.strictEqual(insufficientPage.res.statusCode, 200);
    assert.match(insufficientPage.body, /only 2 remain/);
    assert.match(insufficientPage.body, /View Plans/);
    const insufficientToken = JSON.parse((await request(insufficient, 'GET', '/test/token')).body).token;
    const insufficientStart = await request(insufficient, 'POST', '/production/start', { _csrf: insufficientToken });
    assert.strictEqual(insufficientStart.res.statusCode, 409);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM production_runs WHERE user_id = ?').get(insufficientUserId).count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM production_jobs').get().count, 0);
    assert.deepStrictEqual(usageState(db, insufficientUserId), { events: 0, units: 0, periodUsage: 0, legacy: 0 });

    await request(sufficient, 'GET', `/test/authenticate/${sufficientUserId}/valid`);
    const review = await request(sufficient, 'GET', '/production/review');
    assert.strictEqual(review.res.statusCode, 200);
    assert.match(review.body, new RegExp(`${units} production credit`));
    assert.match(review.body, /Starting this run will use/);
    assert.match(review.body, /Start Production/);
    assert.match(review.body, /What you'll receive/);
    assert.match(review.body, /<details class="planning-foundation-disclosure">/);
    assert(review.body.indexOf("What you'll receive") < review.body.indexOf('Supporting work'));
    assert.doesNotMatch(review.body, /Acceptance-isolated|external AI provider|<dt>Provider<\/dt>|<dt>Model<\/dt>|CopyQuick Deterministic/);
    assert.deepStrictEqual(usageState(db, sufficientUserId), reviewBefore);
    const token = review.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const csrfDenied = await request(sufficient, 'POST', '/production/start');
    assert.strictEqual(csrfDenied.res.statusCode, 403);

    const started = await request(sufficient, 'POST', '/production/start', { _csrf: token, productionCost: 0 });
    assert.strictEqual(started.res.statusCode, 303);
    const runLocation = started.res.headers.location;
    const runId = Number(runLocation.split('/').pop());
    const run = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(runId);
    const jobs = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(runId);
    assert.strictEqual(run.status, 'queued');
    assert.strictEqual(run.production_cost_units, units, 'client-posted cost must be ignored');
    assert.strictEqual(run.plan_fingerprint, approved.planFingerprint);
    assert.deepStrictEqual(JSON.parse(run.strategy_snapshot), approved.strategySnapshot);
    assert.strictEqual(jobs.length, deliverableCount);
    assert.deepStrictEqual(jobs.map((job) => job.deliverable_id), approved.productionOrder);
    jobs.forEach(function(job, index) {
      assert.strictEqual(job.sequence_order, index);
      assert.strictEqual(job.strategic_direction, approved.selectedDeliverables[index].strategicDirection);
      assert.deepStrictEqual(JSON.parse(job.dependencies), approved.selectedDeliverables[index].dependencies);
      assert.deepStrictEqual(JSON.parse(job.strategy_snapshot), approved.strategySnapshot);
      assert.strictEqual(job.status, JSON.parse(job.dependencies).length ? 'waiting_dependency' : 'queued');
    });
    assert.deepStrictEqual(usageState(db, sufficientUserId), {
      events: 1, units, periodUsage: units, legacy: units
    });
    const usageEvent = db.prepare('SELECT * FROM usage_events WHERE user_id = ?').get(sufficientUserId);
    assert.strictEqual(usageEvent.production_run_id, runId);
    assert.strictEqual(usageEvent.event_type, 'production_start');

    const duplicate = await request(sufficient, 'POST', '/production/start', { _csrf: token, productionCost: 9999 });
    assert.strictEqual(duplicate.res.statusCode, 303);
    assert.strictEqual(duplicate.res.headers.location, runLocation);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM production_runs WHERE user_id = ?').get(sufficientUserId).count, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM production_jobs WHERE production_run_id = ?').get(runId).count, deliverableCount);
    assert.deepStrictEqual(usageState(db, sufficientUserId), { events: 1, units, periodUsage: units, legacy: units });

    const studio = await request(sufficient, 'GET', runLocation);
    assert.strictEqual(studio.res.statusCode, 200);
    assert.match(studio.body, new RegExp(`Creating your assets · 0 of ${deliverableCount} complete`));
    assert.match(studio.body, /queued/);
    assert.match(studio.body, /supporting work is ready/);
    assert.doesNotMatch(studio.body, /\d+%|almost done|AI is working/i);

    await request(other, 'GET', `/test/authenticate/${otherUserId}/no_session`);
    const forbiddenRun = await request(other, 'GET', runLocation);
    assert.strictEqual(forbiddenRun.res.statusCode, 404);

    await request(expiredSession, 'GET', `/test/authenticate/${sufficientUserId}/no_session`);
    const persistedStudio = await request(expiredSession, 'GET', runLocation);
    assert.strictEqual(persistedStudio.res.statusCode, 200, 'persistent jobs must survive discovery-session expiration');

    await request(failure, 'GET', `/test/authenticate/${failureUserId}/valid`);
    const failureToken = JSON.parse((await request(failure, 'GET', '/test/token')).body).token;
    db.exec(`
      CREATE TRIGGER fail_story_3_8 BEFORE INSERT ON usage_events
      BEGIN
        SELECT RAISE(ABORT, 'forced production usage failure');
      END;
    `);
    const failedStart = await request(failure, 'POST', '/production/start', { _csrf: failureToken });
    assert.strictEqual(failedStart.res.statusCode, 500);
    db.exec('DROP TRIGGER IF EXISTS fail_story_3_8');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM production_runs WHERE user_id = ?').get(failureUserId).count, 0);
    assert.strictEqual(db.prepare(`
      SELECT COUNT(*) AS count FROM production_jobs
      JOIN production_runs ON production_runs.id = production_jobs.production_run_id
      WHERE production_runs.user_id = ?
    `).get(failureUserId).count, 0);
    assert.deepStrictEqual(usageState(db, failureUserId), { events: 0, units: 0, periodUsage: 0, legacy: 0 });
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations').get().count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM brand_brain').get().count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM subscriptions').get().count, 0);

    const validateState = createDiscoveryState('valid', {
      intendedOutcome: confirmed('digestive_wellness', 'Digestive health'),
      conceptMaturity: confirmed('idea_only', 'I only have the product idea'),
      launchStage: { value: 'idea', label: 'Idea or early concept', confidence: 0.85, source: 'inference' },
      targetAudience: { value: 'adults', label: 'Adults', confidence: 0.85, source: 'inference' },
      competitiveDifferentiation: undefined,
      productExplorationDirections: {
        value: ['bloating_comfort'], label: 'Bloating & digestive comfort', confidence: 1,
        source: 'user_confirmed', semanticRole: 'exploration_intent'
      }
    });
    assert.deepStrictEqual(validateState.approvedProductionSet.productionOrder, [
      'customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition', 'validation_plan', 'amazon_keyword_guidance'
    ]);
    const validateStart = initializeProduction({
      db,
      user: db.prepare('SELECT * FROM users WHERE id = ?').get(validateUserId),
      discoverySession: validateState
    });
    assert.strictEqual(validateStart.valid, true);
    assert.deepStrictEqual(
      db.prepare('SELECT deliverable_id FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(validateStart.productionRunId).map((job) => job.deliverable_id),
      validateState.approvedProductionSet.productionOrder
    );

    const phasedState = createDiscoveryState();
    phasedState.approvedProductionSet.batchMode = 'affordable';
    const firstBatch = initializeProduction({
      db,
      user: db.prepare('SELECT * FROM users WHERE id = ?').get(phasedUserId),
      discoverySession: phasedState
    });
    assert.strictEqual(firstBatch.valid, true);
    assert(firstBatch.cost.productionUnitCount <= 4);
    assert(firstBatch.batch.productionNow.length >= firstBatch.cost.productionUnitCount, 'free planning may accompany the paid assets in a batch');
    const firstBatchJobCount = firstBatch.batch.productionNow.length;
    const firstBatchUnits = firstBatch.cost.productionUnitCount;
    const firstBatchJobs = db.prepare(`
      SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order
    `).all(firstBatch.productionRunId);
    const generatedByDeliverable = new Map();
    firstBatchJobs.forEach(function(job) {
      const handler = getProductionHandler(job.deliverable_id);
      const dependencyOutputs = JSON.parse(job.dependencies || '[]').map(function(deliverableId) {
        return generatedByDeliverable.get(deliverableId);
      }).filter(Boolean);
      const structuredResult = handler.generateOutput({
        objective: phasedState.objective,
        title: job.title,
        strategicDirection: job.strategic_direction,
        strategySnapshot: phasedState.approvedProductionSet.strategySnapshot,
        dependencyOutputs
      });
      const generationId = Number(db.prepare(`
        INSERT INTO generations (
          user_id, title, input_text, content_type, ai_model, results,
          production_job_id, deliverable_id, contract_version, structured_result
        ) VALUES (?, ?, 'test', 'sales_message', 'CopyQuick Deterministic', '[]', ?, ?, ?, ?)
      `).run(phasedUserId, job.title, job.id, job.deliverable_id, job.contract_version, JSON.stringify(structuredResult)).lastInsertRowid);
      db.prepare(`
        UPDATE production_jobs
        SET status = 'completed', generation_id = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(generationId, job.id);
      generatedByDeliverable.set(job.deliverable_id, {
        deliverableId: job.deliverable_id,
        title: job.title,
        contractVersion: job.contract_version,
        output: structuredResult,
        result: []
      });
    });
    db.prepare("UPDATE production_runs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(firstBatch.productionRunId);
    db.prepare('UPDATE users SET monthly_limit = 50 WHERE id = ?').run(phasedUserId);

    const secondBatch = initializeProduction({
      db,
      user: db.prepare('SELECT * FROM users WHERE id = ?').get(phasedUserId),
      discoverySession: phasedState
    });
    assert.strictEqual(secondBatch.valid, true);
    assert.notStrictEqual(secondBatch.productionRunId, firstBatch.productionRunId, 'a later batch must not reopen the completed earlier run');
    assert.strictEqual(secondBatch.cost.productionUnitCount, units - firstBatchUnits);
    assert.strictEqual(db.prepare('SELECT production_cost_units FROM production_runs WHERE id = ?').get(secondBatch.productionRunId).production_cost_units, units - firstBatchUnits);
    assert.strictEqual(db.prepare(`
      SELECT COUNT(*) AS count FROM production_jobs
      WHERE production_run_id = ? AND generation_id IS NULL
    `).get(secondBatch.productionRunId).count, deliverableCount - firstBatchJobCount);

    const repeatedSecondBatch = initializeProduction({
      db,
      user: db.prepare('SELECT * FROM users WHERE id = ?').get(phasedUserId),
      discoverySession: phasedState
    });
    assert.strictEqual(repeatedSecondBatch.duplicate, true);
    assert.strictEqual(repeatedSecondBatch.productionRunId, secondBatch.productionRunId, 'repeated starts must remain idempotent within the active batch');

    console.log('Story 3.8 Production Initialization tests passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
