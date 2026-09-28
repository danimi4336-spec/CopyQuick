const assert = require('assert');
const { buildPlan } = require('../lib/buildPlanEngine');
const { buildProductionContext, generateDeliverable } = require('../lib/generationService');
const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { MINIMUM_PRODUCTION_DEPENDENCIES } = require('../lib/productionDependencyPolicy');
const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { searchEditorialFailures, riskClassification } = require('../lib/productionSearchEditorial');

const contract = getProductionContract('priority_search_article');
const strategySnapshot = {
  primaryCustomer: { value: 'Small business owners', semanticRole: 'confirmed_fact' },
  confirmedOffer: { value: 'Online accounting software', semanticRole: 'confirmed_fact' },
  topicTerritory: { value: 'bookkeeping; invoicing; cash flow', semanticRole: 'confirmed_fact' }
};

function brief(overrides = {}) {
  return {
    summary: 'A focused decision brief for one search-informed article.',
    content: ['Reader: Small business owners.', 'Use a practical evidence-aware angle.'],
    specificTopic: 'invoicing and cash-flow visibility',
    readerQuestion: 'How can a small business use an invoicing routine to improve cash-flow visibility?',
    searchIntentHypothesis: 'Small business owners seeking practical invoicing guidance',
    contentAngle: 'A practical workflow that distinguishes billed amounts, received cash, and outstanding invoices.',
    scope: 'Explain a safe general invoicing review process without tax, legal, or product-capability claims.',
    callToActionStatus: 'Not established',
    evidenceLimits: ['Do not invent search metrics, current accounting requirements, or software capabilities.'],
    ...overrides
  };
}

function context(briefOutput = brief(), snapshot = strategySnapshot) {
  return buildProductionContext({
    productionRun: { objective: 'improve_search_rankings', strategySnapshot: snapshot },
    job: {
      deliverable_id: contract.id, title: contract.title, strategic_direction: 'Create one useful search-informed article.',
      strategySnapshot: snapshot, contract_version: contract.version
    },
    dependencyOutputs: [
      { deliverableId: 'priority_content_brief', title: 'Priority Content Brief', contractVersion: 'priority_content_brief:v4', output: briefOutput },
      { deliverableId: 'research_evidence_pack', title: 'Research Evidence Pack', contractVersion: 'research_evidence_pack:v1', output: {
        researchSummary: 'No external evidence required for this article.', researchQuestions: [], sourcesUsed: [], supportedFindings: [], unsupportedQuestions: [], conflicts: [], freshnessNotes: ['No external source freshness review was required.'], sources: [], evidenceItems: [], claimMappings: [], rejectedSources: [], researchTrace: [], noExternalEvidenceRequired: true, essentialEvidenceMissing: false
      } }
    ]
  });
}

function invalidWith(mutator) {
  const ctx = context();
  const output = structuredClone(contract.generateOutput(ctx));
  mutator(output);
  return { output, ctx, result: validateCustomerReadyOutput(output, contract, ctx) };
}

assert(contract, 'dedicated contract exists');
assert.strictEqual(contract.id, 'priority_search_article');
assert.strictEqual(contract.title, 'Priority Search Article');
assert.strictEqual(contract.version, 'priority_search_article:v2');
assert.strictEqual(contract.validationProfile.family, 'search_editorial');
assert.strictEqual(contract.readyToUse, true);
assert.strictEqual(getProductionArtifactPolicy(contract.id).readyToUse, true);
assert.deepStrictEqual(contract.requiredDependencies, ['priority_content_brief', 'research_evidence_pack']);
assert.deepStrictEqual(MINIMUM_PRODUCTION_DEPENDENCIES.priority_search_article, ['priority_content_brief', 'research_evidence_pack']);
assert(!contract.requiredDependencies.includes('search_measurement_plan'));

const understanding = { websiteContext: { value: 'Accounting software site' } };
const plan = buildPlan({
  objective: 'improve_search_rankings', confirmedUnderstanding: understanding,
  strategyResult: { strategy: strategySnapshot }, answers: {}
});
const planItems = plan.phases.flatMap(phase => phase.deliverables);
const articleItem = planItems.find(item => item.id === contract.id);
assert(articleItem);
assert.strictEqual(articleItem.recommendationLevel, 'recommended');
assert.deepStrictEqual(articleItem.dependencies, ['priority_content_brief', 'research_evidence_pack']);

const ctx = context();
assert.strictEqual(ctx.synthesis.enabled, true);
assert.deepStrictEqual(ctx.synthesis.missing, []);
for (const concept of ['primary_audience', 'content_topic', 'reader_question', 'search_intent', 'content_angle', 'content_scope', 'evidence_limit']) {
  assert(ctx.synthesis.decisions.some(item => item.concept === concept), concept);
}
assert.doesNotMatch(ctx.synthesis.summary, /sourceDeliverable|sourceField|synthesisTrace|contract_version/);
const output = contract.generateOutput(ctx);
assert.strictEqual(contract.validateOutput(output, ctx), true);
assert.strictEqual(validateCustomerReadyOutput(output, contract, ctx).valid, true);
assert(output.title && output.summary && output.articleBlocks.length >= 5 && output.practicalTakeaways.length >= 3 && output.conclusion);
assert.strictEqual(output.callToAction, '');
assert(output.evidenceOpportunities.length && output.claimsToVerify.length && output.editorialReviewNotes.length);
assert.match(JSON.stringify(output.articleBlocks), /invoice|receivable|cash/i);
assert.match(JSON.stringify(output.articleBlocks), /Small business owners/i);
assert.doesNotMatch(JSON.stringify(output.articleBlocks), /search volume|rank(?:ing)? #|according to|integration|AI-powered/i);

const sections = contract.presentationSections(output);
assert(sections.find(item => item.key === 'articleBlocks' && !item.internal && item.format === 'markdown'));
assert(!sections.some(item => item.key === 'callToAction'));
for (const key of ['evidenceOpportunities', 'claimsToVerify', 'productFactsUsed', 'editorialReviewNotes']) {
  assert(sections.find(item => item.key === key && item.internal), key);
}
const publicPresentation = sections.filter(item => !item.internal).map(item => item.value).join('\n');
assert.doesNotMatch(publicPresentation, /evidenceOpportunities|claimsToVerify|productFactsUsed|editorialReviewNotes|synthesisTrace/);

const changedTopicContext = context(brief({
  specificTopic: 'cash-flow review cadence',
  readerQuestion: 'How should a small business review expected incoming cash?',
  contentAngle: 'A repeatable review cadence for outstanding invoices and received cash.'
}));
const changedTopic = contract.generateOutput(changedTopicContext);
assert.notStrictEqual(changedTopic.title, output.title);
assert.notStrictEqual(changedTopic.summary, output.summary);

const audienceSnapshot = { ...strategySnapshot, primaryCustomer: { value: 'Freelance designers', semanticRole: 'confirmed_fact' } };
const audienceOutput = contract.generateOutput(context(brief(), audienceSnapshot));
assert.match(audienceOutput.summary, /Freelance designers/);

const ctaContext = context(brief({ callToActionStatus: 'Review the invoicing checklist' }));
const ctaOutput = contract.generateOutput(ctaContext);
assert.strictEqual(ctaOutput.callToAction, 'Review the invoicing checklist');
assert.strictEqual(validateCustomerReadyOutput(ctaOutput, contract, ctaContext).valid, true);

const negativeCases = [
  ['search metric', value => `${value} This keyword has 12,000 monthly searches.`],
  ['ranking', value => `${value} This page will rank #1.`],
  ['traffic', value => `${value} It increased traffic 37%.`],
  ['citation', value => `${value} According to a 2025 study [1], this is proven.`],
  ['authority', value => `${value} Research shows experts agree.`],
  ['integration', value => `${value} The software integrates with every bank.`],
  ['tax', value => `${value} You must file this by the tax deadline.`],
  ['internal metadata', value => `${value} synthesisTrace sourceDeliverable.`]
];
for (const [name, append] of negativeCases) {
  const fixture = invalidWith(candidate => { candidate.articleBlocks[1].body = append(candidate.articleBlocks[1].body); });
  assert.strictEqual(fixture.result.valid, false, name);
}

const generic = invalidWith(candidate => { candidate.articleBlocks[0].body = "In today's competitive digital landscape, businesses need to take things to the next level."; });
assert.strictEqual(generic.result.valid, false);
const duplicate = invalidWith(candidate => { candidate.articleBlocks[2].body = candidate.articleBlocks[1].body; });
assert.strictEqual(duplicate.result.valid, false);
const inventedCta = invalidWith(candidate => { candidate.callToAction = 'Start your free trial'; });
assert.strictEqual(inventedCta.result.valid, false);

const remodelingContext = context(brief({
  specificTopic: 'planning a major home renovation',
  readerQuestion: 'How should homeowners prepare for a major renovation planning conversation?',
  searchIntentHypothesis: 'Homeowners seeking a planning framework',
  contentAngle: 'A scope-and-decision checklist before professional review.',
  scope: 'General planning only; exclude local permit, price, schedule, licensing, code, and ROI claims.'
}), { ...strategySnapshot, primaryCustomer: { value: 'Homeowners planning major renovations', semanticRole: 'confirmed_fact' }, confirmedOffer: { value: 'Residential remodeling', semanticRole: 'confirmed_fact' } });
const remodeling = contract.generateOutput(remodelingContext);
assert.strictEqual(riskClassification(remodelingContext), 'review_sensitive');
assert.strictEqual(validateCustomerReadyOutput(remodeling, contract, remodelingContext).valid, true);
assert.doesNotMatch(JSON.stringify(remodeling.articleBlocks), /permit required|costs? \$|takes? \d+ weeks|ROI of/i);

const supplementContext = context(brief({
  specificTopic: 'digestive wellness education',
  readerQuestion: 'What questions can adults use when learning about digestive wellness?',
  searchIntentHypothesis: 'Adults seeking general non-claim education',
  contentAngle: 'A question framework that avoids efficacy and treatment claims.',
  scope: 'Non-claim general education only.'
}), { ...strategySnapshot, primaryCustomer: { value: 'Adults exploring digestive wellness', semanticRole: 'confirmed_fact' }, confirmedOffer: { value: 'Dietary supplement concept', semanticRole: 'confirmed_fact' } });
const supplement = contract.generateOutput(supplementContext);
assert.strictEqual(riskClassification(supplementContext), 'claim_restricted');
assert.strictEqual(validateCustomerReadyOutput(supplement, contract, supplementContext).valid, true);
const unsafeSupplement = structuredClone(supplement);
unsafeSupplement.articleBlocks[1].body += ' This dosage treats disease and is safe for everyone.';
assert.strictEqual(validateCustomerReadyOutput(unsafeSupplement, contract, supplementContext).valid, false);

const prompt = contract.buildPrompt(ctx);
assert.match(prompt, /Approved synthesis decisions/);
assert.match(prompt, /Evidence limit|evidence/i);
assert.match(prompt, /Small business owners/);
assert.doesNotMatch(prompt, /synthesisTrace|sourceDeliverable|sourceField|permittedUses|production_job_id|deliverable_id/);

(async () => {
  const generated = await generateDeliverable({
    handler: contract,
    productionRun: { user_id: 1, objective: 'improve_search_rankings', strategySnapshot },
    job: { deliverable_id: contract.id, title: contract.title, strategic_direction: 'Create one useful search-informed article.', strategySnapshot, contract_version: contract.version },
    dependencyOutputs: context().dependencyOutputs
  });
  assert.strictEqual(generated.contractVersion, 'priority_search_article:v2');
  assert.strictEqual(generated.structuredOutput.callToAction, '');
  assert.match(JSON.stringify(generated.structuredOutput.articleBlocks), /invoice|receivable|cash/i);
  assert.doesNotMatch(JSON.stringify(generated.structuredOutput), /synthesisTrace|sourceDeliverable|SYNTHESIS_/);
  assert(getProductionContractIds().includes('organic_content_campaign'), 'historical organic contract remains registered');
  console.log('Story 3.237 Domain-Useful Search Execution tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
