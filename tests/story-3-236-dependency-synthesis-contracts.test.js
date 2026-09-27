const assert = require('assert');
const { buildProductionContext, generateDeliverable } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const {
  CONSUMERS, SUPPORTED_CONCEPTS, buildSynthesisContext, decisionValue, extractDecisions,
  resolveDecisions, validateSynthesis
} = require('../lib/productionDependencySynthesis');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

function contract(id) { return getProductionContract(id); }
function dep(id, output) { return { deliverableId: id, title: contract(id).title, contractVersion: contract(id).version, output }; }
function context(id, dependencies, strategySnapshot = {}) {
  return buildProductionContext({
    productionRun: { objective: id.startsWith('search_') || id === 'priority_content_brief' ? 'improve_search_rankings' : 'launch_product', strategySnapshot },
    job: { deliverable_id: id, title: contract(id).title, strategic_direction: 'Create distinct decision-useful work.', strategySnapshot, contract_version: contract(id).version },
    dependencyOutputs: dependencies
  });
}

assert(SUPPORTED_CONCEPTS.length < 30, 'registry remains deliberately bounded');
assert(CONSUMERS.product_positioning && CONSUMERS.value_proposition && CONSUMERS.lead_capture_page && CONSUMERS.search_strategy);

const profile = {
  summary: 'Homeowners planning major renovations need a credible way to evaluate fit.',
  primaryCustomer: 'Homeowners planning major renovations',
  needs: ['A clear renovation plan with transparent scope'],
  motivations: ['Confidence in the project path'],
  objections: ['Concern about unclear scope and proof'],
  buyingTriggers: ['A documented process and proportionate next step'],
  languageStyle: 'Specific, reassuring, and evidence-aware'
};
const concept = {
  conceptSummary: 'A working digestive wellness concept, not a finished product.',
  directionsToExplore: ['Gut microbiome support — investigate relevance before formulation.'],
  customerAndNeed: 'Adults exploring digestive wellness.',
  openDecisions: ['Formulation and ingredients remain unresolved.'],
  evidenceBoundaries: ['Exploration is not product composition or efficacy evidence.'],
  nextDefinitionSteps: ['Validate the direction before defining the product.']
};
assert(contract('customer_profile').validateOutput(profile));
assert(contract('product_concept_brief').validateOutput(concept));
const profileDecisions = extractDecisions('customer_profile', profile);
assert(profileDecisions.some(item => item.concept === 'primary_audience' && item.provenance === 'generated_strategy'));
assert.strictEqual(
  extractDecisions('customer_profile', { ...profile, primaryCustomer: 'Adults — inferred from the product description and requiring validation' })
    .find(item => item.concept === 'primary_audience').value,
  'Adults',
  'customer-readable value remains separate from provenance guidance'
);
assert(profileDecisions.some(item => item.concept === 'customer_objection' && item.provenance === 'hypothesis'));
const conceptDecisions = extractDecisions('product_concept_brief', concept);
assert(conceptDecisions.some(item => item.concept === 'exploration_direction' && item.provenance === 'exploration_intent'));
assert(conceptDecisions.some(item => item.concept === 'unresolved_question' && item.unresolved));

const productStrategy = {
  primaryCustomer: { value: 'Homeowners planning major renovations', semanticRole: 'confirmed_fact' },
  customerMotivation: { value: 'A clear renovation plan with transparent scope', semanticRole: 'confirmed_fact' },
  marketPosition: { value: 'A transparent planning partner', semanticRole: 'strategic_recommendation' },
  competitiveApproach: { value: 'Clarity and documented proof', semanticRole: 'strategic_recommendation' }
};
const positioningContext = context('product_positioning', [dep('customer_profile', profile), dep('product_concept_brief', concept)], productStrategy);
assert.strictEqual(positioningContext.synthesis.enabled, true);
assert.match(positioningContext.synthesisSummary, /Audience: Homeowners planning major renovations/);
assert.doesNotMatch(positioningContext.synthesisSummary, /sourceDeliverable|contractVersion|semanticRole|dependencyOutputs/);
assert(!positioningContext.synthesis.decisions.some(item => item.concept === 'buying_trigger'), 'consume allowlist filters irrelevant decisions');
const positioning = contract('product_positioning').generateOutput(positioningContext);
assert.match(positioning.positioningStatement, /Homeowners planning major renovations/);
assert.match(JSON.stringify(positioning.proofPoints), /unclear scope and proof/i);
assert.doesNotMatch(JSON.stringify(positioning), /contains gut microbiome|clinically proven|formulated with/i);
assert.strictEqual(validateCustomerReadyOutput(positioning, contract('product_positioning'), positioningContext).valid, true);

const positioningDecisions = extractDecisions('product_positioning', positioning);
assert(positioningDecisions.some(item => item.concept === 'positioning_direction' && item.provenance === 'generated_strategy'));
const valueContext = context('value_proposition', [dep('customer_profile', profile), dep('product_positioning', positioning)], productStrategy);
const value = contract('value_proposition').generateOutput(valueContext);
assert.match(value.primaryValueProposition, /transparent planning partner/i);
assert.match(JSON.stringify(value), /status quo/i);
assert.notStrictEqual(value.primaryValueProposition, positioning.positioningStatement);
assert.strictEqual(validateCustomerReadyOutput(value, contract('value_proposition'), valueContext).valid, true);

const conflicting = resolveDecisions([
  ...extractDecisions('customer_profile', profile),
  ...extractDecisions('customer_profile', { ...profile, primaryCustomer: 'Adults' })
]);
assert(conflicting.conflicts.some(item => item.concept === 'primary_audience'), 'same-level single-value conflict fails');
const confirmedOverride = buildSynthesisContext({
  dependentId: 'product_positioning', dependencyOutputs: [dep('customer_profile', { ...profile, primaryCustomer: 'Adults' })],
  strategySnapshot: { primaryCustomer: { value: 'Homeowners planning major renovations', semanticRole: 'confirmed_fact' } }
});
assert.strictEqual(decisionValue({ synthesis: confirmedOverride }, 'primary_audience'), 'Homeowners planning major renovations');

const campaignStrategy = {
  primaryCustomer: { value: 'Virginia homeowners planning major renovations', semanticRole: 'confirmed_fact' },
  confirmedOffer: { value: 'Kitchen, bathroom, and whole-home renovations', semanticRole: 'confirmed_fact' },
  confirmedPrimaryCta: { value: 'Book a consultation', semanticRole: 'confirmed_fact' },
  businessObjective: { value: 'Generate qualified local consultations', semanticRole: 'confirmed_fact' },
  marketingFocus: { value: 'Plan major renovations with transparent scope and proof', semanticRole: 'strategic_recommendation' }
};
const campaignBrief = contract('campaign_brief').generateOutput({
  objective: 'get_more_customers', strategicDirection: 'Coordinate a qualified local-lead campaign.', strategySnapshot: campaignStrategy, dependencyOutputs: []
});
assert(contract('campaign_brief').validateOutput(campaignBrief));
assert.strictEqual(campaignBrief.callToAction, 'Book a consultation');
const conversionPath = { summary: 'A measured consultation path.', content: ['Awareness to qualified consultation with verified proof.'] };
const campaignDeps = [dep('campaign_brief', campaignBrief), dep('conversion_path_brief', conversionPath)];
const siblingIds = ['lead_capture_page', 'outreach_sequence', 'paid_ad_copy_set'];
const siblings = {};
for (const id of siblingIds) {
  const siblingContext = context(id, campaignDeps, campaignStrategy);
  assert.strictEqual(siblingContext.synthesis.conflicts.length, 0);
  siblings[id] = contract(id).generateOutput(siblingContext);
  const siblingQuality = validateCustomerReadyOutput(siblings[id], contract(id), siblingContext);
  assert.strictEqual(siblingQuality.valid, true, `${id}: ${JSON.stringify(siblingQuality)}`);
  assert.match(JSON.stringify(siblings[id]), /Virginia homeowners planning major renovations/i);
  assert.match(JSON.stringify(siblings[id]), /Kitchen, bathroom, and whole-home renovations/i);
  assert.match(JSON.stringify(siblings[id]), /Book a consultation/i);
  assert.doesNotMatch(JSON.stringify(siblings[id]), /synthesisTrace|sourceDeliverable|SYNTHESIS_|dependencyOutputs/);
}
assert(siblings.lead_capture_page.headline && siblings.outreach_sequence.email1Subject && siblings.paid_ad_copy_set.ad1Headline, 'siblings remain channel-distinct');

const unresolvedCampaign = { ...campaignBrief, callToAction: 'Not established' };
const unresolvedContext = context('lead_capture_page', [dep('campaign_brief', unresolvedCampaign), dep('conversion_path_brief', conversionPath)], { ...campaignStrategy, confirmedPrimaryCta: undefined });
assert.strictEqual(validateSynthesis(contract('lead_capture_page').generateOutput(unresolvedContext), contract('lead_capture_page'), unresolvedContext).code, 'SYNTHESIS_UNRESOLVED_PROMOTED');

const searchStrategySnapshot = {
  primaryCustomer: { value: 'Small-business accounting software teams', semanticRole: 'confirmed_fact' },
  topicTerritory: { value: 'bookkeeping; invoicing; cash flow', semanticRole: 'confirmed_fact' }
};
const evidence = contract('search_evidence_snapshot').generateOutput({ strategySnapshot: searchStrategySnapshot, strategicDirection: 'Build evidence-aware search authority.' });
assert(contract('search_evidence_snapshot').validateOutput(evidence));
assert.match(evidence.evidenceStatus, /not established/i);
assert.doesNotMatch(JSON.stringify(evidence), /search volume:\s*\d|ranking:\s*\d|monthly searches/i);
const strategyContext = context('search_strategy', [dep('search_evidence_snapshot', evidence)], searchStrategySnapshot);
const searchStrategy = contract('search_strategy').generateOutput(strategyContext);
assert.match(searchStrategy.authorityDirection, /bookkeeping|invoicing|cash flow/i);
assert.strictEqual(validateCustomerReadyOutput(searchStrategy, contract('search_strategy'), strategyContext).valid, true);
const briefContext = context('priority_content_brief', [dep('search_evidence_snapshot', evidence), dep('search_strategy', searchStrategy)], searchStrategySnapshot);
const brief = contract('priority_content_brief').generateOutput(briefContext);
assert.strictEqual(brief.specificTopic, 'bookkeeping', 'content brief narrows the strategy territory to one priority topic');
assert.match(brief.readerQuestion, /evaluate/i);
assert.notStrictEqual(brief.summary, searchStrategy.summary);
assert.strictEqual(validateCustomerReadyOutput(brief, contract('priority_content_brief'), briefContext).valid, true);

assert.strictEqual(buildSynthesisContext({ dependentId: 'campaign_brief', contractVersion: 'campaign_brief:v3' }).enabled, false);
assert.strictEqual(contract('campaign_brief').validateOutput({ summary: 'Historical campaign brief', content: ['Historical planning guidance'] }, { contractVersion: 'campaign_brief:v3' }), true);

(async () => {
  let providerPrompt = '';
  const provider = {
    provider: 'test-provider', model: 'test-model',
    async generateStructuredDeliverable(input) {
      providerPrompt = input.prompt;
      return positioning;
    }
  };
  const generated = await generateDeliverable({
    handler: contract('product_positioning'), generatorApi: provider,
    providerRuntime: { run: ({ invoke }) => invoke({}) },
    productionRun: { user_id: 1, objective: 'launch_product', strategySnapshot: productStrategy },
    job: { deliverable_id: 'product_positioning', title: 'Product Positioning', strategic_direction: 'Choose a distinct positioning frame.', strategySnapshot: productStrategy, contract_version: contract('product_positioning').version },
    dependencyOutputs: [dep('customer_profile', profile), dep('product_concept_brief', concept)]
  });
  assert.strictEqual(generated.structuredOutput.positioningStatement, positioning.positioningStatement);
  assert.match(providerPrompt, /Approved synthesis decisions/);
  assert.doesNotMatch(providerPrompt, /sourceDeliverable|sourceField|permittedUses|synthesisTrace|contractVersion|dependencyOutputs/);
  console.log('Story 3.236 Dependency Synthesis Contracts tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
