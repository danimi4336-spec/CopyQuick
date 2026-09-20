const assert = require('assert');
const { buildProductionContext, generateDeliverable } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');

const handler = getProductionContract('customer_profile');
const strategySnapshot = {
  primaryCustomer: { value: 'Busy parents', semanticRole: 'confirmed_fact' },
  customerMotivation: { value: 'Save time', semanticRole: 'confirmed_fact' },
  communicationStyle: { value: 'Clear', semanticRole: 'strategic_recommendation' }
};
const brandContext = {
  businessName: 'LunchLoop', voice: 'Warm and practical',
  uniqueValue: 'Reusable organization for hectic weekdays',
  keyMessages: 'Simple routines; transparent product facts'
};
const context = buildProductionContext({
  productionRun: { objective: 'launch_product', strategySnapshot, brandContext },
  job: { deliverable_id: 'customer_profile', title: 'Customer Profile', strategic_direction: 'Define the customer.', strategySnapshot },
  dependencyOutputs: []
});
assert.deepStrictEqual(context.brandContext, brandContext);
assert.match(handler.buildPrompt(context), /Brand name: LunchLoop \[id: brand\.businessName; source: Brand context\]/);
assert.match(handler.buildPrompt(context), /Brand voice: Warm and practical \[id: brand\.voice; source: Brand context\]/);

(async function run() {
  const output = handler.generateOutput(context);
  const provider = {
    provider: 'openai', model: 'test-model',
    async generateStructuredDeliverable() { return output; }
  };
  const generation = await generateDeliverable({
    job: { deliverable_id: 'customer_profile', title: 'Customer Profile', strategic_direction: 'Define the customer.', strategySnapshot, contract_version: handler.version },
    productionRun: { objective: 'launch_product', strategySnapshot, brandContext },
    dependencyOutputs: [], handler, generatorApi: provider,
    providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });
  assert.strictEqual(generation.provider, 'openai');
  assert.strictEqual(generation.aiModel, 'test-model');
  assert(!JSON.stringify(generation.structuredOutput).includes('Confirmed brand name'));
  console.log('Story 3.201 Production AI Provenance & Brand tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
