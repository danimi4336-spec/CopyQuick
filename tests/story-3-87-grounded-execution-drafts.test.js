const assert = require('assert');

const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const ids = [
  'amazon_a_plus', 'ecommerce_product_page', 'ecommerce_trust_faq',
  'ecommerce_conversion_copy', 'abandoned_cart_email', 'google_business_profile',
  'service_page', 'software_product_demo', 'saas_trial_emails'
];
const offer = 'A bookkeeping setup service for independent restaurant owners';
const context = {
  strategicDirection: `Recommended communication direction · Builder-provided offer description: ${offer}. Treat this as unverified context, not proof of performance, demand, differentiation, claims, or substantiation.`,
  strategySnapshot: {
    primaryCustomer: { value: 'Independent restaurant owners', semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Simpler bookkeeping setup', semanticRole: 'confirmed_fact' }
  },
  dependencyOutputs: []
};

for (const id of ids) {
  const contract = getProductionContract(id);
  const output = contract.generateOutput({ ...context, title: id });
  assert.strictEqual(contract.validateOutput(output), true, id);
  assert.strictEqual(validateCustomerReadyOutput(output, contract).valid, true, id);
  assert.match(JSON.stringify(output), new RegExp(offer), id);
  assert.match(JSON.stringify(output), /verify|confirm|implemented features/i, id);
  assert.doesNotMatch(JSON.stringify(output), /To be confirmed|clinically proven|guaranteed results|trusted by \d/i, id);

  const missing = contract.generateOutput({ ...context, strategicDirection: 'Recommended communication direction' });
  assert.strictEqual(contract.validateOutput(missing), false, `${id} must fail closed without offer context`);
}

console.log('Story 3.87 Grounded Execution Drafts tests passed');
