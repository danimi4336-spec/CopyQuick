const assert = require('assert');

const { generateDeliverable } = require('../lib/generationService');
const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');

for (const id of getProductionContractIds()) {
  const contract = getProductionContract(id);
  const versionNumber = ({
    campaign_brief: 4, product_positioning: 4, value_proposition: 4,
    outreach_sequence: 5, lead_capture_page: 5, paid_ad_copy_set: 4,
    search_evidence_snapshot: 4, search_strategy: 4, priority_content_brief: 4,
    priority_search_article: 2, research_evidence_pack: 1
  })[id] || (id === 'organic_content_campaign' ? 16
    : ['outreach_sequence', 'lead_capture_page'].includes(id) ? 4 : 3);
  const currentVersion = `${id}:v${versionNumber}`;
  const compatibleVersions = id === 'priority_search_article' ? ['priority_search_article:v1'] : Array.from({ length: versionNumber - 1 }, function(_, index) { return `${id}:v${index + 2}`; });
  assert.strictEqual(contract.version, currentVersion, id);
  assert.deepStrictEqual(contract.compatibleVersions, compatibleVersions, id);
  assert.strictEqual(contract.acceptsVersion(currentVersion), true, id);
  if (versionNumber > 1) assert.strictEqual(contract.acceptsVersion(`${id}:v2`), true, id);
  if (versionNumber > 2) assert.strictEqual(contract.acceptsVersion(`${id}:v3`), true, id);
  if (versionNumber > 1) assert.strictEqual(contract.acceptsVersion(`${id}:v1`), id === 'priority_search_article', id);
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
