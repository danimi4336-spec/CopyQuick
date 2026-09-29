const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const {
  buildExternalEvidenceContext, derivePercentage, generateResearchEvidencePack, sourcePolicy,
  statisticEvidence, validateArticleEvidence, validateResearchPack
} = require('../lib/productionResearchEvidence');
const { createDeterministicResearchAdapter, normalizedSource } = require('../lib/researchAdapter');

const currentNeed = {
  claimType: 'current_statistic', freshnessClass: 'high', jurisdiction: 'United States',
  preferredSourceTypes: ['government', 'original_research'], prohibitedSourceTypes: ['blog'],
  intendedUse: 'public_factual_claim'
};
function statisticSource({ text, proposition = text, statistic, publicationDate = '2026-04-01', jurisdiction = 'United States', population = statistic?.population || '' } = {}) {
  return normalizedSource({
    sourceKey: 'numeric-source', canonicalUrl: 'https://www.census.gov/example', title: 'Official statistic',
    publisher: 'U.S. Census Bureau', publicationDate, retrievedAt: '2026-09-28T00:00:00Z',
    sourceType: 'government', qualityTier: 'tier_1', jurisdiction, population, entity: 'small_business',
    content: text, candidateProposition: proposition, candidateStatistic: statistic
  });
}
function expectValid(source) {
  const result = statisticEvidence(source, currentNeed);
  assert.deepStrictEqual(result.failures, [], JSON.stringify(result.failures));
  assert.strictEqual(sourcePolicy(source, currentNeed).accepted, true);
  return result.statistic;
}
function expectFailure(source, code) {
  const result = statisticEvidence(source, currentNeed);
  assert(result.failures.includes(code), `${code}: ${JSON.stringify(result.failures)}`);
  assert.strictEqual(sourcePolicy(source, currentNeed).accepted, false);
}

(async () => {
  const percentage = statisticSource({
    text: 'Among surveyed United States small businesses in 2025, 42 percent reported X.',
    statistic: { metric: 'share reporting X', value: '42', unit: 'percent', denominator: 'surveyed United States small businesses', population: 'surveyed United States small businesses', period: '2025', geography: 'United States', approximation: '' }
  });
  assert.strictEqual(expectValid(percentage).unit, 'percent');
  expectValid(statisticSource({ text: 'In the United States in 2025, there were 33.3 million small businesses.', statistic: { metric: 'number of small businesses', value: '33.3', unit: 'million', denominator: '', population: 'small businesses', period: '2025', geography: 'United States', approximation: '' } }));
  expectValid(statisticSource({ text: 'In 2025, 4 out of 10 surveyed United States businesses reported X.', statistic: { metric: 'share reporting X', value: '4', unit: 'ratio', denominator: '10 surveyed United States businesses', population: 'surveyed United States businesses', period: '2025', geography: 'United States', approximation: '' } }));
  expectValid(statisticSource({ text: 'In 2025, one in 5 surveyed United States firms reported X.', statistic: { metric: 'share reporting X', value: '1', unit: 'ratio', denominator: '5 surveyed United States firms', population: 'surveyed United States firms', period: '2025', geography: 'United States', approximation: '' } }));
  const approximate = statisticSource({ text: 'In 2025, approximately 39 percent of surveyed United States firms reported X.', statistic: { metric: 'share reporting X', value: '39', unit: 'percent', denominator: 'surveyed United States firms', population: 'surveyed United States firms', period: '2025', geography: 'United States', approximation: 'approximately' } });
  assert.strictEqual(expectValid(approximate).approximation, 'approximately');

  expectFailure(statisticSource({ text: percentage.content, statistic: { ...percentage.candidateStatistic, value: '24' } }), 'STATISTIC_VALUE_NOT_SUPPORTED_BY_EXCERPT');
  expectValid(statisticSource({ text: percentage.content, statistic: { ...percentage.candidateStatistic, denominator: '' } }));
  expectFailure(statisticSource({ text: percentage.content, statistic: { ...percentage.candidateStatistic, denominator: '', derivation: 'derived_arithmetic' } }), 'STATISTIC_DENOMINATOR_REQUIRED');
  expectFailure(statisticSource({ text: percentage.content, statistic: { ...percentage.candidateStatistic, population: 'all businesses' } }), 'STATISTIC_POPULATION_MISMATCH');
  expectFailure(statisticSource({ text: percentage.content, statistic: { ...percentage.candidateStatistic, period: '2024' } }), 'STATISTIC_PERIOD_MISMATCH');
  expectFailure(statisticSource({ text: percentage.content, statistic: { ...percentage.candidateStatistic, geography: 'Virginia' } }), 'STATISTIC_GEOGRAPHY_MISMATCH');
  expectFailure(statisticSource({ text: approximate.content, statistic: { ...approximate.candidateStatistic, approximation: '' } }), 'STATISTIC_APPROXIMATION_LOST');
  expectFailure(statisticSource({ text: 'In the United States in 2025, 42 percent represented annual revenue.', statistic: { ...percentage.candidateStatistic, metric: 'share reporting X' } }), 'STATISTIC_METRIC_MISMATCH');
  assert.strictEqual(sourcePolicy(statisticSource({ text: percentage.content, statistic: percentage.candidateStatistic, publicationDate: '2014-01-01' }), currentNeed).status, 'stale');

  const numerator = { metric: 'small employer businesses', value: '9994', population: 'employer businesses', period: '2025', geography: 'United States', entity: 'business' };
  const denominator = { metric: 'total employer businesses', value: '10000', population: 'employer businesses', period: '2025', geography: 'United States', entity: 'business' };
  const derived = derivePercentage(numerator, denominator, { decimals: 1, metric: 'share of employer businesses that are small' });
  assert.strictEqual(derived.value, '99.9');
  assert.strictEqual(derived.derivation, 'derived_arithmetic');
  assert.strictEqual(derived.approximation, 'approximately');
  assert.strictEqual(derivePercentage(numerator, { ...denominator, period: '2024' }), null, 'incompatible periods cannot be combined');
  assert.strictEqual(derivePercentage(numerator, { ...denominator, geography: 'Canada' }), null, 'incompatible geographies cannot be combined');

  const brief = {
    summary: 'Qualified statistic brief', content: ['Use one current official statistic.'],
    specificTopic: 'current small-business percentage', readerQuestion: 'What percentage of surveyed U.S. small businesses reported X in 2025?',
    searchIntentHypothesis: 'Informational', contentAngle: 'Explain the qualified statistic.', scope: 'Preserve population, period, and geography.',
    callToActionStatus: 'Not established', evidenceLimits: ['Do not generalize survey results.'], jurisdiction: 'United States', population: 'surveyed U.S. small businesses'
  };
  const briefDependency = { deliverableId: 'priority_content_brief', contractVersion: 'priority_content_brief:v4', output: brief };
  const run = { objective: 'improve_search_rankings', strategySnapshot: { primaryCustomer: { value: 'U.S. small-business readers', semanticRole: 'confirmed_fact' } } };
  const packContract = getProductionContract('research_evidence_pack');
  const packContext = buildProductionContext({ productionRun: run, job: { deliverable_id: packContract.id, title: packContract.title, strategic_direction: 'Research.', contract_version: packContract.version }, dependencyOutputs: [briefDependency] });
  const replay = normalizedSource({ ...percentage, sourceKey: 'qualified-statistic', canonicalUrl: 'https://www.census.gov/qualified-statistic' });
  const pack = await generateResearchEvidencePack(packContext, { adapter: createDeterministicResearchAdapter({ fixtures: [replay] }) });
  assert.deepStrictEqual(validateResearchPack(pack), []);
  assert.strictEqual(pack.researchAvailabilityStatus, 'deterministic_fixture');
  assert.strictEqual(pack.evidenceItems[0].statistic.value, '42');
  const articleContract = getProductionContract('priority_search_article');
  const articleContext = buildProductionContext({ productionRun: run, job: { deliverable_id: articleContract.id, title: articleContract.title, strategic_direction: 'Write.', contract_version: articleContract.version }, dependencyOutputs: [briefDependency, { deliverableId: 'research_evidence_pack', contractVersion: packContract.version, output: pack }] });
  const article = articleContract.generateOutput(articleContext);
  assert.deepStrictEqual(validateArticleEvidence(article, articleContext), [], JSON.stringify({ qualifiers: pack.evidenceItems[0].qualifiers, claims: article.articleBlocks.flatMap(block => block.claims || []).filter(item => item.evidenceRequired) }));
  const publicText = articleContract.presentOutput(article, [{ tone: 'professional' }])[0].text;
  assert.match(publicText, /42 percent.*surveyed United States small businesses.*2025|surveyed United States small businesses.*2025.*42 percent/i);
  assert.match(publicText, /\[1\]|## Sources/);
  assert.doesNotMatch(publicText, /candidateStatistic|sourceKey|evidenceKey/);

  const generalized = structuredClone(article);
  const claim = generalized.articleBlocks.flatMap(block => block.claims || []).find(item => item.evidenceRequired);
  claim.text = '42 percent of businesses reported X.';
  assert(validateArticleEvidence(generalized, articleContext).includes('RESEARCH_QUALIFIER_LOSS'));
  console.log('Story 3.238D Numeric Evidence Extraction tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
