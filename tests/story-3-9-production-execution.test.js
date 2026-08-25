const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-story-3-9-test.sqlite');
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
const { getExecutableDeliverableIds, getProductionHandler } = require('../lib/productionHandlers');
const { initializeProduction } = require('../lib/productionInitialization');
const {
  claimNextRunnableJob,
  executeNextProductionJob,
  loadDependencyOutputs
} = require('../lib/productionExecution');
const productionRoutes = require('../routes/production');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function discoveryState() {
  const understanding = {
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
  const answers = { initial_description: 'Organic turmeric supplement' };
  const strategyResult = buildStrategy({ objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers });
  const plan = buildPlan({ objective: 'launch_product', confirmedUnderstanding: understanding, strategyResult, answers });
  const selection = createDefaultSelection(plan);
  const approval = createApprovedProductionSet({ plan, selection, strategyResult });
  selection.approvedAt = approval.approvedAt;
  const now = new Date().toISOString();
  return {
    objective: 'launch_product',
    planningReadiness: { ready: true },
    planningConfirmedAt: now,
    confirmedUnderstanding: understanding,
    strategyResult,
    strategyUpdatedAt: now,
    buildPlan: plan,
    buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
    buildPlanFingerprint: planFingerprint(plan),
    buildPlanSelection: selection,
    approvedProductionSet: approval.productionSet
  };
}

function createUser(db) {
  return Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, 'Execution Owner', 'pro', 100, 0)
  `).run(`story-3-9-${Date.now()}-${Math.random()}@example.com`).lastInsertRowid);
}

function startRun(db, userId) {
  const result = initializeProduction({
    db,
    user: db.prepare('SELECT * FROM users WHERE id = ?').get(userId),
    discoverySession: discoveryState()
  });
  assert.strictEqual(result.valid, true);
  return result.productionRunId;
}

function usage(db, userId) {
  return {
    units: db.prepare('SELECT COALESCE(SUM(units), 0) AS value FROM usage_events WHERE user_id = ?').get(userId).value,
    events: db.prepare('SELECT COUNT(*) AS value FROM usage_events WHERE user_id = ?').get(userId).value,
    period: db.prepare('SELECT COALESCE(SUM(usage_count), 0) AS value FROM usage_periods WHERE user_id = ?').get(userId).value,
    legacy: db.prepare('SELECT generations_used FROM users WHERE id = ?').get(userId).generations_used
  };
}

function successGenerator(calls) {
  return {
    generateCopy: (input) => {
      calls.push(input);
      return [{ text: `Persisted output ${calls.length}: ${input.productDescription}`, tone: 'professional' }];
    }
  };
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
    const req = http.request({ hostname: '127.0.0.1', port: agent.server.address().port, method, path: url, headers }, (res) => {
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

async function run() {
  initDb();
  const db = getDb();

  const executableIds = getExecutableDeliverableIds();
  assert(executableIds.length > 0);
  executableIds.forEach(function(id) {
    assert.strictEqual(getProductionHandler(id), getProductionHandler(id), 'handler lookup must be deterministic');
    const cost = calculateProductionCost({
      approvedProductionSet: { selectedDeliverables: [{ id }] },
      usageSnapshot: { used: 0, monthlyLimit: 100, remaining: 100 }
    });
    assert.strictEqual(cost.valid, true, `${id} must be both executable and costable`);
  });
  assert.strictEqual(getProductionHandler('unsupported_asset'), null);
  assert.strictEqual(calculateProductionCost({
    approvedProductionSet: { selectedDeliverables: [{ id: 'unsupported_asset' }] },
    usageSnapshot: { used: 0, monthlyLimit: 100, remaining: 100 }
  }).valid, false);

  const claimUser = createUser(db);
  const claimRunId = startRun(db, claimUser);
  const claimed = claimNextRunnableJob(db, claimUser, claimRunId);
  assert(claimed);
  assert.strictEqual(claimed.status, 'running');
  assert.strictEqual(claimed.attempt_count, 1);
  assert.strictEqual(claimNextRunnableJob(db, claimUser, claimRunId), null, 'same/root-blocked run must not yield a second claim');
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE id = ?').get(claimed.id).status, 'running');
  const waiting = db.prepare("SELECT * FROM production_jobs WHERE production_run_id = ? AND status = 'waiting_dependency' LIMIT 1").get(claimRunId);
  assert(waiting);
  const waitingClaim = db.prepare(`
    UPDATE production_jobs SET status = 'running' WHERE id = ? AND status = 'queued'
  `).run(waiting.id);
  assert.strictEqual(waitingClaim.changes, 0);

  const successUser = createUser(db);
  const successRunId = startRun(db, successUser);
  const calls = [];
  const generatorApi = successGenerator(calls);
  const first = await executeNextProductionJob({ db, userId: successUser, productionRunId: successRunId, generatorApi });
  assert.strictEqual(first.outcome, 'completed');
  const firstJob = db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(first.jobId);
  assert.strictEqual(firstJob.status, 'completed');
  assert(firstJob.generation_id);
  assert(firstJob.completed_at);
  const firstGeneration = db.prepare('SELECT * FROM generations WHERE id = ?').get(firstJob.generation_id);
  assert.strictEqual(firstGeneration.generation_type, 'production');
  assert.strictEqual(firstGeneration.user_id, successUser);
  assert(JSON.parse(firstGeneration.results)[0].text);

  const second = await executeNextProductionJob({ db, userId: successUser, productionRunId: successRunId, generatorApi });
  assert.strictEqual(second.outcome, 'completed');
  assert.strictEqual(second.dependencyOutputs.length, 1);
  assert.deepStrictEqual(second.dependencyOutputs[0].result, JSON.parse(firstGeneration.results));
  assert.match(calls[1].productDescription, /Completed prerequisite outputs/);
  assert.match(calls[1].productDescription, /Persisted output 1/);
  assert.match(calls[1].productDescription, /Strategic direction:/);
  assert.match(calls[1].productDescription, /Approved strategy:/);
  assert(calls[1].targetAudience);

  const secondJob = db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(second.jobId);
  const loadedDependencies = loadDependencyOutputs(db, {
    production_run_id: successRunId,
    dependencies: JSON.parse(secondJob.dependencies)
  });
  assert.strictEqual(loadedDependencies[0].deliverableId, firstJob.deliverable_id);

  let result = second;
  let safety = 50;
  while (result.runStatus !== 'completed' && safety > 0) {
    result = await executeNextProductionJob({ db, userId: successUser, productionRunId: successRunId, generatorApi });
    safety -= 1;
  }
  assert(safety > 0, 'production should complete without an execution loop');
  assert.strictEqual(db.prepare('SELECT status FROM production_runs WHERE id = ?').get(successRunId).status, 'completed');
  const successfulJobs = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ?').all(successRunId);
  assert(successfulJobs.every((job) => job.status === 'completed' && job.generation_id));
  const generationsBeforeRepeat = db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(successUser).count;
  const repeat = await executeNextProductionJob({ db, userId: successUser, productionRunId: successRunId, generatorApi });
  assert.strictEqual(repeat.outcome, 'no_runnable_job');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(successUser).count, generationsBeforeRepeat);

  const failedUser = createUser(db);
  const failedRunId = startRun(db, failedUser);
  const prepaid = db.prepare('SELECT production_cost_units FROM production_runs WHERE id = ?').get(failedRunId).production_cost_units;
  const failingGenerator = { generateCopy: () => { throw new Error('provider secret raw failure payload'); } };
  let failureResult = await executeNextProductionJob({ db, userId: failedUser, productionRunId: failedRunId, generatorApi: failingGenerator });
  assert.strictEqual(failureResult.outcome, 'retry_scheduled');
  let failedRoot = db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(failureResult.jobId);
  assert.strictEqual(failedRoot.attempt_count, 1);
  assert.strictEqual(failedRoot.status, 'queued');
  assert.doesNotMatch(failedRoot.error_message, /provider|secret|payload/);
  failureResult = await executeNextProductionJob({ db, userId: failedUser, productionRunId: failedRunId, generatorApi: failingGenerator });
  assert.strictEqual(failureResult.outcome, 'retry_scheduled');
  failureResult = await executeNextProductionJob({ db, userId: failedUser, productionRunId: failedRunId, generatorApi: failingGenerator });
  assert.strictEqual(failureResult.outcome, 'permanent_failure');
  assert.strictEqual(failureResult.reversalCount, prepaid);
  failedRoot = db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(failureResult.jobId);
  assert.strictEqual(failedRoot.status, 'failed');
  assert.strictEqual(failedRoot.attempt_count, 3);
  assert(failedRoot.reversal_usage_event_id);
  assert.doesNotMatch(failedRoot.error_message, /provider|secret|payload/);
  const skipped = db.prepare("SELECT * FROM production_jobs WHERE production_run_id = ? AND status = 'skipped'").all(failedRunId);
  assert.strictEqual(skipped.length, prepaid - 1);
  assert(skipped.every((job) => job.reversal_usage_event_id));
  assert.strictEqual(db.prepare('SELECT status FROM production_runs WHERE id = ?').get(failedRunId).status, 'failed');
  assert.deepStrictEqual(usage(db, failedUser), { units: 0, events: prepaid + 1, period: 0, legacy: 0 });
  const reversalCount = db.prepare("SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ? AND event_type = 'production_reversal'").get(failedUser).count;
  assert.strictEqual(reversalCount, prepaid);
  const repeatedFailure = await executeNextProductionJob({ db, userId: failedUser, productionRunId: failedRunId, generatorApi: failingGenerator });
  assert.strictEqual(repeatedFailure.outcome, 'no_runnable_job');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ? AND event_type = 'production_reversal'").get(failedUser).count, reversalCount);

  const partialUser = createUser(db);
  const partialRunId = startRun(db, partialUser);
  const partialCalls = [];
  await executeNextProductionJob({ db, userId: partialUser, productionRunId: partialRunId, generatorApi: successGenerator(partialCalls) });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await executeNextProductionJob({ db, userId: partialUser, productionRunId: partialRunId, generatorApi: failingGenerator });
  }
  assert.strictEqual(db.prepare('SELECT status FROM production_runs WHERE id = ?').get(partialRunId).status, 'partially_completed');
  assert.strictEqual(usage(db, partialUser).period, 1, 'only the successfully produced job should remain charged');

  const routeUser = createUser(db);
  const routeRunId = startRun(db, routeUser);
  const otherUser = createUser(db);
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-9-route-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:userId', (req, res) => {
    req.session.userId = Number(req.params.userId);
    res.redirect(`/production/${routeRunId}`);
  });
  app.use(createCsrfProtection());
  app.get('/test/token', (req, res) => res.json({ token: req.csrfToken() }));
  app.use(productionRoutes);
  const server = await listen(app);
  const owner = { server, cookie: '' };
  const outsider = { server, cookie: '' };
  try {
    const anonymous = await request({ server, cookie: '' }, 'GET', `/production/${routeRunId}`);
    assert.strictEqual(anonymous.res.statusCode, 302);
    assert.strictEqual(anonymous.res.headers.location, '/login');
    const anonymousExecute = await request({ server, cookie: '' }, 'POST', `/production/${routeRunId}/run-next`);
    assert.strictEqual(anonymousExecute.res.statusCode, 403);

    await request(outsider, 'GET', `/test/authenticate/${otherUser}`);
    assert.strictEqual((await request(outsider, 'GET', `/production/${routeRunId}`)).res.statusCode, 404);
    const outsiderToken = JSON.parse((await request(outsider, 'GET', '/test/token')).body).token;
    assert.strictEqual((await request(outsider, 'POST', `/production/${routeRunId}/run-next`, { _csrf: outsiderToken })).res.statusCode, 404);

    await request(owner, 'GET', `/test/authenticate/${routeUser}`);
    const studioBefore = await request(owner, 'GET', `/production/${routeRunId}`);
    assert.strictEqual(studioBefore.res.statusCode, 200);
    assert.match(studioBefore.body, /0 of \d+ completed/);
    assert.match(studioBefore.body, /Continue Production/);
    assert.doesNotMatch(studioBefore.body, /\d+%|almost done|AI is working/i);
    const token = studioBefore.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const csrfDenied = await request(owner, 'POST', `/production/${routeRunId}/run-next`);
    assert.strictEqual(csrfDenied.res.statusCode, 403);
    const executed = await request(owner, 'POST', `/production/${routeRunId}/run-next`, { _csrf: token });
    assert.strictEqual(executed.res.statusCode, 303);
    assert.strictEqual(executed.res.headers.location, `/production/${routeRunId}`);
    const studioAfter = await request(owner, 'GET', `/production/${routeRunId}`);
    assert.match(studioAfter.body, /1 of \d+ completed/);
    assert.match(studioAfter.body, /View result/);
    assert.match(studioAfter.body, /completed/);
  } finally {
    server.close();
  }

  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM brand_brain').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM subscriptions').get().count, 0);
  console.log('Story 3.9 Production Execution tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
