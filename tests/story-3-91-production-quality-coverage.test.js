const assert = require('assert');

const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const repeated = 'This polished-looking sentence repeats without adding any distinct customer value or deliverable substance.';

for (const id of getProductionContractIds()) {
  const contract = getProductionContract(id);
  const output = Object.fromEntries(Object.entries(contract.outputSchema).map(([key, type]) => [
    key,
    type === 'array' ? [repeated] : repeated
  ]));
  assert.strictEqual(contract.validateOutput(output), true, `${id} fixture must satisfy its structural contract`);
  assert.deepStrictEqual(validateCustomerReadyOutput(output, contract), {
    valid: false,
    code: 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT'
  }, `${id} must reject wholly repetitive customer content`);
}

console.log('Story 3.91 Production Quality Coverage tests passed');
