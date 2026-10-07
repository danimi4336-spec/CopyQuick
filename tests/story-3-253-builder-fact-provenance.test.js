const assert = require('assert');

const { buildBusinessReflection } = require('../lib/businessReflection');
const { buildStrategy } = require('../lib/strategyEngine');
const { createProductionStrategySnapshot } = require('../lib/buildPlanApproval');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { validateSemanticCoherence } = require('../lib/productionSemantics');
const { buildProductionDelivery } = require('../lib/productionResultsPresentation');

function confirmed(value, label = value, semanticRole) {
  return { value, label, confidence: 1, source: 'user_confirmed', ...(semanticRole ? { semanticRole } : {}) };
}

const details = 'True Ceylon cinnamon (Cinnamomum verum), liposomal formulation, and 120 softgels';
const rawDescription = 'We are launching a premium organic Ceylon cinnamon supplement for adults interested in supporting healthy metabolism and everyday wellness. We plan to sell it online through our website and Amazon. We need help positioning the product and preparing the marketing for launch.';
const facts = {
  businessType: confirmed('physical_product', 'Physical Product'),
  industry: confirmed('health_wellness', 'Health & Wellness'),
  category: confirmed('dietary_supplement', 'Dietary Supplement'),
  intendedOutcome: confirmed('metabolic_wellness', 'Metabolic health & wellness'),
  conceptMaturity: confirmed('finalized', 'Product finalized'),
  existingProductDefinition: confirmed('A premium Ceylon cinnamon supplement', 'A premium Ceylon cinnamon supplement', 'builder_provided_product_context'),
  targetAudience: confirmed('adults interested in supporting healthy metabolism and everyday wellness'),
  launchStage: confirmed('ready', 'Ready to launch'),
  salesChannel: confirmed('multiple', 'Our website and Amazon'),
  competitiveDifferentiation: confirmed('clear', 'It has clear, meaningful differences'),
  competitiveDifferentiationDetails: confirmed(details)
};

const reflection = buildBusinessReflection({ objective: 'launch_product', answers: { initial_description: rawDescription }, understanding: facts });
const competitive = reflection.groups.find(group => group.domain === 'Competitive Context');
assert(competitive.fields.some(field => field.key === 'competitiveDifferentiation' && /clear, meaningful/.test(field.value)));
assert(competitive.fields.some(field => field.key === 'competitiveDifferentiationDetails' && /Cinnamomum verum/.test(field.value)));

const strategyResult = buildStrategy({ objective: 'launch_product', understanding: facts, confirmedUnderstanding: facts, answers: { initial_description: rawDescription } });
assert.match(strategyResult.strategy.competitiveApproach.value, /Ceylon cinnamon|Cinnamomum verum|liposomal|120 softgels/i);
assert.doesNotMatch(strategyResult.strategy.competitiveApproach.explanation, /differentiation still need(?:s)? to be established/i);
assert.match(strategyResult.strategy.competitiveApproach.explanation, /proof|substantiat|evidence/i);

const snapshot = createProductionStrategySnapshot({ objective: 'launch_product', strategyResult, confirmedUnderstanding: facts });
assert.strictEqual(snapshot.builderProductContext.semanticRole, 'builder_provided_product_context');
assert.strictEqual(snapshot.builderDifferentiationDetails.semanticRole, 'builder_provided_product_context');
assert.match(snapshot.builderDifferentiationDetails.value, /120 softgels/);

const context = {
  objective: 'launch_product', strategySnapshot: snapshot,
  strategicDirection: `Builder-provided offer description: ${rawDescription}. Treat this as unverified context, not proof of performance, demand, differentiation, claims, or substantiation.`
};
for (const id of ['amazon_listing', 'product_image_guidance', 'launch_announcement', 'educational_content', 'ecommerce_product_page']) {
  const contract = getProductionContract(id);
  const result = contract.generateOutput(context);
  assert.strictEqual(contract.validateOutput(result, context), true, `${id} schema`);
  assert.deepStrictEqual(validateCustomerReadyOutput(result, contract, context), { valid: true, code: null }, `${id} quality`);
}

const launch = getProductionContract('launch_announcement');
const safeComposition = launch.generateOutput(context);
safeComposition.body = 'Made with Cinnamomum verum (Ceylon cinnamon) in a liposomal formulation, with 120 softgels in the package. Review the product details to decide whether it fits your routine.';
assert.deepStrictEqual(validateCustomerReadyOutput(safeComposition, launch, context), { valid: true, code: null });
for (const unsafe of ['Clinically proven results.', 'Superior absorption.', 'FDA approved.', 'Certified organic.', 'Customers love it.', 'Guaranteed results.']) {
  const candidate = { ...safeComposition, body: unsafe };
  assert.strictEqual(validateCustomerReadyOutput(candidate, launch, context).valid, false, unsafe);
}

const image = getProductionContract('product_image_guidance');
const cautionary = image.generateOutput(context);
cautionary.avoidances = ['Do not imply unverified health outcomes.', 'Avoid suggesting superior absorption without evidence.', 'Do not use certification badges unless established.'];
assert.deepStrictEqual(validateCustomerReadyOutput(cautionary, image, context), { valid: true, code: null });

const ecommerce = getProductionContract('ecommerce_product_page');
const recomposed = ecommerce.generateOutput(context);
assert.deepStrictEqual(validateSemanticCoherence(recomposed, ecommerce, { semanticInsights: { rawBuilderDescription: { value: rawDescription } }, builderFacts: [details] }), { valid: true });
const copied = { ...recomposed, content: [rawDescription, 'Review the product details.'] };
assert.strictEqual(validateSemanticCoherence(copied, ecommerce, { semanticInsights: { rawBuilderDescription: { value: rawDescription } } }).code, 'PRODUCTION_QUALITY_RAW_DESCRIPTION_LEAK');
const lightlyEdited = { ...recomposed, content: [rawDescription.replace('We are launching', 'We are introducing').replace('We need help', 'We want help'), 'Review the product details.'] };
assert.strictEqual(validateSemanticCoherence(lightlyEdited, ecommerce, { semanticInsights: { rawBuilderDescription: { value: rawDescription } } }).code, 'PRODUCTION_QUALITY_RAW_DESCRIPTION_LEAK');

const jobs = [
  { deliverable_id: 'customer_profile', status: 'completed', readiness: 'AVAILABLE', artifactPolicy: { role: 'planning_foundation' } },
  { deliverable_id: 'product_positioning', status: 'completed', readiness: 'AVAILABLE', artifactPolicy: { role: 'planning_foundation' } },
  { deliverable_id: 'value_proposition', status: 'completed', readiness: 'AVAILABLE', artifactPolicy: { role: 'planning_foundation' } },
  { deliverable_id: 'core_messaging', status: 'completed', readiness: 'AVAILABLE', artifactPolicy: { role: 'planning_foundation' } },
  { deliverable_id: 'product_image_guidance', status: 'failed', readiness: 'COULD_NOT_COMPLETE', artifactPolicy: { role: 'planning_foundation' } },
  { deliverable_id: 'amazon_keyword_guidance', status: 'skipped', readiness: 'NOT_CREATED', artifactPolicy: { role: 'planning_foundation' } }
];
const delivery = buildProductionDelivery(jobs);
assert.strictEqual(delivery.supportingCount, 4);
assert.strictEqual(delivery.needsAttention.length, 2);

console.log('Story 3.253 Builder-Fact Provenance tests passed');
