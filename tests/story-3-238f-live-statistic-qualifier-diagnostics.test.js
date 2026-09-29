const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { researchCandidateSchema } = require('../lib/openaiResearchProvider');
const { generateResearchEvidencePack, sourcePolicy, statisticEvidence, validateArticleEvidence, validateResearchPack } = require('../lib/productionResearchEvidence');
const { createDeterministicResearchAdapter, normalizedSource } = require('../lib/researchAdapter');

const need = { claimType: 'current_statistic', freshnessClass: 'high', jurisdiction: 'United States', preferredSourceTypes: ['government'], prohibitedSourceTypes: ['blog'], intendedUse: 'public_factual_claim' };
const baseStatistic = { metric: 'share of employer businesses that were small businesses', value: '99.9', unit: 'percent', denominator: '', population: 'U.S. employer businesses', period: '2021', geography: 'U.S.', approximation: '' };
const baseText = 'In 2021, 99.9% of U.S. employer businesses were small businesses.';
function censusSource(overrides = {}) {
  const statistic = { ...baseStatistic, ...(overrides.statistic || {}) };
  return normalizedSource({
    sourceKey: overrides.sourceKey || 'census-qualified', canonicalUrl: 'https://www.census.gov/library/stories/small-business.html',
    title: 'Small Business Statistics', publisher: 'U.S. Census Bureau', publicationDate: overrides.publicationDate || '2026-04-01',
    retrievedAt: '2026-09-28T00:00:00Z', sourceType: 'government', qualityTier: 'tier_1', jurisdiction: 'United States',
    population: statistic.population, entity: 'small_business', content: overrides.text === undefined ? baseText : overrides.text,
    candidateProposition: overrides.proposition || baseText, candidateStatistic: statistic
  });
}
function failures(overrides) { return statisticEvidence(censusSource(overrides), need).failures; }

(async () => {
  const schema = researchCandidateSchema().properties.candidateFindings.items;
  for (const key of ['publicationDate', 'jurisdiction', 'population', 'period', 'metric', 'numericValue', 'numericUnit', 'denominator', 'geography', 'approximation']) {
    assert.deepStrictEqual(schema.properties[key].type, ['string', 'null'], key);
    assert(schema.required.includes(key));
  }

  const direct = statisticEvidence(censusSource(), need);
  assert.deepStrictEqual(direct.failures, []);
  assert.strictEqual(direct.diagnostics.numericDenominatorRequired, false);
  assert.strictEqual(direct.diagnostics.numericDenominatorPresent, false);
  assert.strictEqual(sourcePolicy(censusSource(), need).accepted, true);
  assert.deepStrictEqual(statisticEvidence(censusSource({ statistic: { unit: '%' } }), need).failures, []);
  assert.deepStrictEqual(statisticEvidence(censusSource({ statistic: { geography: 'United States of America' }, text: 'In 2021, 99.9 percent of employer businesses in the United States were small businesses.' }), need).failures, []);
  assert.deepStrictEqual(statisticEvidence(censusSource({ statistic: { approximation: 'about' }, text: 'In 2021, about 99.9 percent of U.S. employer businesses were small businesses.' }), need).failures, []);
  assert.deepStrictEqual(statisticEvidence(censusSource({ statistic: { approximation: 'not applicable' } }), need).failures, []);
  assert.deepStrictEqual(statisticEvidence(censusSource({ statistic: { metric: 'percentage of employer businesses that were small businesses' } }), need).failures, []);
  assert.deepStrictEqual(statisticEvidence(censusSource({ publicationDate: '2026-04-01', statistic: { period: '2021' } }), need).failures, [], 'publication date must not replace the explicit data period');

  const cases = [
    [{ statistic: { value: '' } }, 'STATISTIC_VALUE_MISSING'],
    [{ statistic: { unit: '' } }, 'STATISTIC_UNIT_MISSING'],
    [{ statistic: { population: '' } }, 'STATISTIC_POPULATION_MISSING'],
    [{ statistic: { period: '' } }, 'STATISTIC_PERIOD_MISSING'],
    [{ statistic: { geography: '' } }, 'STATISTIC_GEOGRAPHY_MISSING'],
    [{ statistic: { metric: '' } }, 'STATISTIC_METRIC_MISSING'],
    [{ statistic: { population: 'survey respondents' } }, 'STATISTIC_POPULATION_MISMATCH'],
    [{ statistic: { period: '2024' } }, 'STATISTIC_PERIOD_MISMATCH'],
    [{ statistic: { geography: 'Virginia' } }, 'STATISTIC_GEOGRAPHY_MISMATCH'],
    [{ statistic: { metric: 'annual revenue' } }, 'STATISTIC_METRIC_MISMATCH'],
    [{ statistic: { derivation: 'derived_arithmetic' } }, 'STATISTIC_DENOMINATOR_REQUIRED'],
    [{ statistic: { approximation: '' }, text: 'In 2021, about 99.9 percent of U.S. employer businesses were small businesses.' }, 'STATISTIC_APPROXIMATION_LOST'],
    [{ proposition: baseText, text: 'Small businesses are common.', statistic: {} }, 'STATISTIC_VALUE_NOT_SUPPORTED_BY_EXCERPT']
  ];
  for (const [overrides, expected] of cases) assert(failures(overrides).includes(expected), `${expected}: ${failures(overrides)}`);

  const diagnostic = statisticEvidence(censusSource({ statistic: { population: 'survey respondents', period: '2024' } }), need);
  assert.strictEqual(diagnostic.diagnostics.populationMatchesExcerpt, false);
  assert.strictEqual(diagnostic.diagnostics.periodMatchesExcerpt, false);
  assert(diagnostic.diagnostics.failureReasons.includes('STATISTIC_POPULATION_MISMATCH'));
  assert.strictEqual(sourcePolicy(censusSource(), need).statisticDiagnostics, undefined, 'accepted source does not persist rejection diagnostics');
  const stale = sourcePolicy(censusSource({ publicationDate: '2020-01-01' }), need);
  assert(stale.statisticFailures.includes('STATISTIC_CURRENTNESS_UNSUPPORTED'));
  assert.strictEqual(stale.statisticDiagnostics.currentnessSatisfied, false);

  const brief = { summary: 'Census statistic brief', content: ['Use one qualified statistic.'], specificTopic: 'small employer business percentage', readerQuestion: 'What percentage of U.S. employer businesses were small businesses in the latest official release?', searchIntentHypothesis: 'Informational', contentAngle: 'Explain the qualified Census statistic.', scope: 'Preserve population, period, and geography.', callToActionStatus: 'Not established', evidenceLimits: ['Use verified official data only.'], jurisdiction: 'United States', population: 'U.S. employer businesses' };
  const briefDependency = { deliverableId: 'priority_content_brief', contractVersion: 'priority_content_brief:v4', output: brief };
  const run = { objective: 'improve_search_rankings', strategySnapshot: { primaryCustomer: { value: 'U.S. small-business readers', semanticRole: 'confirmed_fact' } } };
  const packContract = getProductionContract('research_evidence_pack');
  const packContext = buildProductionContext({ productionRun: run, job: { deliverable_id: packContract.id, title: packContract.title, strategic_direction: 'Research.', contract_version: packContract.version }, dependencyOutputs: [briefDependency] });
  const accepted = await generateResearchEvidencePack(packContext, { adapter: createDeterministicResearchAdapter({ fixtures: [censusSource({ sourceKey: 'qualified-statistic' })] }) });
  assert.deepStrictEqual(validateResearchPack(accepted), []);
  assert.strictEqual(accepted.evidenceItems.length, 1, JSON.stringify(accepted.rejectedSources));
  assert.strictEqual(accepted.evidenceItems[0].statistic.period, '2021');
  const articleContract = getProductionContract('priority_search_article');
  const articleContext = buildProductionContext({ productionRun: run, job: { deliverable_id: articleContract.id, title: articleContract.title, strategic_direction: 'Write.', contract_version: articleContract.version }, dependencyOutputs: [briefDependency, { deliverableId: 'research_evidence_pack', contractVersion: packContract.version, output: accepted }] });
  const article = articleContract.generateOutput(articleContext);
  assert.deepStrictEqual(validateArticleEvidence(article, articleContext), []);
  const publicText = articleContract.presentOutput(article, [{ tone: 'professional' }])[0].text;
  assert.match(publicText, /2021.*99\.9(?:%| percent).*U\.S\. employer businesses/i);
  assert.match(publicText, /## Sources[\s\S]*census\.gov/i);

  const rejected = await generateResearchEvidencePack(packContext, { adapter: createDeterministicResearchAdapter({ fixtures: [censusSource({ sourceKey: 'qualified-statistic', statistic: { population: '' } })] }) });
  assert.strictEqual(rejected.researchAvailabilityStatus, 'deterministic_fixture');
  assert(rejected.rejectedSources[0].details.includes('STATISTIC_POPULATION_MISSING'));
  assert.strictEqual(rejected.rejectedSources[0].numericDiagnostics.numericPopulationPresent, false);
  assert.match(rejected.researchSummary, /population clearly enough/i);
  const publicPack = packContract.presentOutput(rejected, [{ tone: 'professional' }]).map(section => section.text).join('\n');
  assert.doesNotMatch(publicPack, /STATISTIC_|numericDiagnostics|numericPopulationPresent|failureReasons/);
  console.log('Story 3.238F Live Statistic Qualifier Diagnostics tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
