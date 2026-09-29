const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { buildExternalEvidenceContext, generateResearchEvidencePack, researchNeeds, validateArticleEvidence, validateResearchPack } = require('../lib/productionResearchEvidence');
const { generateSearchArticle } = require('../lib/productionSearchEditorial');
const { normalizedSource } = require('../lib/researchAdapter');
const { createDeterministicExtractionAdapter, deriveEvidencePropositions } = require('../lib/sourceExtraction');

const urlA = 'https://www.census.gov/related-background';
const urlB = 'https://www.census.gov/qualified-small-business-statistic';
const passage = 'Official data show that in 2024, small businesses represented 98.6% of U.S. businesses.';
const hypothesis = { metric: 'share of surveyed employer firms reporting X', value: '42', unit: 'percent', population: 'surveyed employer firms', period: '2025', geography: 'United States' };
function source(key, url) { return normalizedSource({ sourceKey: key, canonicalUrl: url, title: `Official source ${key}`, publisher: 'U.S. Census Bureau', publicationDate: '2026-01-15', retrievedAt: '2026-09-28T12:00:00Z', sourceType: 'government', qualityTier: 'tier_1', authorityIdentity: 'U.S. Census Bureau', authorityRootDomain: 'census.gov', authorityJurisdiction: 'United States', authorityApplicable: true, jurisdiction: 'United States', population: 'surveyed employer firms', entity: 'small_business', content: 'Related official small-business information.', providerProvenance: 'model_hypothesis', candidateProposition: 'In 2025, 42% of surveyed employer firms reported X.', candidateStatistic: hypothesis, candidateClaimType: 'current_statistic' }); }
function context() {
  const brief = { specificTopic: 'latest official U.S. small-business percentage statistic', readerQuestion: 'What does current official evidence report about the scale or share of small businesses in the United States?', searchIntentHypothesis: 'Informational', contentAngle: 'Explain the latest applicable official statistic.', scope: 'Preserve the evidence population and period.', callToActionStatus: 'Not established', evidenceLimits: ['Use verified official data only.'], jurisdiction: 'United States' };
  const dependency = { deliverableId: 'priority_content_brief', contractVersion: 'priority_content_brief:v4', output: brief };
  const run = { objective: 'improve_search_rankings', user_id: 1, strategySnapshot: { primaryCustomer: { value: 'U.S. small-business readers', semanticRole: 'confirmed_fact' } } };
  const contract = getProductionContract('research_evidence_pack');
  return { brief, dependency, run, value: buildProductionContext({ productionRun: run, job: { deliverable_id: contract.id, title: contract.title, strategic_direction: 'Research.', contract_version: contract.version }, dependencyOutputs: [dependency] }) };
}

(async () => {
  const setup = context(); const need = researchNeeds(setup.brief)[0];
  assert.match(need.question, /What does the latest applicable authoritative evidence report/i); assert.doesNotMatch(need.question, /42|99\.9|2021/);
  const derived = deriveEvidencePropositions(passage, need, source('b', urlB));
  assert.strictEqual(derived.length, 1); assert.strictEqual(derived[0].numericValue, '98.6'); assert.strictEqual(derived[0].period, '2024');
  assert.strictEqual(derived[0].population, 'U.S. businesses'); assert.strictEqual(derived[0].derivationType, 'DIRECT_SOURCE_STATEMENT');

  const candidates = [source('a', urlA), source('b', urlB)]; const operations = [];
  const discovery = { async discover() { return candidates; }, async retrieve(item) { return item; }, operations: () => operations, reports: () => [] };
  const extraction = createDeterministicExtractionAdapter({ results: {
    a: { returnedUrl: urlA, normalizedText: 'The Census Bureau publishes resources for small businesses, including tools and tables.' },
    b: { returnedUrl: urlB, normalizedText: passage, title: 'Qualified official statistic', estimatedCostUsd: 0.001 }
  } });
  const pack = await generateResearchEvidencePack(setup.value, { adapter: discovery, extractionAdapter: extraction });
  assert.deepStrictEqual(validateResearchPack(pack), []); assert.strictEqual(pack.evidenceItems.length, 1);
  const evidence = pack.evidenceItems[0]; assert.strictEqual(evidence.evidenceStatus, 'supported'); assert.strictEqual(evidence.statistic.value, '98.6');
  assert.strictEqual(evidence.statistic.period, '2024'); assert.strictEqual(evidence.statistic.population, 'U.S. businesses');
  assert.doesNotMatch(evidence.proposition, /42|2025|surveyed employer/i); assert.match(evidence.proposition, /98\.6%/);
  assert(pack.rejectedSources.some(item => item.sourceKey === 'a')); assert.strictEqual(pack.providerSummary.extraction.requestCount, 2);

  const articleContract = getProductionContract('priority_search_article');
  const articleContext = buildProductionContext({ productionRun: setup.run, job: { deliverable_id: articleContract.id, title: articleContract.title, strategic_direction: 'Write.', contract_version: articleContract.version }, dependencyOutputs: [setup.dependency, { deliverableId: 'research_evidence_pack', contractVersion: 'research_evidence_pack:v2', output: pack }] });
  const article = generateSearchArticle(articleContext); assert.deepStrictEqual(validateArticleEvidence(article, articleContext), []);
  const rendered = articleContract.presentOutput(article, [])[0].text; assert.match(rendered, /2024.*98\.6%.*U\.S\. businesses/i); assert.match(rendered, /\[1\]/); assert.match(rendered, /census\.gov/i);

  const exhaustedExtraction = createDeterministicExtractionAdapter({ results: { a: { returnedUrl: urlA, normalizedText: 'Official background only.' }, b: { returnedUrl: urlB, normalizedText: 'More official background only.' }, c: { returnedUrl: 'https://www.census.gov/third', normalizedText: 'Still no qualified statistic.' } } });
  const third = source('c', 'https://www.census.gov/third');
  const exhausted = await generateResearchEvidencePack(setup.value, { adapter: { ...discovery, async discover() { return [...candidates, third]; } }, extractionAdapter: exhaustedExtraction });
  assert.strictEqual(exhausted.evidenceItems.length, 0); assert.strictEqual(exhausted.providerSummary.extraction.requestCount, 3);
  console.log('Story 3.238J Claim-Aligned Research tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
