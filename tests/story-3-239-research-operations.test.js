const assert = require('assert');
const { createProviderBreaker, createResearchOperations, customerResearchStatus, operationalCategory, researchOperationsPolicy } = require('../lib/researchOperations');
const { generateResearchEvidencePack } = require('../lib/productionResearchEvidence');

function context(brief) { return { dependencyOutputs: [{ deliverableId: 'priority_content_brief', output: brief }] }; }

(async function run() {
  const clamped = researchOperationsPolicy({ RESEARCH_NEED_COST_LIMIT_USD: '99', RESEARCH_PACK_COST_LIMIT_USD: '99', RESEARCH_PACK_TIMEOUT_MS: '9999999', RESEARCH_PACK_MAX_EXTERNAL_CALLS: '999' });
  assert.strictEqual(clamped.needCostUsd, 0.05); assert.strictEqual(clamped.packCostUsd, 0.15); assert.strictEqual(clamped.packElapsedMs, 150000); assert.strictEqual(clamped.externalCalls, 20);

  let clock = Date.parse('2026-09-29T12:00:00Z'); const operations = createResearchOperations({ now: () => clock });
  const first = operations.reserve('web_search', { needKey: 'n1' }); clock += 25;
  operations.reconcile(first, { durationMs: 25, estimatedCostUsd: 0.018, inputTokens: 100, outputTokens: 20, pricingVersion: 'test-price' });
  const exa = operations.reserve('source_extraction', { needKey: 'n1', sourceKey: 's1' }); clock += 10;
  operations.reconcile(exa, { durationMs: 10, estimatedCostUsd: 0.001, providerReportedCostUsd: 0.001, pricingVersion: 'exa-test' });
  operations.completeNeed('n1', { status: 'SUPPORTED', sourcesConsidered: 2, sourcesRetrieved: 1, evidenceAccepted: 1 });
  const summary = operations.summary('SUPPORTED', { supportedNeedCount: 1, webSearchActions: 1, nativeSourceCount: 2, eligibleSourceCount: 1, retrievedSourceCount: 1 });
  assert.strictEqual(summary.estimatedCostUsd, 0.019); assert.strictEqual(summary.providerReportedCostUsd, 0.001); assert.strictEqual(summary.unknownCostOperationCount, 0); assert.deepStrictEqual(summary.pricingVersions, ['test-price', 'exa-test']); assert.strictEqual(summary.needOperations[0].evidenceAccepted, 1);

  const unknownOps = createResearchOperations(); const unknown = unknownOps.reserve('entailment', { needKey: 'n' }); unknownOps.reconcile(unknown, { failureCode: 'RESEARCH_PROVIDER_CANCELLED' }); assert.strictEqual(unknownOps.summary('CANCELLED').unknownCostOperationCount, 1);
  const limited = createResearchOperations({ env: { RESEARCH_PACK_MAX_EXTERNAL_CALLS: '1' } }); limited.reserve('web_search', { needKey: 'a' }); assert.throws(() => limited.reserve('entailment', { needKey: 'a' }), error => error.code === 'RESEARCH_PROVIDER_BUDGET_EXHAUSTED');

  let now = 0; const breaker = createProviderBreaker('test', { now: () => now }); breaker.failure('RESEARCH_PROVIDER_UNAVAILABLE'); breaker.failure('RESEARCH_PROVIDER_RATE_LIMITED'); breaker.failure('RESEARCH_PROVIDER_TIMEOUT'); assert.strictEqual(breaker.snapshot().state, 'OPEN'); assert.strictEqual(breaker.allow(), false); now = 60000; assert.strictEqual(breaker.allow(), true); assert.strictEqual(breaker.snapshot().state, 'HALF_OPEN'); breaker.success(); assert.strictEqual(breaker.snapshot().state, 'CLOSED');
  const auth = createProviderBreaker('auth'); auth.failure('RESEARCH_PROVIDER_AUTHORIZATION_FAILED'); assert.strictEqual(auth.snapshot().state, 'OPEN'); assert.strictEqual(auth.snapshot().permanent, true);
  const safe = createProviderBreaker('safe'); safe.failure('RESEARCH_EVIDENCE_INSUFFICIENT'); assert.strictEqual(safe.snapshot().state, 'CLOSED');

  assert.strictEqual(operationalCategory('EXTRACTION_RATE_LIMITED'), 'RATE_LIMITED'); assert.strictEqual(customerResearchStatus('BLOCKED'), 'Blocked pending evidence');
  const noResearch = await generateResearchEvidencePack(context({ specificTopic: 'organizing a weekly workflow', readerQuestion: 'How should a team organize its weekly workflow?', evidenceLimits: [] }));
  assert.strictEqual(noResearch.researchOperations.status, 'NOT_REQUIRED'); assert.strictEqual(noResearch.researchStatus, 'No research needed'); assert.strictEqual(noResearch.researchOperations.estimatedCostUsd, 0);
  assert.strictEqual(noResearch.questionsChecked, 0); assert.strictEqual(noResearch.sourcesUsedCount, 0); assert(!JSON.stringify(noResearch).includes('API key invalid'));
  console.log('Story 3.239 Research Operations tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
