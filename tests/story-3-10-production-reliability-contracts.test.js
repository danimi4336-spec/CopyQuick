const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-story-3-10-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DATABASE_URL + suffix); } catch (err) { /* Missing file. */ }
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const { calculateProductionCost } = require('../lib/productionCost');
const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { getExecutableDeliverableIds, getProductionHandler } = require('../lib/productionHandlers');
const {
  claimNextRunnableJob,
  executeNextProductionJob,
  loadDependencyOutputs,
  persistCompletedJob,
  recoverExpiredJobs
} = require('../lib/productionExecution');
const productionRoutes = require('../routes/production');

function createUser(db) {
  return Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used, current_period_used)
    VALUES (?, 'Reliability Owner', 'pro', 100, 0, 0)
  `).run(`story-3-10-${Date.now()}-${Math.random()}@example.com`).lastInsertRowid);
}

function createRun(db, userId, jobs) {
  const periodId = Number(db.prepare(`
    INSERT INTO usage_periods (user_id, period_start, period_end, plan_tier, monthly_limit, usage_count)
    VALUES (?, '2026-08-01', '2026-09-01', 'pro', 100, ?)
  `).run(userId, jobs.length).lastInsertRowid);
  db.prepare('UPDATE users SET generations_used = ?, current_period_used = ?, current_usage_period_id = ? WHERE id = ?')
    .run(jobs.length, jobs.length, periodId, userId);
  const runId = Number(db.prepare(`
    INSERT INTO production_runs (
      user_id, objective, status, plan_fingerprint, idempotency_key, approved_at,
      started_at, strategy_snapshot, production_cost_units, usage_period_id
    ) VALUES (?, 'launch_product', 'queued', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)
  `).run(
    userId, `fingerprint-${Math.random()}`, `key-${Math.random()}`,
    JSON.stringify({ primaryCustomer: { value: 'Health-conscious adults' }, communicationStyle: { value: 'Evidence-based' } }),
    jobs.length, periodId
  ).lastInsertRowid);
  const usageEventId = Number(db.prepare(`
    INSERT INTO usage_events (user_id, usage_period_id, production_run_id, event_type, units, source_route)
    VALUES (?, ?, ?, 'production_start', ?, 'test')
  `).run(userId, periodId, runId, jobs.length).lastInsertRowid);
  db.prepare('UPDATE production_runs SET usage_event_id = ? WHERE id = ?').run(usageEventId, runId);
  const insert = db.prepare(`
    INSERT INTO production_jobs (
      production_run_id, deliverable_id, title, phase, sequence_order, status,
      strategic_direction, strategy_snapshot, dependencies, contract_version
    ) VALUES (?, ?, ?, 'foundation', ?, ?, ?, ?, ?, ?)
  `);
  jobs.forEach(function(job, index) {
    const dependencies = job.dependencies || [];
    const contract = getProductionContract(job.id);
    insert.run(
      runId, job.id, job.title || job.id, index,
      dependencies.length ? 'waiting_dependency' : 'queued',
      job.direction || 'Use approved strategy without unsupported claims.',
      JSON.stringify({ primaryCustomer: { value: 'Health-conscious adults' }, communicationStyle: { value: 'Evidence-based' } }),
      JSON.stringify(dependencies), contract?.version || null
    );
  });
  return runId;
}

function generatedPayload(job, contract) {
  return {
    title: job.title, inputText: 'Known facts and approved strategy', contentType: contract.contentType,
    tone: 'professional', results: [{ text: 'Readable result', tone: 'professional' }],
    structuredOutput: contract.normalizeOutput([{ text: 'Canonical result', tone: 'professional' }]),
    contractVersion: contract.version, wordCount: 2, generationType: 'production', goal: 'launch_product'
  };
}

function successfulGenerator(calls) {
  return {
    generateCopy: (input) => {
      calls.push(input);
      return Array.from({ length: 8 }, function(_, index) {
        return { text: `Known output ${index + 1} for ${input.productDescription}`, tone: 'professional' };
      });
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

  const contractIds = getProductionContractIds();
  assert.deepStrictEqual(contractIds.sort(), getExecutableDeliverableIds().sort());
  contractIds.forEach(function(id) {
    const contract = getProductionHandler(id);
    assert(contract.version.match(new RegExp(`^${id}:v\\d+$`)));
    assert.strictEqual(typeof contract.buildPrompt, 'function');
    assert.strictEqual(typeof contract.validateOutput, 'function');
    assert.strictEqual(calculateProductionCost({
      approvedProductionSet: { selectedDeliverables: [{ id }] },
      usageSnapshot: { used: 0, monthlyLimit: 100, remaining: 100 }
    }).valid, true);
  });
  assert.strictEqual(getProductionContract('unknown'), null);

  const leaseUser = createUser(db);
  const leaseRun = createRun(db, leaseUser, [{ id: 'customer_profile' }]);
  const baseTime = new Date('2026-08-25T12:00:00.000Z');
  const firstClaim = claimNextRunnableJob(db, leaseUser, leaseRun, {
    now: baseTime, leaseSeconds: 60, tokenFactory: () => 'claim-one'
  });
  assert.strictEqual(firstClaim.claim_token, 'claim-one');
  assert.strictEqual(firstClaim.claimed_at, baseTime.toISOString());
  assert.strictEqual(firstClaim.lease_expires_at, '2026-08-25T12:01:00.000Z');
  assert.strictEqual(claimNextRunnableJob(db, leaseUser, leaseRun, { now: baseTime }), null);

  const safe = recoverExpiredJobs(db, leaseUser, leaseRun, { now: '2026-08-25T12:01:01.000Z' });
  assert.deepStrictEqual(safe.recovered, [firstClaim.id]);
  let recoveredJob = db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(firstClaim.id);
  assert.strictEqual(recoveredJob.status, 'queued');
  assert.strictEqual(recoveredJob.claim_token, null);
  assert.strictEqual(recoveredJob.attempt_count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE production_run_id = ?').get(leaseRun).count, 1);

  const secondClaim = claimNextRunnableJob(db, leaseUser, leaseRun, {
    now: '2026-08-25T12:02:00.000Z', leaseSeconds: 60, tokenFactory: () => 'claim-two'
  });
  assert.notStrictEqual(secondClaim.claim_token, firstClaim.claim_token);
  db.prepare('UPDATE production_jobs SET provider_started_at = ? WHERE id = ?')
    .run('2026-08-25T12:02:01.000Z', secondClaim.id);
  const ambiguous = recoverExpiredJobs(db, leaseUser, leaseRun, { now: '2026-08-25T12:03:01.000Z' });
  assert.deepStrictEqual(ambiguous.ambiguous, [secondClaim.id]);
  recoveredJob = db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(secondClaim.id);
  assert.strictEqual(recoveredJob.status, 'recovery_required');
  assert.strictEqual(recoveredJob.claim_token, null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE production_run_id = ?').get(leaseRun).count, 1);
  assert.strictEqual(db.prepare('SELECT status FROM production_runs WHERE id = ?').get(leaseRun).status, 'running');

  const normalizedUser = createUser(db);
  const normalizedRun = createRun(db, normalizedUser, [{ id: 'customer_profile' }]);
  const normalizedClaim = claimNextRunnableJob(db, normalizedUser, normalizedRun, {
    now: baseTime, leaseSeconds: 10, tokenFactory: () => 'normalize-token'
  });
  const canonicalId = Number(db.prepare(`
    INSERT INTO generations (
      user_id, title, input_text, content_type, results, production_job_id,
      deliverable_id, contract_version, structured_result, generation_type
    ) VALUES (?, 'Customer Profile', 'input', 'sales_message', ?, ?, 'customer_profile', 'customer_profile:v1', ?, 'production')
  `).run(
    normalizedUser, JSON.stringify([{ text: 'Canonical readable output', tone: 'professional' }]), normalizedClaim.id,
    JSON.stringify({ summary: 'Known', primaryCustomer: 'Known customer', needs: ['Need'], motivations: ['Motivation'], objections: ['Objection'], buyingTriggers: ['Trigger'], languageStyle: 'Clear' })
  ).lastInsertRowid);
  db.prepare('UPDATE production_jobs SET provider_started_at = ? WHERE id = ?').run(baseTime.toISOString(), normalizedClaim.id);
  const normalized = recoverExpiredJobs(db, normalizedUser, normalizedRun, { now: '2026-08-25T12:00:11.000Z' });
  assert.deepStrictEqual(normalized.normalized, [normalizedClaim.id]);
  const normalizedJob = db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(normalizedClaim.id);
  assert.strictEqual(normalizedJob.status, 'completed');
  assert.strictEqual(normalizedJob.generation_id, canonicalId);
  assert.strictEqual(normalizedJob.claim_token, null);

  const staleUser = createUser(db);
  const staleRunId = createRun(db, staleUser, [{ id: 'customer_profile' }]);
  const staleClaim = claimNextRunnableJob(db, staleUser, staleRunId, { claimToken: 'stale-token' });
  db.prepare("UPDATE production_jobs SET claim_token = 'replacement-token' WHERE id = ?").run(staleClaim.id);
  const staleRun = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(staleRunId);
  assert.throws(function() {
    persistCompletedJob(db, staleRun, staleClaim, generatedPayload(staleClaim, getProductionContract('customer_profile')));
  }, /ownership was lost/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE production_job_id = ?').get(staleClaim.id).count, 0);

  const foundationUser = createUser(db);
  const foundationRun = createRun(db, foundationUser, [
    { id: 'customer_profile' },
    { id: 'product_positioning', dependencies: ['customer_profile'], direction: 'Premium and evidence-aware.' },
    { id: 'value_proposition', dependencies: ['customer_profile', 'product_positioning'] },
    { id: 'core_messaging', dependencies: ['customer_profile', 'product_positioning', 'value_proposition'] },
    { id: 'launch_announcement', dependencies: ['core_messaging'] }
  ]);
  const calls = [];
  for (let index = 0; index < 5; index += 1) {
    const result = await executeNextProductionJob({ db, userId: foundationUser, productionRunId: foundationRun, generatorApi: successfulGenerator(calls) });
    assert.strictEqual(result.outcome, 'completed');
  }
  const foundationRows = db.prepare(`
    SELECT production_jobs.*, generations.structured_result, generations.contract_version AS generation_contract
    FROM production_jobs JOIN generations ON generations.id = production_jobs.generation_id
    WHERE production_jobs.production_run_id = ? ORDER BY production_jobs.sequence_order
  `).all(foundationRun);
  const expectedFields = {
    customer_profile: ['summary', 'primaryCustomer', 'needs', 'motivations', 'objections', 'buyingTriggers', 'languageStyle'],
    product_positioning: ['positioningStatement', 'marketPosition', 'differentiation', 'proofPoints', 'positioningPillars', 'messagingImplications'],
    value_proposition: ['primaryValueProposition', 'customerProblemOrDesire', 'promisedOutcome', 'reasonsToBelieve', 'differentiators', 'supportingMessages'],
    core_messaging: ['coreMessage', 'messagePillars', 'supportingPoints', 'toneGuidance', 'proofThemes', 'callsToAction']
  };
  foundationRows.slice(0, 4).forEach(function(row) {
    const output = JSON.parse(row.structured_result);
    expectedFields[row.deliverable_id].forEach(function(field) { assert(Object.hasOwn(output, field)); });
    assert.strictEqual(row.contract_version, `${row.deliverable_id}:v1`);
    assert.strictEqual(row.generation_contract, row.contract_version);
    assert.doesNotMatch(JSON.stringify(output), /age 35|\$100,000|female|male/i);
  });
  assert.match(calls[1].productDescription, /customer_profile:v1/);
  assert.match(calls[1].productDescription, /Completed prerequisite outputs \(structured\)/);
  assert.match(calls[1].productDescription, /Premium and evidence-aware/);
  assert.match(calls[4].productDescription, /core_messaging:v1/);
  const downstreamJob = foundationRows[4];
  const dependencyOutputs = loadDependencyOutputs(db, {
    production_run_id: foundationRun,
    dependencies: JSON.parse(downstreamJob.dependencies)
  });
  assert(dependencyOutputs[0].output.coreMessage);
  assert.strictEqual(dependencyOutputs[0].contractVersion, 'core_messaging:v1');

  const validationUser = createUser(db);
  const validationRun = createRun(db, validationUser, [{ id: 'customer_profile' }]);
  const malformedGenerator = {
    generateCopy: () => [{ text: 'Malformed', tone: 'professional', structuredOutput: { summary: 'Incomplete' } }]
  };
  let validationResult;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    validationResult = await executeNextProductionJob({ db, userId: validationUser, productionRunId: validationRun, generatorApi: malformedGenerator });
  }
  assert.strictEqual(validationResult.outcome, 'permanent_failure');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(validationUser).count, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ? AND event_type = 'production_reversal'").get(validationUser).count, 1);
  assert.strictEqual(db.prepare('SELECT generations_used FROM users WHERE id = ?').get(validationUser).generations_used, 0);

  const routeUser = createUser(db);
  const routeRun = createRun(db, routeUser, [{ id: 'customer_profile' }]);
  db.prepare(`
    UPDATE production_jobs SET status = 'recovery_required', error_message = ?, recovery_reason = ?, claim_token = NULL
    WHERE production_run_id = ?
  `).run(
    'This item was interrupted while being created. CopyQuick needs to safely verify it before trying again.',
    'Provider invocation may have completed without a persisted result.', routeRun
  );
  const outsider = createUser(db);
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-10-route-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate/:userId', (req, res) => { req.session.userId = Number(req.params.userId); res.redirect(`/production/${routeRun}`); });
  app.use(createCsrfProtection());
  app.use(productionRoutes);
  const server = await listen(app);
  const ownerAgent = { server, cookie: '' };
  const outsiderAgent = { server, cookie: '' };
  try {
    assert.strictEqual((await request({ server, cookie: '' }, 'GET', `/production/${routeRun}`)).res.statusCode, 302);
    await request(ownerAgent, 'GET', `/test/authenticate/${routeUser}`);
    const studio = await request(ownerAgent, 'GET', `/production/${routeRun}`);
    assert.strictEqual(studio.res.statusCode, 200);
    assert.match(studio.body, /recovery required/i);
    assert.match(studio.body, /safely verify/i);
    assert.doesNotMatch(studio.body, /claim-token|claim_token|Provider invocation/i);
    assert.strictEqual((await request(ownerAgent, 'POST', `/production/${routeRun}/run-next`)).res.statusCode, 403);
    await request(outsiderAgent, 'GET', `/test/authenticate/${outsider}`);
    assert.strictEqual((await request(outsiderAgent, 'GET', `/production/${routeRun}`)).res.statusCode, 404);
  } finally {
    server.close();
  }

  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM brand_brain').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM subscriptions').get().count, 0);
  console.log('Story 3.10 Production Reliability & Contracts tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
