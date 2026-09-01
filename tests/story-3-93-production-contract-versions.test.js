const assert = require('assert');

const { generateDeliverable } = require('../lib/generationService');
const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');

for (const id of getProductionContractIds()) {
  const contract = getProductionContract(id);
  assert.strictEqual(contract.version, `${id}:v3`, id);
  assert.deepStrictEqual(contract.compatibleVersions, [`${id}:v2`, `${id}:v3`], id);
  assert.strictEqual(contract.acceptsVersion(`${id}:v2`), true, id);
  assert.strictEqual(contract.acceptsVersion(`${id}:v3`), true, id);
  assert.strictEqual(contract.acceptsVersion(`${id}:v1`), false, id);
  assert.strictEqual(contract.acceptsVersion(`other:v3`), false, id);
}

async function run() {
  const handler = getProductionContract('customer_profile');
  let providerCalls = 0;
  const common = {
    handler,
    productionRun: { objective: 'launch_product', strategySnapshot: {} },
    job: {
      deliverable_id: 'customer_profile', title: 'Customer Profile',
      strategic_direction: 'Create a grounded customer hypothesis.', strategySnapshot: {}
    },
    generatorApi: { generateCopy() { providerCalls += 1; return []; } }
  };
  await assert.rejects(generateDeliverable({
    ...common,
    job: { ...common.job, contract_version: 'customer_profile:v1' }
  }), error => error.code === 'CONTRACT_VERSION_UNSUPPORTED' && error.permanent === true);
  assert.strictEqual(providerCalls, 0, 'unsupported contracts must fail before provider spend');

  await assert.rejects(generateDeliverable({
    ...common,
    job: { ...common.job, contract_version: 'customer_profile:v2' }
  }), error => error.code === 'INVALID_GENERATION_OUTPUT');
  assert.strictEqual(providerCalls, 1, 'known v2 jobs remain forward compatible');

  console.log('Story 3.93 Production Contract Versions tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
