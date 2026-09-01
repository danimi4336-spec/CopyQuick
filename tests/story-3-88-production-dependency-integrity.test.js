const assert = require('assert');

const { generateDeliverable } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const fixedDependencies = {
  amazon_listing: ['product_positioning', 'core_messaging'], amazon_bullet_points: ['amazon_listing'],
  amazon_a_plus: ['amazon_listing', 'core_messaging'], ecommerce_product_page: ['product_positioning', 'core_messaging'],
  ecommerce_trust_faq: ['ecommerce_product_page'], ecommerce_conversion_copy: ['ecommerce_product_page'],
  abandoned_cart_email: ['ecommerce_product_page', 'core_messaging'], google_business_profile: ['core_messaging'],
  service_page: ['product_positioning', 'core_messaging'], product_image_guidance: ['product_positioning'],
  software_product_demo: ['core_messaging'], saas_trial_emails: ['software_product_demo', 'core_messaging'],
  launch_announcement: ['core_messaging'], educational_content: ['core_messaging'],
  social_launch_campaign: ['core_messaging', 'launch_announcement']
};

for (const [id, dependencies] of Object.entries(fixedDependencies)) {
  assert.deepStrictEqual(getProductionContract(id).requiredDependencies, dependencies, id);
}
// This dependency varies by planning stage and remains enforced by the approved job graph.
assert.deepStrictEqual(getProductionContract('amazon_keyword_guidance').requiredDependencies, []);

const product = 'Herbal capsules with finalized packaging and a 60-count bottle';
const imageContract = getProductionContract('product_image_guidance');
const context = {
  title: 'Product Image Guidance',
  strategicDirection: `Builder-provided product context: ${product}. Treat this as unverified context, not proof of ingredients, efficacy, claims, or substantiation.`,
  strategySnapshot: {},
  dependencyOutputs: [{ deliverableId: 'product_positioning', output: { positioningStatement: 'Explore a transparent digestive-wellness positioning direction.' } }]
};
const imageOutput = imageContract.generateOutput(context);
assert.strictEqual(imageContract.validateOutput(imageOutput), true);
assert.strictEqual(validateCustomerReadyOutput(imageOutput, imageContract).valid, true);
assert.match(JSON.stringify(imageOutput), new RegExp(product));
assert.match(JSON.stringify(imageOutput), /confirm|verified|unverified/i);
assert.doesNotMatch(JSON.stringify(imageOutput), /To be confirmed|clinically proven|guaranteed/i);
assert.strictEqual(imageContract.validateOutput(imageContract.generateOutput({ ...context, strategicDirection: 'Prepare accurate imagery.' })), false);

async function run() {
  const handler = getProductionContract('launch_announcement');
  await assert.rejects(generateDeliverable({
    handler,
    productionRun: { objective: 'launch_product', strategySnapshot: {} },
    job: { deliverable_id: 'launch_announcement', title: 'Launch Announcement', strategic_direction: 'Create a grounded draft.', strategySnapshot: {} },
    dependencyOutputs: []
  }), error => error.code === 'DEPENDENCY_CONTRACT_MISSING');
  console.log('Story 3.88 Production Dependency Integrity tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
