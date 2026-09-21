const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const handler = getProductionContract('organic_content_campaign');
const strategySnapshot = {
  confirmedOffer: { value: 'An Austin landscaping company offering drought-tolerant design, irrigation assessments, seasonal cleanups, and recurring lawn maintenance', semanticRole: 'confirmed_fact' },
  primaryCustomer: { value: 'Austin-area homeowners who want attractive, lower-maintenance outdoor spaces', semanticRole: 'confirmed_fact' },
  customerMotivation: { value: 'Generate qualified leads', semanticRole: 'confirmed_fact' },
  marketingFocus: { value: 'Validate supplied topics: drought-tolerant landscaping; irrigation assessment; low-maintenance yard ideas', semanticRole: 'strategic_recommendation' },
  confirmedPrimaryCta: { value: 'Schedule a landscape consultation', semanticRole: 'confirmed_fact' }
};
const context = buildProductionContext({
  productionRun: { objective: 'improve_search_rankings', strategySnapshot },
  job: {
    deliverable_id: handler.id,
    title: handler.title,
    strategic_direction: 'Create grounded landscaping education.',
    strategySnapshot
  },
  dependencyOutputs: []
});

assert.strictEqual(context.compositionBrief.domainId, 'landscaping_services');
assert.strictEqual(context.compositionBrief.primaryTopic, 'drought-tolerant landscaping');
assert.deepStrictEqual(context.compositionBrief.supportingTopics, ['irrigation assessment', 'low-maintenance yard ideas']);
assert(context.compositionBrief.domainVocabulary.includes('irrigation compatibility'));
assert(context.compositionBrief.decisionDimensions.includes('the property conditions that shape the project'));

const prompt = handler.buildPrompt(context);
assert.match(prompt, /Intermediate composition brief:/);
assert.match(prompt, /Industry\/service domain: residential landscaping services/);
assert.match(prompt, /Primary article topic: drought-tolerant landscaping/);
assert.match(prompt, /do not concatenate every supplied topic into the title/i);

const fallback = handler.generateOutput(context);
assert.strictEqual(fallback.pillarTitle, 'A practical guide to drought-tolerant landscaping');
assert.doesNotMatch(fallback.pillarTitle, /irrigation assessment|low-maintenance yard ideas/i);
assert(fallback.outline.some(item => /property conditions/i.test(item)));
assert.match(fallback.introduction, /property conditions/i);
assert.strictEqual(handler.validateOutput(fallback, context), true);
assert.deepStrictEqual(validateCustomerReadyOutput(fallback, handler, context), { valid: true, code: null });

console.log('Story 3.230 Organic Composition Layer tests passed');
