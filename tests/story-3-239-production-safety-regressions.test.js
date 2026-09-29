const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-story-3-239-production-safety.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DATABASE_URL + suffix); } catch (_) { /* absent */ }
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const generator = require('../lib/generator');
const { executeNextProductionJob } = require('../lib/productionExecution');
const { getProductionContract } = require('../lib/productionContracts');
const { buildProductionContext } = require('../lib/generationService');
const { generateResearchEvidencePack } = require('../lib/productionResearchEvidence');
const { createResearchOperations, operationalCategory } = require('../lib/researchOperations');

const brief = {
  summary: 'One evidence-aware article brief.', content: ['Use one selected question.'],
  specificTopic: 'invoicing and cash-flow visibility',
  readerQuestion: 'How can a small business use an invoicing routine to improve cash-flow visibility?',
  searchIntentHypothesis: 'Practical guidance', contentAngle: 'A repeatable invoicing review workflow.',
  scope: 'General education without tax or product-capability claims.', callToActionStatus: 'Not established',
  evidenceLimits: ['Do not invent current requirements, metrics, studies, or product capabilities.']
};
const snapshot = { primaryCustomer: { value: 'Small business owners' }, confirmedOffer: { value: 'Online accounting software' } };

function createRun(db, deliverables) {
  const userId = Number(db.prepare("INSERT INTO users(email,name,plan_tier,monthly_limit) VALUES(?, 'Owner', 'pro', 100)").run(`story-3239-${Math.random()}@example.test`).lastInsertRowid);
  const periodId = Number(db.prepare("INSERT INTO usage_periods(user_id,period_start,period_end,plan_tier,monthly_limit,usage_count) VALUES(?,'2026-09-01','2026-10-01','pro',100,?)").run(userId, deliverables.length).lastInsertRowid);
  const runId = Number(db.prepare("INSERT INTO production_runs(user_id,objective,status,plan_fingerprint,idempotency_key,approved_at,started_at,strategy_snapshot,production_cost_units,usage_period_id) VALUES(?,'improve_search_rankings','queued',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?,?)").run(userId, `fp-${Math.random()}`, `key-${Math.random()}`, JSON.stringify(snapshot), deliverables.length, periodId).lastInsertRowid);
  const eventId = Number(db.prepare("INSERT INTO usage_events(user_id,usage_period_id,production_run_id,event_type,units,source_route) VALUES(?,?,?,'production_start',?,'test')").run(userId, periodId, runId, deliverables.length).lastInsertRowid);
  db.prepare('UPDATE production_runs SET usage_event_id=? WHERE id=?').run(eventId, runId);
  const insert = db.prepare("INSERT INTO production_jobs(production_run_id,deliverable_id,title,phase,sequence_order,status,strategic_direction,strategy_snapshot,dependencies,contract_version) VALUES(?,?,?,'create',?,?,?,?,?,?)");
  deliverables.forEach((item, index) => insert.run(runId, item.id, getProductionContract(item.id).title, index, item.status, 'Use bounded evidence.', JSON.stringify(snapshot), JSON.stringify(item.dependencies || []), getProductionContract(item.id).version));
  return { userId, runId };
}

function complete(db, runId, deliverableId, output) {
  const job = db.prepare('SELECT * FROM production_jobs WHERE production_run_id=? AND deliverable_id=?').get(runId, deliverableId);
  const contract = getProductionContract(deliverableId);
  const generationId = Number(db.prepare("INSERT INTO generations(user_id,title,input_text,content_type,tone,ai_model,results,word_count,goal,generation_type,production_job_id,deliverable_id,contract_version,structured_result) SELECT user_id,?,'fixture',?,'professional','deterministic','[]',1,objective,'production',?,?,?,? FROM production_runs WHERE id=?").run(contract.title, contract.contentType, job.id, deliverableId, contract.version, JSON.stringify(output), runId).lastInsertRowid);
  db.prepare("UPDATE production_jobs SET status='completed',generation_id=?,completed_at=CURRENT_TIMESTAMP WHERE id=?").run(generationId, job.id);
}

(async () => {
  initDb(); const db = getDb();

  const ambiguousRun = createRun(db, [
    { id: 'priority_content_brief', status: 'completed' },
    { id: 'research_evidence_pack', status: 'waiting_dependency', dependencies: ['priority_content_brief'] }
  ]);
  complete(db, ambiguousRun.runId, 'priority_content_brief', brief);
  db.prepare("UPDATE production_jobs SET status='queued' WHERE production_run_id=? AND deliverable_id='research_evidence_pack'").run(ambiguousRun.runId);
  const previousKey = process.env.OPENAI_API_KEY; const previousEnabled = process.env.OPENAI_RESEARCH_ENABLED; const previousFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key-not-live';
  process.env.OPENAI_RESEARCH_ENABLED = 'true';
  let openAICalls = 0; let exaCalls = 0;
  global.fetch = async url => {
    if (String(url).includes('api.openai.com')) openAICalls += 1;
    else exaCalls += 1;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ status: 'incomplete' }) };
  };
  const ambiguous = await executeNextProductionJob({ db, userId: ambiguousRun.userId, productionRunId: ambiguousRun.runId, generatorApi: generator });
  const afterAmbiguous = await executeNextProductionJob({ db, userId: ambiguousRun.userId, productionRunId: ambiguousRun.runId, generatorApi: generator });
  global.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  if (previousEnabled === undefined) delete process.env.OPENAI_RESEARCH_ENABLED; else process.env.OPENAI_RESEARCH_ENABLED = previousEnabled;
  const ambiguousJob = db.prepare("SELECT status,attempt_count FROM production_jobs WHERE production_run_id=? AND deliverable_id='research_evidence_pack'").get(ambiguousRun.runId);
  assert.strictEqual(ambiguous.outcome, 'recovery_required'); assert.strictEqual(afterAmbiguous.outcome, 'no_runnable_job');
  assert.strictEqual(ambiguousJob.status, 'recovery_required'); assert.strictEqual(ambiguousJob.attempt_count, 1);
  assert.strictEqual(openAICalls, 1); assert.strictEqual(exaCalls, 0);
  const uncertain = createResearchOperations(); const uncertainAttempt = uncertain.reserve('web_search', { needKey: 'ambiguous-paid-operation' });
  uncertain.reconcile(uncertainAttempt, { failureCode: 'RESEARCH_PROVIDER_AMBIGUOUS', providerCategory: 'openai' });
  assert.strictEqual(uncertain.summary('PROVIDER_UNAVAILABLE').unknownCostOperationCount, 1);

  const packContext = buildProductionContext({ productionRun: { objective: 'improve_search_rankings', strategySnapshot: snapshot }, job: { deliverable_id: 'research_evidence_pack', title: 'Research Evidence Pack', strategic_direction: 'Use bounded evidence.', strategySnapshot: snapshot, contract_version: 'research_evidence_pack:v3' }, dependencyOutputs: [{ deliverableId: 'priority_content_brief', output: brief }] });
  const pack = await generateResearchEvidencePack(packContext);
  const reuseRun = createRun(db, [
    { id: 'priority_content_brief', status: 'completed' },
    { id: 'research_evidence_pack', status: 'completed', dependencies: ['priority_content_brief'] },
    { id: 'priority_search_article', status: 'queued', dependencies: ['priority_content_brief', 'research_evidence_pack'] }
  ]);
  complete(db, reuseRun.runId, 'priority_content_brief', brief); complete(db, reuseRun.runId, 'research_evidence_pack', pack);
  const calls = { openai: 0, exa: 0, parser: 0 }; const fetchBeforeArticle = global.fetch;
  global.fetch = async url => { if (String(url).includes('api.openai.com')) calls.openai += 1; else calls.exa += 1; throw new Error('Research provider must not run'); };
  const article = await executeNextProductionJob({ db, userId: reuseRun.userId, productionRunId: reuseRun.runId, generatorApi: generator });
  const repeated = await executeNextProductionJob({ db, userId: reuseRun.userId, productionRunId: reuseRun.runId, generatorApi: generator });
  global.fetch = fetchBeforeArticle;
  assert.strictEqual(article.outcome, 'completed'); assert.strictEqual(repeated.outcome, 'no_runnable_job');
  assert.deepStrictEqual(calls, { openai: 0, exa: 0, parser: 0 });
  assert(article.dependencyOutputs.find(item => item.deliverableId === 'research_evidence_pack')?.output?.evidenceItems?.length > 0);

  assert.strictEqual(operationalCategory('RESEARCH_PROVIDER_CANCELLED'), 'CANCELLED');
  assert.strictEqual(operationalCategory('RESEARCH_DEADLINE_EXCEEDED'), 'TIMEOUT');
  assert.strictEqual(operationalCategory('CLAIM_OWNERSHIP_LOST'), 'LEASE_LOSS');
  assert.strictEqual(operationalCategory('RESEARCH_PROVIDER_UNAVAILABLE'), 'DISCOVERY_FAILURE');
  for (const code of ['RESEARCH_PROVIDER_CANCELLED', 'RESEARCH_DEADLINE_EXCEEDED', 'CLAIM_OWNERSHIP_LOST', 'RESEARCH_PROVIDER_UNAVAILABLE']) {
    const operations = createResearchOperations(); const reservation = operations.reserve('web_search', { needKey: code }); operations.reconcile(reservation, { failureCode: code }); const summary = operations.summary('FAILED');
    assert.strictEqual(summary.discoveryAttempts, 1); assert.strictEqual(summary.unknownCostOperationCount, 1);
  }

  console.log('Story 3.239 Production Safety Regression tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
