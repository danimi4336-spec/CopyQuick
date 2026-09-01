const assert = require('assert');

const { generateDeliverable } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

function profile(overrides = {}) {
  return {
    summary: 'Adults are the current audience for a working product direction that still requires validation.',
    primaryCustomer: 'Adults',
    needs: ['Clear information about the intended product direction'],
    motivations: ['A relevant and understandable option'],
    objections: ['Missing evidence or unclear product details'],
    buyingTriggers: ['Credible, confirmed product information'],
    languageStyle: 'Clear, practical, and appropriately cautious',
    ...overrides
  };
}

const contract = getProductionContract('customer_profile');
assert.strictEqual(validateCustomerReadyOutput(profile(), contract).valid, true);

const vacuous = {
  summary: 'A', primaryCustomer: 'B', needs: ['C'], motivations: ['D'],
  objections: ['E'], buyingTriggers: ['F'], languageStyle: 'G'
};
assert.strictEqual(validateCustomerReadyOutput(vacuous, contract).code, 'PRODUCTION_QUALITY_INSUFFICIENT_SUBSTANCE');

const repeated = profile({
  needs: ['Review this direction carefully.'],
  motivations: ['Review this direction carefully.'],
  objections: ['Review this direction carefully.']
});
assert.strictEqual(validateCustomerReadyOutput(repeated, contract).code, 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT');

assert.strictEqual(
  validateCustomerReadyOutput(profile({ summary: 'Here is the requested Customer Profile deliverable.' }), contract).code,
  'PRODUCTION_QUALITY_META_OUTPUT'
);

async function run() {
  const job = {
    deliverable_id: 'customer_profile',
    title: 'Customer Profile',
    strategic_direction: 'Define the current audience without inventing facts.',
    strategySnapshot: { primaryCustomer: { value: 'Adults', semanticRole: 'inferred_fact' } }
  };
  const productionRun = { objective: 'launch_product', strategySnapshot: job.strategySnapshot };
  const generatorApi = {
    generateCopy: () => [{ text: 'Schema-shaped but repetitive', tone: 'professional', structuredOutput: repeated }]
  };
  const providerRuntime = { run: ({ invoke }) => invoke({ signal: new AbortController().signal }) };

  await assert.rejects(
    generateDeliverable({ job, productionRun, handler: contract, generatorApi, providerRuntime }),
    error => error.code === 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT'
  );

  console.log('Story 3.83 Production Output Substance tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
