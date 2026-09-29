const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { classifyLiveSource, hostBelongsToRoot } = require('../lib/openaiResearchProvider');
const { generateResearchEvidencePack, sourcePolicy, validateArticleEvidence, validateResearchPack } = require('../lib/productionResearchEvidence');
const { createDeterministicResearchAdapter, normalizedSource } = require('../lib/researchAdapter');

const applicable = { claimType: 'current_statistic', jurisdiction: 'United States' };
const classify = (url, type = 'unknown', domains = ['census.gov'], context = applicable) => classifyLiveSource(url, type, domains, context);

(async () => {
  assert.strictEqual(hostBelongsToRoot('census.gov', 'census.gov'), true);
  assert.strictEqual(hostBelongsToRoot('www.census.gov', 'census.gov'), true);
  assert.strictEqual(hostBelongsToRoot('cdn.www.census.gov', 'census.gov'), true);
  for (const host of ['fakecensus.gov', 'census.gov.example.com', 'census-gov.com']) assert.strictEqual(hostBelongsToRoot(host, 'census.gov'), false, host);

  for (const url of ['https://census.gov/report', 'https://www.census.gov/report', 'https://cdn.www.census.gov/report']) {
    const result = classify(url);
    assert.deepStrictEqual({ type: result.sourceType, tier: result.qualityTier, authority: result.authorityIdentity, root: result.authorityRootDomain, applicable: result.authorityApplicable }, { type: 'government', tier: 'tier_1', authority: 'U.S. Census Bureau', root: 'census.gov', applicable: true });
  }
  assert.strictEqual(classify('https://cdn.www.census.gov/report', 'unknown').qualityTier, 'tier_1', 'unknown provider label cannot override deterministic authority');
  for (const url of ['https://fakecensus.gov/report', 'https://census.gov.example.com/report', 'https://unrelated-agency.gov/report', 'https://census-assets.cloudfront.net/report']) {
    assert.strictEqual(classify(url, 'government').qualityTier, 'tier_3', url);
  }
  assert.strictEqual(classify('https://www.census.gov/report', 'government', ['census.gov'], { claimType: 'scientific_clinical', jurisdiction: 'United States' }).qualityTier, 'tier_3');
  assert.strictEqual(classify('https://www.census.gov/report', 'government', ['census.gov'], { claimType: 'current_statistic', jurisdiction: 'Virginia' }).qualityTier, 'tier_3');
  assert.strictEqual(classifyLiveSource('https://www.sba.gov/report', 'unknown', ['sba.gov'], applicable).authorityIdentity, 'U.S. Small Business Administration');
  assert.strictEqual(classifyLiveSource('https://docs.vendor.example/report', 'official_company', ['vendor.example'], { claimType: 'product_company_fact' }).qualityTier, 'tier_1');
  assert.strictEqual(classifyLiveSource('https://unrelated.example/report', 'official_company', ['vendor.example'], { claimType: 'product_company_fact' }).qualityTier, 'tier_3');

  const authority = classify('https://cdn.www.census.gov/library/stories/small-business.html', 'unknown');
  const source = normalizedSource({
    sourceKey: 'qualified-statistic', canonicalUrl: 'https://cdn.www.census.gov/library/stories/small-business.html',
    title: 'Small Business Statistics', publisher: 'U.S. Census Bureau', publicationDate: '2026-05-01', retrievedAt: '2026-09-28T00:00:00Z',
    sourceType: authority.sourceType, qualityTier: authority.qualityTier, authorityIdentity: authority.authorityIdentity,
    authorityRootDomain: authority.authorityRootDomain, authorityJurisdiction: authority.authorityJurisdiction, authorityApplicable: authority.authorityApplicable,
    jurisdiction: 'United States', population: 'United States employer businesses', entity: 'small_business',
    content: 'In the United States in 2025, 99.9 percent of employer businesses were small businesses.',
    candidateProposition: 'In the United States in 2025, 99.9 percent of employer businesses were small businesses.',
    candidateStatistic: { metric: 'share of employer businesses that were small businesses', value: '99.9', unit: 'percent', denominator: 'employer businesses', population: 'United States employer businesses', period: '2025', geography: 'United States', approximation: '' }
  });
  const need = { claimType: 'current_statistic', freshnessClass: 'high', jurisdiction: 'United States', preferredSourceTypes: ['government'], prohibitedSourceTypes: ['blog'], intendedUse: 'public_factual_claim' };
  assert.strictEqual(sourcePolicy(source, need).accepted, true);

  const brief = { summary: 'Census statistic brief', content: ['Use one statistic.'], specificTopic: 'small employer businesses', readerQuestion: 'What share of U.S. employer businesses were small businesses in 2025?', searchIntentHypothesis: 'Informational', contentAngle: 'Explain the qualified Census statistic.', scope: 'Preserve denominator, period, and geography.', callToActionStatus: 'Not established', evidenceLimits: ['Use verified current data only.'], jurisdiction: 'United States', population: 'United States employer businesses' };
  const briefDependency = { deliverableId: 'priority_content_brief', contractVersion: 'priority_content_brief:v4', output: brief };
  const run = { objective: 'improve_search_rankings', strategySnapshot: { primaryCustomer: { value: 'U.S. small-business readers', semanticRole: 'confirmed_fact' } } };
  const packContract = getProductionContract('research_evidence_pack');
  const packContext = buildProductionContext({ productionRun: run, job: { deliverable_id: packContract.id, title: packContract.title, strategic_direction: 'Research.', contract_version: packContract.version }, dependencyOutputs: [briefDependency] });
  const pack = await generateResearchEvidencePack(packContext, { adapter: createDeterministicResearchAdapter({ fixtures: [source] }) });
  assert.deepStrictEqual(validateResearchPack(pack), []);
  assert.strictEqual(pack.evidenceItems[0].evidenceStatus, 'supported');
  assert.strictEqual(pack.evidenceItems[0].statistic.value, '99.9');
  const articleContract = getProductionContract('priority_search_article');
  const articleContext = buildProductionContext({ productionRun: run, job: { deliverable_id: articleContract.id, title: articleContract.title, strategic_direction: 'Write.', contract_version: articleContract.version }, dependencyOutputs: [briefDependency, { deliverableId: 'research_evidence_pack', contractVersion: packContract.version, output: pack }] });
  const article = articleContract.generateOutput(articleContext);
  assert.deepStrictEqual(validateArticleEvidence(article, articleContext), []);
  const publicText = articleContract.presentOutput(article, [{ tone: 'professional' }])[0].text;
  assert.match(publicText, /99\.9 percent.*employer businesses.*2025|2025.*99\.9 percent.*employer businesses/i);
  assert.match(publicText, /\[1\].*## Sources|## Sources[\s\S]*census\.gov/i);
  assert.doesNotMatch(publicText, /sourceKey|evidenceKey|authorityRootDomain/);
  console.log('Story 3.238E Official-Source Classification tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
