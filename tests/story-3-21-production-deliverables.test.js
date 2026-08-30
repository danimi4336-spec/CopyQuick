const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-3-21-'));
process.env.DATABASE_PATH = path.join(root, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { executeNextProductionJob, loadDependencyOutputs } = require('../lib/productionExecution');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

function render(view, locals) {
  return new Promise((resolve, reject) => ejs.renderFile(path.join(__dirname, '..', 'views', view), locals, {}, (error, html) => error ? reject(error) : resolve(html)));
}

function createRun(db, jobs) {
  const userId = Number(db.prepare("INSERT INTO users (email, name, plan_tier, monthly_limit) VALUES (?, 'Studio Owner', 'pro', 100)").run(`studio-${Date.now()}@example.com`).lastInsertRowid);
  const periodId = Number(db.prepare("INSERT INTO usage_periods (user_id, period_start, period_end, plan_tier, monthly_limit, usage_count) VALUES (?, '2026-08-01', '2026-09-01', 'pro', 100, ?)").run(userId, jobs.length).lastInsertRowid);
  db.prepare('UPDATE users SET current_usage_period_id = ?, generations_used = ?, current_period_used = ? WHERE id = ?').run(periodId, jobs.length, jobs.length, userId);
  const runId = Number(db.prepare(`INSERT INTO production_runs (user_id, objective, status, plan_fingerprint, idempotency_key, approved_at, started_at, strategy_snapshot, production_cost_units, usage_period_id) VALUES (?, 'launch_product', 'queued', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)`).run(userId, `f-${Math.random()}`, `k-${Math.random()}`, JSON.stringify({ primaryCustomer: { value: 'Independent retailers' }, communicationStyle: { value: 'Clear and practical' }, marketPosition: { value: 'Trusted premium choice' }, competitiveApproach: { value: 'Service and proof' } }), jobs.length, periodId).lastInsertRowid);
  const insert = db.prepare(`INSERT INTO production_jobs (production_run_id, deliverable_id, title, phase, sequence_order, status, strategic_direction, strategy_snapshot, dependencies, contract_version, max_attempts) VALUES (?, ?, ?, 'foundation', ?, ?, 'Create useful customer-ready work.', ?, ?, ?, 3)`);
  jobs.forEach((job, index) => insert.run(runId, job.id, job.title, index, job.dependencies?.length ? 'waiting_dependency' : 'queued', JSON.stringify({ primaryCustomer: { value: 'Independent retailers' }, communicationStyle: { value: 'Clear and practical' } }), JSON.stringify(job.dependencies || []), getProductionContract(job.id).version));
  return { userId, runId };
}

function customerProfile(overrides = {}) {
  return { summary: 'Independent retailers need a dependable way to launch clearly.', primaryCustomer: 'Independent retailers', needs: ['A clear launch plan'], motivations: ['Confident growth'], objections: ['Unproven claims'], buyingTriggers: ['Clear evidence'], languageStyle: 'Direct and practical', ...overrides };
}

async function run() {
  initDb();
  const db = getDb();
  const profileContract = getProductionContract('customer_profile');

  assert.strictEqual(validateCustomerReadyOutput(customerProfile(), profileContract).valid, true);
  assert.strictEqual(validateCustomerReadyOutput(customerProfile({ summary: 'Create the approved Customer Profile deliverable.' }), profileContract).code, 'PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK');
  assert.strictEqual(validateCustomerReadyOutput(customerProfile({ needs: ['{"primaryCustomer":"Retailers","needs":["Growth"]}'] }), profileContract).code, 'PRODUCTION_QUALITY_SERIALIZED_CONTEXT_LEAK');

  const valid = createRun(db, [{ id: 'customer_profile', title: 'Customer Profile' }]);
  const validResult = await executeNextProductionJob({ db, userId: valid.userId, productionRunId: valid.runId, generatorApi: { generateCopy: () => [{ text: 'Customer profile', tone: 'professional', structuredOutput: customerProfile() }] } });
  assert.strictEqual(validResult.outcome, 'completed');
  assert.strictEqual(db.prepare('SELECT status FROM production_jobs WHERE production_run_id = ?').get(valid.runId).status, 'completed');

  const invalid = createRun(db, [{ id: 'customer_profile', title: 'Customer Profile' }, { id: 'product_positioning', title: 'Product Positioning', dependencies: ['customer_profile'] }]);
  const leakingGenerator = { generateCopy: () => [{ text: 'bad', tone: 'professional', structuredOutput: customerProfile({ summary: 'Completed prerequisite outputs (structured): {"needs":["growth"]}' }) }] };
  let failed;
  for (let attempt = 0; attempt < 3; attempt += 1) failed = await executeNextProductionJob({ db, userId: invalid.userId, productionRunId: invalid.runId, generatorApi: leakingGenerator });
  assert.strictEqual(failed.outcome, 'permanent_failure');
  const invalidJobs = db.prepare('SELECT status FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(invalid.runId);
  assert.deepStrictEqual(invalidJobs.map(row => row.status), ['failed', 'skipped']);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(invalid.userId).count, 0);

  const tampered = createRun(db, [{ id: 'customer_profile', title: 'Customer Profile' }, { id: 'product_positioning', title: 'Product Positioning', dependencies: ['customer_profile'] }]);
  const upstream = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? AND deliverable_id = ?').get(tampered.runId, 'customer_profile');
  const generationId = Number(db.prepare(`INSERT INTO generations (user_id, title, input_text, content_type, tone, results, generation_type, production_job_id, deliverable_id, contract_version, structured_result) VALUES (?, 'Customer Profile', 'internal', 'sales_message', 'professional', '[]', 'production', ?, 'customer_profile', ?, ?)`).run(tampered.userId, upstream.id, profileContract.version, JSON.stringify(customerProfile({ summary: 'Use known facts as facts.' }))).lastInsertRowid);
  db.prepare("UPDATE production_jobs SET status = 'completed', generation_id = ? WHERE id = ?").run(generationId, upstream.id);
  const downstream = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? AND deliverable_id = ?').get(tampered.runId, 'product_positioning');
  assert.throws(() => loadDependencyOutputs(db, { ...downstream, dependencies: JSON.parse(downstream.dependencies) }), error => error.code === 'DEPENDENCY_QUALITY_INVALID');

  const studioHtml = await render('production-studio.ejs', {
    production: { id: 1, status: 'running', jobs: [], production_cost_units: 2, started_at: 'now' },
    phases: [{ title: 'Foundation', jobs: [
      { sequence_order: 0, title: 'Done', strategic_direction: 'Direction', dependencies: ['one'], status: 'completed', generation_id: 7, error_message: null },
      { sequence_order: 1, title: 'Waiting', strategic_direction: 'Direction', dependencies: ['one', 'two'], status: 'waiting_dependency', generation_id: null, error_message: null }
    ] }], completedCount: 1, executionNotice: null, hasExpiredLease: false, csrfToken: 'test'
  });
  assert.match(studioHtml, /View Deliverable →/);
  assert.strictEqual((studioHtml.match(/class="production-result-link"/g) || []).length, 1);
  assert.strictEqual((studioHtml.match(/Waiting for 2 prerequisites\./g) || []).length, 1);
  assert.doesNotMatch(studioHtml, /Waiting for 1 prerequisite/);
  assert.match(studioHtml, /if \(!resultLink\)/);
  assert.doesNotMatch(studioHtml, /production-job-statusstatus-/);

  const productionHtml = await render('generation.ejs', {
    gen: { id: 7, title: 'Product Positioning', input_text: 'SECRET INTERNAL PROMPT', content_type: 'sales_message', tone: 'professional', favorite: 0, word_count: 20, created_at: new Date().toISOString() },
    results: [], productionDeliverable: { runId: 1, customerReady: true, sections: [{ label: 'Positioning Statement', value: 'A clear position for retailers.', isList: false }] }
  });
  assert.doesNotMatch(productionHtml, /SECRET INTERNAL PROMPT|<h3>Prompt<\/h3>/);
  assert.match(productionHtml, /Back to Production Plan|Production Plan/);
  assert.match(productionHtml, /Positioning Statement/);

  const ordinaryHtml = await render('generation.ejs', {
    gen: { id: 8, title: 'Quick Copy', input_text: 'Ordinary customer prompt', content_type: 'social_post', tone: 'friendly', favorite: 0, word_count: 4, created_at: new Date().toISOString() },
    results: [{ text: 'Ordinary result', tone: 'friendly' }], productionDeliverable: null
  });
  assert.match(ordinaryHtml, /Ordinary customer prompt/);
  assert.match(ordinaryHtml, /Regenerate/);

  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Story 3.21 production deliverables tests passed.');
}

run().catch(error => {
  fs.rmSync(root, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
