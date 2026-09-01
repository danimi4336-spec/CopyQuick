const assert = require('assert');

const { buildPlan } = require('../lib/buildPlanEngine');
const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { MINIMUM_PRODUCTION_DEPENDENCIES, minimumProductionDependencies } = require('../lib/productionDependencyPolicy');

for (const id of getProductionContractIds()) {
  assert(Object.hasOwn(MINIMUM_PRODUCTION_DEPENDENCIES, id), `${id} requires an explicit dependency policy`);
  assert.deepStrictEqual(getProductionContract(id).requiredDependencies, minimumProductionDependencies(id), id);
}

const field = (value, label = value) => ({ value, label, confidence: 1, source: 'user_confirmed' });
const understanding = {
  businessType: field('physical_product'), industry: field('health_wellness'), category: field('dietary_supplement'),
  intendedOutcome: field('digestive_wellness'), conceptMaturity: field('finalized'), launchStage: field('ready'),
  targetAudience: field('adults'), salesChannel: field('amazon'), existingProductDefinition: {
    ...field('Herbal capsules in finalized packaging'), semanticRole: 'builder_provided_product_context'
  }
};
const recommendation = value => ({ value, confidence: 0.8, semanticRole: 'strategic_recommendation' });
const plan = buildPlan({
  objective: 'launch_product', confirmedUnderstanding: understanding,
  answers: { initial_description: 'Herbal capsules for adults on Amazon' },
  strategyResult: { strategy: {
    marketPosition: recommendation('Natural Digestive Wellness Direction'),
    primaryCustomer: { value: 'Adults', confidence: 1, semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Digestive health', confidence: 1, semanticRole: 'confirmed_fact' },
    competitiveApproach: recommendation('Trust, Quality, and Proof'), communicationStyle: recommendation('Clear and reassuring'),
    marketingFocus: recommendation('Marketplace education and trust'), launchApproach: recommendation('Education Before Promotion')
  } }
});
for (const item of plan.phases.flatMap(phase => phase.deliverables)) {
  const minimum = minimumProductionDependencies(item.id);
  assert(minimum.every(id => item.dependencies.includes(id)), `${item.id} plan must contain every contract dependency`);
}

console.log('Story 3.90 Shared Production Dependencies tests passed');
