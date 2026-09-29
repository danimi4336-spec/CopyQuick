const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { buildExternalEvidenceContext, generateResearchEvidencePack, validateArticleEvidence, validateResearchPack } = require('../lib/productionResearchEvidence');
const { generateSearchArticle } = require('../lib/productionSearchEditorial');
const { normalizedSource } = require('../lib/researchAdapter');

const CENSUS_URL = 'https://www.census.gov/library/stories/2024/04/small-business-week-2024.html';
const CENSUS_TITLE = 'Census Bureau Resources, Data Tools, Website for Small Businesses';
const STATISTIC = Object.freeze({ metric: 'share of U.S. employer businesses that were small businesses', value: '99.9', unit: 'percent', denominator: '', population: 'U.S. employer businesses', period: '2021', geography: 'United States', approximation: '' });
const PROPOSITION = 'In 2021, 99.9% of U.S. employer businesses were small businesses.';

function approvedCandidate(now = () => new Date()) {
  return normalizedSource({ sourceKey: 'qualified-statistic', canonicalUrl: CENSUS_URL, title: CENSUS_TITLE, publisher: 'U.S. Census Bureau',
    publicationDate: '2024-04-28', retrievedAt: now().toISOString(), sourceType: 'government', qualityTier: 'tier_1', authorityIdentity: 'U.S. Census Bureau',
    authorityRootDomain: 'census.gov', authorityJurisdiction: 'United States', authorityApplicable: true, jurisdiction: 'United States',
    population: STATISTIC.population, entity: 'small_business', content: '99.9% of businesses were small businesses.', providerProvenance: 'approved_census_candidate',
    candidateProposition: PROPOSITION, candidateStatistic: STATISTIC, candidateClaimType: 'current_statistic' });
}

function discoveryAdapter(source) {
  const operations = [];
  return Object.freeze({ provider: 'approved_fixture', model: 'none', async discover() { operations.push({ operation: 'approved_candidate', outcome: 'completed', units: 0 }); return [source]; },
    async retrieve(item) { return item; }, operations: () => operations.map(item => ({ ...item })), reports: () => [] });
}

function publicFormats(articleContract, article) {
  const copyAll = articleContract.presentOutput(article, [{ tone: 'professional' }]).map(item => item.text || '').join('\n\n');
  const markdown = copyAll;
  const txt = copyAll.replace(/^#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, '$1 — $2');
  return Object.freeze({ detail: copyAll, copyAll, txt, markdown });
}

async function runCensusAcceptance({ extractionAdapter, now = () => new Date() }) {
  const brief = { summary: 'Census statistic brief', content: ['Use one qualified official statistic.'], specificTopic: 'small employer business percentage',
    readerQuestion: 'What percentage of U.S. employer businesses were small businesses in the latest official release?', searchIntentHypothesis: 'Informational',
    contentAngle: 'Explain the qualified Census statistic.', scope: 'Preserve population, period, and geography.', callToActionStatus: 'Not established',
    evidenceLimits: ['Use verified official data only.'], jurisdiction: 'United States', population: 'U.S. employer businesses' };
  const briefDependency = { deliverableId: 'priority_content_brief', contractVersion: 'priority_content_brief:v4', output: brief };
  const run = { objective: 'improve_search_rankings', user_id: 11, strategySnapshot: { primaryCustomer: { value: 'U.S. small-business readers', semanticRole: 'confirmed_fact' } } };
  const researchContract = getProductionContract('research_evidence_pack');
  const researchContext = buildProductionContext({ productionRun: run, job: { deliverable_id: researchContract.id, title: researchContract.title, strategic_direction: 'Research.', contract_version: researchContract.version }, dependencyOutputs: [briefDependency] });
  const pack = await generateResearchEvidencePack(researchContext, { adapter: discoveryAdapter(approvedCandidate(now)), extractionAdapter });
  const packFailures = validateResearchPack(pack); const evidence = pack.evidenceItems[0] || null; const source = pack.sources[0] || null;
  let article = null; let articleFailures = []; let formats = Object.freeze({ detail: '', copyAll: '', txt: '', markdown: '' });
  if (evidence?.evidenceStatus === 'supported' && !packFailures.length) {
    const articleContract = getProductionContract('priority_search_article');
    const articleContext = buildProductionContext({ productionRun: run, job: { deliverable_id: articleContract.id, title: articleContract.title, strategic_direction: 'Write.', contract_version: articleContract.version }, dependencyOutputs: [briefDependency, { deliverableId: 'research_evidence_pack', contractVersion: researchContract.version, output: pack }] });
    article = generateSearchArticle(articleContext); articleFailures = validateArticleEvidence(article, articleContext); formats = publicFormats(articleContract, article);
  }
  const grounding = source?.providerMetadata?.grounding || {}; const publicText = formats.copyAll;
  return Object.freeze({ pack, evidence, source, article, packFailures, articleFailures, formats,
    report: Object.freeze({ sourceIdentity: source?.canonicalUrl === CENSUS_URL && source?.publisher === 'U.S. Census Bureau' && source?.qualityTier === 'tier_1',
      windowsSelected: grounding.windowLocations?.length || 0, passageCount: grounding.windowLocations?.length || 0, persistedPassageLength: String(evidence?.excerpt || '').length,
      passageHashPresent: Boolean(grounding.passageHash), contentHashPresent: Boolean(grounding.contentHash), evidenceStatus: evidence?.evidenceStatus || 'unsupported',
      supportStatus: evidence?.supportStatus || 'not_run', citationPresent: /\[1\]/.test(publicText), sourceSectionPresent: /## Sources/.test(publicText),
      sourceUrlPresent: publicText.includes(CENSUS_URL), internalLeakage: /requestId|providerCost|passageHash|contentHash|sourceRegistryKey|candidateWindows|groundingStatus|researchTrace|\bExa\b/i.test(publicText),
      fullPagePersisted: (pack.sources || []).some(item => typeof item.content === 'string'), formatsReady: Object.values(formats).every(Boolean) }) });
}

module.exports = { CENSUS_TITLE, CENSUS_URL, PROPOSITION, STATISTIC, runCensusAcceptance };
