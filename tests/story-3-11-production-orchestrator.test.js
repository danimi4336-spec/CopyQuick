const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-story-3-11-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DATABASE_URL + suffix); } catch (err) { /* Missing file. */ }
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createApprovedProductionSet, createDefaultSelection, planFingerprint } = require('../lib/buildPlanApproval');
const { initializeProduction } = require('../lib/productionInitialization');
const { claimNextRunnableJob, renewJobLease } = require('../lib/productionExecution');
const { maxConcurrency, runOrchestratorCycle } = require('../lib/productionOrchestrator');
const { createProductionWorker } = require('../lib/productionWorker');
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
    competitiveDifferentiation: confirmed('partial', 'Different in a few ways'),
    launchStage: confirmed('development', 'In development'),
    brand: confirmed('new', 'New')
  };
  const answers = { initial_description: 'Organic turmeric supplement' };
  const strategyResult = buildStrategy({ objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers });
  const plan = buildPlan({ objective: 'launch_product', confirmedUnderstanding: understanding, strategyResult, answers });
  const selection = createDefaultSelection(plan);
  const approval = createApprovedProductionSet({ plan, selection, strategyResult });
  selection.approvedAt = approval.approvedAt;
  const now = new Date().toISOString();
  return {
    objective: 'launch_product', planningReadiness: { ready: true }, planningConfirmedAt: now,
    confirmedUnderstanding: understanding, strategyResult, strategyUpdatedAt: now,
    buildPlan: plan, buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
    buildPlanFingerprint: planFingerprint(plan), buildPlanSelection: selection,
    approvedProductionSet: approval.productionSet
  };
}

function createUser(db) {
  return Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, 'Orchestrator Owner', 'pro', 100, 0)
  `).run(`story-3-11-${Date.now()}-${Math.random()}@example.com`).lastInsertRowid);
}

function startProduction(db, userId) {
  const result = initializeProduction({
    db, user: db.prepare('SELECT * FROM users WHERE id = ?').get(userId), discoverySession: discoveryState()
  });
  assert.strictEqual(result.valid, true);
  return result.productionRunId;
}

function generator(calls, behavior) {
  return {
    generateCopy: async (input) => {
      calls.push(input);
      if (behavior) return behavior(input, calls.length);
      return Array.from({ length: 8 }, function(_, index) {
        return { text: `Orchestrated result ${index + 1}`, tone: 'professional' };
      });
    }
  };
}

function usage(db, userId) {
  return {
    events: db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count,
    units: db.prepare('SELECT COALESCE(SUM(units), 0) AS units FROM usage_events WHERE user_id = ?').get(userId).units,
    period: db.prepare('SELECT COALESCE(SUM(usage_count), 0) AS count FROM usage_periods WHERE user_id = ?').get(userId).count
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
      if (res.headers['set-cookie']) agent.cookie = res.headers['set-cookie'].map((cookie) => cookie.split(';')[0]).join('; ');
      let response = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { response += chunk; });
      res.on('end', () => resolve({ res, body: response }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function run() {
  initDb();
  const db = getDb();
  assert.strictEqual(maxConcurrency(), 1);

  const owner = createUser(db);
  const runId = startProduction(db, owner);
  const prepaid = usage(db, owner);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(owner).count, 0,
    'production initialization must not synchronously execute jobs');

  const calls = [];
  const worker = createProductionWorker({ db, generatorApi: generator(calls), concurrency: 1 });
  let cycle = await worker.cycle();
  assert.strictEqual(cycle.workPerformed, 1);
  assert.strictEqual(calls.length, 1, 'worker executes without a browser or session');
  let jobs = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(runId);
  assert.strictEqual(jobs[0].status, 'completed');
  assert.strictEqual(jobs[1].status, 'queued', 'completion automatically unlocks its dependent');

  let safety = 50;
  while (db.prepare('SELECT status FROM production_runs WHERE id = ?').get(runId).status !== 'completed' && safety > 0) {
    cycle = await worker.cycle();
    safety -= 1;
  }
  assert(safety > 0);
  assert.strictEqual(db.prepare('SELECT status FROM production_runs WHERE id = ?').get(runId).status, 'completed');
  jobs = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(runId);
  assert(jobs.every((job) => job.status === 'completed'));
  assert.deepStrictEqual(usage(db, owner), prepaid, 'automatic work creates no additional charge');

  const leaseOwner = createUser(db);
  const leaseRun = startProduction(db, leaseOwner);
  const leaseTime = new Date();
  const claim = claimNextRunnableJob(db, leaseOwner, leaseRun, {
    now: leaseTime, leaseSeconds: 30, claimToken: 'current-claim'
  });
  const renewed = renewJobLease(db, claim.id, claim.claim_token, {
    now: new Date(leaseTime.getTime() + 10000), leaseSeconds: 30
  });
  assert.strictEqual(renewed.renewed, true);
  assert(Date.parse(renewed.leaseExpiresAt) > Date.parse(claim.lease_expires_at));
  assert.strictEqual(renewJobLease(db, claim.id, 'stale-claim', { leaseSeconds: 30 }).renewed, false);
  db.prepare("UPDATE production_jobs SET status = 'completed', claim_token = NULL WHERE id = ?").run(claim.id);
  assert.strictEqual(renewJobLease(db, claim.id, 'current-claim', { leaseSeconds: 30 }).renewed, false);

  const retryOwner = createUser(db);
  const retryRun = startProduction(db, retryOwner);
  let providerCalls = 0;
  const retryGenerator = generator([], function() {
    providerCalls += 1;
    if (providerCalls === 1) throw new Error('temporary secret provider detail');
    return [{ text: 'Recovered retry output', tone: 'professional' }];
  });
  const retryStart = new Date();
  const failedCycle = await runOrchestratorCycle({
    db, generatorApi: retryGenerator, now: retryStart, concurrency: 1, retryBaseSeconds: 10
  });
  assert.strictEqual(failedCycle.results[0].outcome, 'retry_scheduled');
  const retryJob = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order LIMIT 1').get(retryRun);
  assert.strictEqual(retryJob.status, 'queued');
  assert.strictEqual(retryJob.next_attempt_at, new Date(retryStart.getTime() + 10000).toISOString());
  assert.strictEqual((await runOrchestratorCycle({
    db, generatorApi: retryGenerator, now: new Date(retryStart.getTime() + 9000), concurrency: 1, retryBaseSeconds: 10
  })).workPerformed, 0);
  assert.strictEqual(providerCalls, 1);
  assert.strictEqual((await runOrchestratorCycle({
    db, generatorApi: retryGenerator, now: new Date(retryStart.getTime() + 11000), concurrency: 1, retryBaseSeconds: 10
  })).results[0].outcome, 'completed');
  assert.strictEqual(providerCalls, 2);
  assert.strictEqual(usage(db, retryOwner).events, 1);

  db.prepare("UPDATE production_runs SET status = 'completed' WHERE status IN ('queued', 'running')").run();

  const recoveryOwner = createUser(db);
  const recoveryRun = startProduction(db, recoveryOwner);
  const recoveryJobs = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(recoveryRun);
  db.prepare(`
    UPDATE production_jobs SET status = 'running', claim_token = 'abandoned',
      claimed_at = datetime('now', '-10 minutes'), lease_expires_at = datetime('now', '-5 minutes'),
      provider_started_at = datetime('now', '-9 minutes') WHERE id = ?
  `).run(recoveryJobs[0].id);
  const recoveryCalls = [];
  await runOrchestratorCycle({ db, generatorApi: generator(recoveryCalls), concurrency: 1 });
  const ambiguous = db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(recoveryJobs[0].id);
  assert.strictEqual(ambiguous.status, 'recovery_required');
  assert.strictEqual(recoveryCalls.length, 0, 'ambiguous work is never automatically regenerated');
  assert.strictEqual(db.prepare('SELECT status FROM production_runs WHERE id = ?').get(recoveryRun).status, 'blocked');
  assert.strictEqual(usage(db, recoveryOwner).events, 1, 'lease recovery changes no accounting');

  const safeOwner = createUser(db);
  const safeRun = startProduction(db, safeOwner);
  const safeJob = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order LIMIT 1').get(safeRun);
  db.prepare(`
    UPDATE production_jobs SET status = 'running', claim_token = 'safe-abandoned',
      claimed_at = datetime('now', '-10 minutes'), lease_expires_at = datetime('now', '-5 minutes'),
      provider_started_at = NULL WHERE id = ?
  `).run(safeJob.id);
  const safeCalls = [];
  const resumed = await runOrchestratorCycle({ db, generatorApi: generator(safeCalls), concurrency: 1 });
  assert.strictEqual(resumed.results[0].outcome, 'completed');
  assert.strictEqual(safeCalls.length, 1);

  db.prepare("UPDATE production_runs SET status = 'completed' WHERE status IN ('queued', 'running')").run();

  const fairOwnerA = createUser(db);
  const fairOwnerB = createUser(db);
  const fairRunA = startProduction(db, fairOwnerA);
  const fairRunB = startProduction(db, fairOwnerB);
  const fairnessCalls = [];
  const fairOne = await runOrchestratorCycle({ db, generatorApi: generator(fairnessCalls), concurrency: 1 });
  const fairTwo = await runOrchestratorCycle({ db, generatorApi: generator(fairnessCalls), concurrency: 1 });
  assert.notStrictEqual(fairOne.results[0].productionRunId, fairTwo.results[0].productionRunId);
  assert([fairRunA, fairRunB].includes(fairOne.results[0].productionRunId));
  assert([fairRunA, fairRunB].includes(fairTwo.results[0].productionRunId));

  db.prepare("UPDATE production_runs SET status = 'completed' WHERE status IN ('queued', 'running')").run();

  const raceOwner = createUser(db);
  const raceRun = startProduction(db, raceOwner);
  const raceCalls = [];
  const delayedGenerator = generator(raceCalls, async function() {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [{ text: 'Single claimed result', tone: 'professional' }];
  });
  const raceResults = await Promise.all([
    runOrchestratorCycle({ db, generatorApi: delayedGenerator, concurrency: 1 }),
    runOrchestratorCycle({ db, generatorApi: delayedGenerator, concurrency: 1 })
  ]);
  assert.strictEqual(raceCalls.length, 1);
  assert.strictEqual(raceResults.reduce((sum, item) => sum + item.workPerformed, 0), 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(raceOwner).count, 1);

  const eventTypes = db.prepare(`
    SELECT DISTINCT event_type FROM production_job_events WHERE production_run_id = ?
  `).all(runId).map((row) => row.event_type);
  ['job_created', 'job_claimed', 'job_started', 'job_completed'].forEach(function(type) {
    assert(eventTypes.includes(type), `missing ${type} event`);
  });
  const retryEvents = db.prepare('SELECT * FROM production_job_events WHERE production_run_id = ?').all(retryRun);
  assert(retryEvents.some((event) => event.event_type === 'job_retry_scheduled'));
  const recoveryEvents = db.prepare('SELECT * FROM production_job_events WHERE production_run_id = ?').all(recoveryRun);
  assert(recoveryEvents.some((event) => event.event_type === 'recovery_required'));
  assert.doesNotMatch(JSON.stringify(retryEvents.concat(recoveryEvents)), /temporary secret|Orchestrated result/i);

  const statusOwner = createUser(db);
  const statusRun = startProduction(db, statusOwner);
  const otherUser = createUser(db);
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-11-route-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:userId', (req, res) => { req.session.userId = Number(req.params.userId); res.redirect(`/production/${statusRun}`); });
  app.use(createCsrfProtection());
  app.use(productionRoutes);
  const server = await listen(app);
  const ownerAgent = { server, cookie: '' };
  const otherAgent = { server, cookie: '' };
  try {
    assert.strictEqual((await request({ server, cookie: '' }, 'GET', `/production/${statusRun}/status`)).res.statusCode, 302);
    await request(ownerAgent, 'GET', `/test/authenticate/${statusOwner}`);
    const statusResponse = await request(ownerAgent, 'GET', `/production/${statusRun}/status`);
    assert.strictEqual(statusResponse.res.statusCode, 200);
    const payload = JSON.parse(statusResponse.body);
    assert.strictEqual(payload.totalCount, db.prepare('SELECT COUNT(*) AS count FROM production_jobs WHERE production_run_id = ?').get(statusRun).count);
    assert.strictEqual(payload.completedCount, 0);
    assert(!JSON.stringify(payload).includes('claim_token'));
    assert(!JSON.stringify(payload).includes('lease_expires_at'));
    await request(otherAgent, 'GET', `/test/authenticate/${otherUser}`);
    assert.strictEqual((await request(otherAgent, 'GET', `/production/${statusRun}/status`)).res.statusCode, 404);
    const studio = await request(ownerAgent, 'GET', `/production/${statusRun}`);
    assert.match(studio.body, /\/production\/.*\/status/);
    assert.match(studio.body, /Production continues automatically/);
    assert.doesNotMatch(studio.body, /\d+%|AI is working|almost done/i);
  } finally {
    server.close();
  }

  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM brand_brain').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM subscriptions').get().count, 0);
  await worker.stop();
  console.log('Story 3.11 Automated Production Orchestrator tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
