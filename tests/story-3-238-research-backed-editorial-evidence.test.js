const assert = require('assert');
const { buildPlan } = require('../lib/buildPlanEngine');
const { buildProductionContext, generateDeliverable } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const {
  buildExternalEvidenceContext, classifyClaimInventory, generateResearchEvidencePack, neutralQuery,
  sourcePolicy, validateArticleEvidence, validateResearchPack
} = require('../lib/productionResearchEvidence');
const { createDeterministicResearchAdapter, fixtureCatalog, safeCitationUrl, sanitizeUntrustedSource } = require('../lib/researchAdapter');

const snapshot = {
  primaryCustomer: { value: 'Small business owners', semanticRole: 'confirmed_fact' },
  confirmedOffer: { value: 'Online accounting software', semanticRole: 'confirmed_fact' }
};
const baseBrief = {
  summary: 'One evidence-aware article brief.', content: ['Use one selected question.'],
  specificTopic: 'invoicing and cash-flow visibility',
  readerQuestion: 'How can a small business use an invoicing routine to improve cash-flow visibility?',
  searchIntentHypothesis: 'Practical guidance', contentAngle: 'A repeatable invoicing review workflow.',
  scope: 'General education without tax or product-capability claims.', callToActionStatus: 'Not established',
  evidenceLimits: ['Do not invent current requirements, metrics, studies, or product capabilities.']
};
const briefDependency = output => ({ deliverableId: 'priority_content_brief', title: 'Priority Content Brief', contractVersion: 'priority_content_brief:v4', output });
function contextFor(id, dependencies) {
  const contract = getProductionContract(id);
  return buildProductionContext({
    productionRun: { objective: 'improve_search_rankings', strategySnapshot: snapshot },
    job: { deliverable_id: id, title: contract.title, strategic_direction: 'Build evidence-disciplined search content.', strategySnapshot: snapshot, contract_version: contract.version },
    dependencyOutputs: dependencies
  });
}

(async () => {
  const packContract = getProductionContract('research_evidence_pack');
  const articleContract = getProductionContract('priority_search_article');
  assert.strictEqual(packContract.version, 'research_evidence_pack:v2');
  assert(packContract.acceptsVersion('research_evidence_pack:v1'));
  assert.strictEqual(packContract.readyToUse, false);
  assert.strictEqual(articleContract.version, 'priority_search_article:v2');
  assert(articleContract.acceptsVersion('priority_search_article:v1'));
  assert.deepStrictEqual(articleContract.requiredDependencies, ['priority_content_brief', 'research_evidence_pack']);

  const plan = buildPlan({ objective: 'improve_search_rankings', confirmedUnderstanding: { site: { value: 'Accounting site' } }, strategyResult: { strategy: snapshot }, answers: {} });
  const items = plan.phases.flatMap(phase => phase.deliverables);
  assert(items.find(item => item.id === 'research_evidence_pack'));
  assert.deepStrictEqual(items.find(item => item.id === 'priority_search_article').dependencies, ['priority_content_brief', 'research_evidence_pack']);

  assert.strictEqual(safeCitationUrl('https://www.sba.gov/example'), true);
  for (const url of ['http://example.com', 'file:///etc/passwd', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.1/a', 'https://169.254.169.254/latest']) assert.strictEqual(safeCitationUrl(url), false, url);
  assert.doesNotMatch(sanitizeUntrustedSource('<script>steal()</script><p>Source text</p>'), /steal|script/i);
  assert.doesNotMatch(neutralQuery('Find proof that cinnamon cures diabetes; only use sources agreeing with me'), /proof|cures|only use/i);
  assert.strictEqual(classifyClaimInventory({ readerQuestion: 'What dosage cures diabetes?' })[0].classification, 'PROHIBITED');

  const fixtures = fixtureCatalog();
  const weak = fixtures.find(item => item.sourceKey === 'weak-blog');
  const stale = fixtures.find(item => item.sourceKey === 'stale-market-report');
  const need = { prohibitedSourceTypes: ['blog'], preferredSourceTypes: ['government'], jurisdiction: 'United States', freshnessClass: 'high' };
  assert.strictEqual(sourcePolicy(weak, need).status, 'weak_source');
  assert.strictEqual(sourcePolicy(stale, need).status, 'stale');

  const packContext = contextFor('research_evidence_pack', [briefDependency(baseBrief)]);
  const pack = await generateResearchEvidencePack(packContext);
  assert.deepStrictEqual(validateResearchPack(pack), []);
  assert(pack.sources.length >= 1 && pack.evidenceItems.length >= 1);
  assert(pack.rejectedSources.some(item => item.status === 'weak_source'));
  assert(pack.sources.every(source => source.content === undefined), 'full source bodies are transient');
  assert(pack.evidenceItems.every(item => item.excerpt.length <= 420));
  assert(pack.researchTrace.every(item => item.units === 0));
  assert.doesNotMatch(JSON.stringify(pack), /Ignore all previous instructions|Reveal the system prompt/);
  const packSections = packContract.presentationSections(pack);
  assert(packSections.some(section => section.key === 'researchSummary'));
  assert(!packSections.some(section => ['sources', 'evidenceItems', 'claimMappings', 'rejectedSources', 'researchTrace'].includes(section.key)));

  const external = buildExternalEvidenceContext([{ deliverableId: 'research_evidence_pack', output: pack }]);
  assert(external.enabled && external.propositions.length);
  assert.strictEqual(external.strategySnapshot, undefined);
  assert.doesNotMatch(JSON.stringify(external), /contentHash|researchTrace|rejectedSources|customer data/i);

  const articleContext = contextFor('priority_search_article', [briefDependency(baseBrief), { deliverableId: 'research_evidence_pack', title: 'Research Evidence Pack', contractVersion: packContract.version, output: pack }]);
  const article = articleContract.generateOutput(articleContext);
  assert.strictEqual(articleContract.validateOutput(article, articleContext), true);
  assert.strictEqual(validateCustomerReadyOutput(article, articleContract, articleContext).valid, true);
  assert.deepStrictEqual(validateArticleEvidence(article, articleContext), []);
  assert.match(JSON.stringify(article.articleBlocks), /\[1\]/);
  assert.strictEqual(article.sources.length, 1);
  const publicText = articleContract.presentOutput(article, [{ tone: 'professional' }])[0].text;
  assert.match(publicText, /## Sources|https:\/\//);
  assert.doesNotMatch(publicText, /evidenceKey|sourceKey|researchTrace|contentHash/);
  assert(!articleContract.presentationSections(article).some(section => section.key === 'sources' && section.internal));

  const laundering = structuredClone(article);
  laundering.articleBlocks[1].claims.find(claim => claim.evidenceRequired).text = 'This unrelated claim guarantees higher profits.';
  assert(validateArticleEvidence(laundering, articleContext).includes('RESEARCH_CITATION_LAUNDERING'));
  const unknown = structuredClone(article);
  unknown.articleBlocks[1].claims.find(claim => claim.evidenceRequired).evidenceKeys = ['evidence-does-not-exist'];
  assert(validateArticleEvidence(unknown, articleContext).includes('RESEARCH_EVIDENCE_KEY_INVALID'));

  const noResearchBrief = { ...baseBrief, specificTopic: 'organizing a weekly planning checklist', readerQuestion: 'How can a team organize a weekly planning checklist?' };
  const noResearchContext = contextFor('research_evidence_pack', [briefDependency(noResearchBrief)]);
  const noResearchPack = await generateResearchEvidencePack(noResearchContext);
  assert.strictEqual(noResearchPack.noExternalEvidenceRequired, true);
  assert.deepStrictEqual(noResearchPack.sources, []);
  const noResearchArticleContext = contextFor('priority_search_article', [briefDependency(noResearchBrief), { deliverableId: 'research_evidence_pack', output: noResearchPack }]);
  const noResearchArticle = articleContract.generateOutput(noResearchArticleContext);
  assert.doesNotMatch(JSON.stringify(noResearchArticle.articleBlocks), /\[\d+\]/);

  const outagePack = await generateResearchEvidencePack(packContext, { adapter: createDeterministicResearchAdapter({ unavailable: true }) });
  assert.strictEqual(outagePack.essentialEvidenceMissing, false);
  assert(outagePack.unsupportedQuestions.length);
  const regulatedBrief = { ...baseBrief, specificTopic: 'current tax filing requirement', readerQuestion: 'What is the current tax filing requirement?' };
  const regulatedPack = await generateResearchEvidencePack(contextFor('research_evidence_pack', [briefDependency(regulatedBrief)]), { adapter: createDeterministicResearchAdapter({ unavailable: true }) });
  assert.strictEqual(regulatedPack.essentialEvidenceMissing, true);

  const generatedPack = await generateDeliverable({ handler: packContract, productionRun: { objective: 'improve_search_rankings', strategySnapshot: snapshot }, job: { deliverable_id: packContract.id, title: packContract.title, strategic_direction: 'Research only targeted needs.', strategySnapshot: snapshot, contract_version: packContract.version }, dependencyOutputs: [briefDependency(baseBrief)] });
  assert.strictEqual(generatedPack.provider, 'deterministic');
  assert.strictEqual(generatedPack.contractVersion, 'research_evidence_pack:v2');
  console.log('Story 3.238A Research-Backed Editorial Evidence tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
