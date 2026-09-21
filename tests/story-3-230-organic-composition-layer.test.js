const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { evaluateCompositionFit } = require('../lib/productionComposition');
const { evaluateSubstantiveUsefulness } = require('../lib/productionUsefulness');

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

const petStrategySnapshot = {
  confirmedOffer: { value: 'A Denver mobile dog-grooming service offering bathing, coat trimming, nail care, and recurring appointments', semanticRole: 'confirmed_fact' },
  primaryCustomer: { value: 'Denver dog owners who value convenient, low-stress grooming', semanticRole: 'confirmed_fact' },
  customerMotivation: { value: 'Generate qualified leads', semanticRole: 'confirmed_fact' },
  marketingFocus: { value: 'Validate supplied topics: mobile dog grooming; preparing a dog for grooming; recurring grooming schedules', semanticRole: 'strategic_recommendation' },
  confirmedPrimaryCta: { value: 'Schedule a mobile grooming appointment', semanticRole: 'confirmed_fact' }
};
const petContext = buildProductionContext({
  productionRun: { objective: 'improve_search_rankings', strategySnapshot: petStrategySnapshot },
  job: { deliverable_id: handler.id, title: handler.title, strategic_direction: 'Create grounded pet-care education.', strategySnapshot: petStrategySnapshot },
  dependencyOutputs: []
});
assert.strictEqual(petContext.compositionBrief.domainId, 'pet_care_services');
assert(petContext.compositionBrief.domainVocabulary.includes('pet temperament'));
assert(petContext.compositionBrief.decisionDimensions.some(item => /coat, skin, age/i.test(item)));
const petFallback = handler.generateOutput(petContext);
assert.match(petFallback.introduction, /coat, skin, age/i);
assert.match(petFallback.introduction, /temperament, handling needs/i);
assert.doesNotMatch(petFallback.introduction, /warranty responsibilities|construction materials/i);
assert.strictEqual(evaluateCompositionFit(petFallback, petContext.compositionBrief).valid, true);
assert.deepStrictEqual(validateCustomerReadyOutput(petFallback, handler, petContext), { valid: true, code: null });
const petUsefulness = evaluateSubstantiveUsefulness(petFallback, handler, petContext);
assert.strictEqual(petUsefulness.valid, true, JSON.stringify(petUsefulness));
assert(petUsefulness.metrics.coveredTopics.length >= 4);
assert(petUsefulness.metrics.coveredTopics.every(topic => petContext.compositionBrief.decisionDimensions.includes(topic)),
  'usefulness is measured against the active industry composition rather than bookkeeping-only vocabulary');
const mismatchedPetOutput = {
  ...petFallback,
  introduction: petFallback.introduction
    .replace(/the pet’s coat, skin, age, and current condition/gi, 'the property condition')
    .replace(/temperament, handling needs, and the working environment/gi, 'construction materials')
};
assert.strictEqual(validateCustomerReadyOutput(mismatchedPetOutput, handler, petContext).code, 'PRODUCTION_QUALITY_DOMAIN_FIT');
const coatCompositionLanguage = {
  ...petFallback,
  introduction: petFallback.introduction.replace(
    'Consider the pet’s coat, skin, age, and current condition, temperament, handling needs, and the working environment, which grooming services are included and appropriate.',
    'Consider whether a double coat contains a dense undercoat that changes the grooming approach.'
  )
};
assert.notStrictEqual(validateCustomerReadyOutput(coatCompositionLanguage, handler, petContext).code,
  'PRODUCTION_QUALITY_UNSUPPORTED_CLAIM',
  'ordinary industry prose using “contains” is not misclassified as an unsupported product-ingredient claim');

console.log('Story 3.230 Organic Composition Layer tests passed');
