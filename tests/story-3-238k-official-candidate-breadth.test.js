const assert = require('assert');
const { classifyLiveSource, createOpenAIResearchAdapter, nativeSourceRelevant, rankSourceCandidates } = require('../lib/openaiResearchProvider');
const { sourcePolicy, sourcePreAdmission } = require('../lib/productionResearchEvidence');

const need = { key: 'current-statistic', question: 'What does the latest official evidence report about the scale or share of U.S. small businesses?', neutralQuery: 'latest official United States small business statistics', claimType: 'current_statistic', intendedUse: 'public_factual_claim', preferredSourceTypes: ['government', 'original_research', 'academic_secondary'], prohibitedSourceTypes: ['blog', 'search_snippet'], freshnessClass: 'high', jurisdiction: 'United States', population: '', requiredEntity: '' };
const urls = [
  ['https://advocacy.sba.gov/2024/11/19/frequently-asked-questions-about-small-business-2024/', 'Frequently Asked Questions About Small Business'],
  ['https://www.census.gov/library/stories/2024/04/small-business-week-2024.html', 'Small Business Week Data'],
  ['https://www.census.gov/data/tables/2023/econ/susb/2023-susb-annual.html', 'Statistics of U.S. Businesses Data'],
  ['https://advocacy.sba.gov/2024-small-business-profiles-for-the-states-territories-and-nation/', '2024 Small Business Profiles'],
  ['https://www.census.gov/programs-surveys/susb.html?utm_source=test#details', 'Statistics of U.S. Businesses']
];
function headers() { return { get() { return ''; } }; }
function payload() {
  const first = urls[0];
  return { id: 'resp_breadth', status: 'completed', output_text: JSON.stringify({ researchQuestion: need.question, candidateFindings: [{ proposition: '', sourceUrl: first[0], supportingText: '', sourceType: '', qualityTier: '', publisher: '', title: first[1], publicationDate: '', jurisdiction: 'United States', population: '', entity: '', modality: '', relationship: '', period: '', claimType: 'current_statistic', metric: '', numericValue: '', numericUnit: '', denominator: '', geography: 'United States', approximation: '' }], unsupported: [], conflicts: [] }), output: [{ type: 'web_search_call', action: { type: 'search', sources: [...urls, [urls[4][0].replace('?utm_source=test#details', '?utm_campaign=duplicate'), urls[4][1]]].map(([url, title]) => ({ type: 'url', url, title })) } }], usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 } };
}

(async () => {
  const authority = classifyLiveSource('https://advocacy.sba.gov/report', 'unfamiliar-provider-label', [], need);
  assert.deepStrictEqual(authority, { sourceType: 'government', qualityTier: 'tier_1', authorityIdentity: 'U.S. Small Business Administration', authorityRootDomain: 'sba.gov', authorityJurisdiction: 'United States', authorityApplicable: true });
  const candidate = { canonicalUrl: 'https://advocacy.sba.gov/report', title: 'Small Business Statistics', sourceType: authority.sourceType, qualityTier: authority.qualityTier, authorityIdentity: authority.authorityIdentity, authorityApplicable: true, jurisdiction: 'United States', accessible: true, paywalled: false, snippetOnly: false };
  assert.strictEqual(sourcePreAdmission(candidate, need).diagnosticCode, 'CANDIDATE_ELIGIBLE');
  assert.strictEqual(sourcePreAdmission({ ...candidate, authorityApplicable: false }, need).diagnosticCode, 'CANDIDATE_AUTHORITY_MISMATCH');
  assert.strictEqual(sourcePreAdmission({ ...candidate, jurisdiction: 'Canada' }, need).diagnosticCode, 'CANDIDATE_JURISDICTION_MISMATCH');
  assert.strictEqual(nativeSourceRelevant({ title: 'Official data release', canonicalUrl: 'https://www.census.gov/library/stories/small-business/data.html' }, need), true, 'a bounded topic phrase in an official URL path may establish retrieval relevance');
  assert.strictEqual(nativeSourceRelevant({ title: 'Agency home page', canonicalUrl: 'https://www.census.gov/about/history.html?small-business=true#statistics' }, need), false, 'query and fragment text cannot establish retrieval relevance');
  assert.strictEqual(nativeSourceRelevant({ title: 'Agency home page', canonicalUrl: 'https://www.census.gov/1234567' }, need), false, 'an authority hostname and numeric slug alone are not topic evidence');
  const pathOnly = { ...candidate, canonicalUrl: 'https://www.census.gov/data/small-business/statistics', authorityIdentity: 'U.S. Census Bureau', authorityRootDomain: 'census.gov', content: '', candidateProposition: '', candidateStatistic: {} };
  assert.strictEqual(sourcePreAdmission(pathOnly, need).accepted, true, 'path-relevant official source may proceed to retrieval');
  assert.strictEqual(sourcePolicy(pathOnly, need).accepted, false, 'URL metadata alone cannot establish a supported statistic');
  const unrelatedGovernment = classifyLiveSource('https://www.usda.gov/data/small-business/statistics', '', [], need);
  assert.notStrictEqual(unrelatedGovernment.authorityApplicable, true, 'a relevant-looking path on an unrelated government domain does not establish applicable authority');
  const ranked = rankSourceCandidates([
    { ...candidate, canonicalUrl: 'https://example.com/background', qualityTier: 'tier_3', authorityApplicable: false, candidateClaimType: 'general_background' },
    { ...candidate, canonicalUrl: 'https://advocacy.sba.gov/current-statistic', candidateClaimType: 'current_statistic' }
  ], need);
  assert.strictEqual(ranked[0].canonicalUrl, 'https://advocacy.sba.gov/current-statistic', 'applicable primary authority outranks a weaker background candidate');

  const requests = []; const adapter = createOpenAIResearchAdapter({ apiKey: 'fixture-key', maxWebCalls: 1, fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200, headers: headers(), json: async () => payload() }; } });
  const candidates = await adapter.discover(need);
  assert.strictEqual(requests.length, 1); assert.strictEqual(requests[0].max_tool_calls, 1);
  assert(candidates.length >= 2 && candidates.length <= 5); assert.strictEqual(new Set(candidates.map(item => item.canonicalUrl)).size, candidates.length);
  assert(candidates.some(item => item.providerProvenance === 'openai_native_source_candidate'));
  assert(candidates.every(item => item.authorityApplicable && item.qualityTier === 'tier_1' && item.sourceType === 'government'));
  const sba = candidates.find(item => new URL(item.canonicalUrl).hostname === 'advocacy.sba.gov'); assert(sba); assert.strictEqual(sba.authorityIdentity, 'U.S. Small Business Administration');
  const report = adapter.reports()[0]; assert.strictEqual(report.sourceCounts.registered, 5); assert(report.sourceCounts.sourceOnly >= 1); assert(candidates.length <= 5);
  assert.deepStrictEqual(report.rankedCandidates.map(item => item.canonicalUrl), candidates.map(item => item.canonicalUrl));
  assert.match(requests[0].input[0].content, /2–5 distinct relevant primary source references|2-5 distinct relevant primary source references/);
  console.log('Story 3.238K Official Candidate Eligibility tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
