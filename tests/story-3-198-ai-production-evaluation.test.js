const assert = require('assert');
const { ProviderRuntimeError } = require('../lib/providerRuntime');
const { getProductionContract } = require('../lib/productionContracts');
const {
  assertEvaluationAllowed,
  evaluateProductionContract,
  sanitizedFailure
} = require('../lib/aiProductionEvaluation');

assert.throws(
  () => assertEvaluationAllowed({ NODE_ENV: 'production', AI_EVALUATION_ENABLED: 'true' }),
  error => error.code === 'AI_EVALUATION_PRODUCTION_FORBIDDEN'
);
assert.throws(
  () => assertEvaluationAllowed({ NODE_ENV: 'test' }),
  error => error.code === 'AI_EVALUATION_DISABLED'
);
assert.deepStrictEqual(sanitizedFailure(new Error('secret provider detail')), {
  code: 'AI_EVALUATION_FAILED', safeToRetry: false, permanent: false, ambiguous: false
});

const enabled = { NODE_ENV: 'test', AI_EVALUATION_ENABLED: 'true' };
const passthroughRuntime = { run: ({ invoke, signal }) => invoke({ signal }) };

function providerFor(deliverableId, output) {
  return {
    provider: 'mock',
    model: 'mock-structured-model',
    generateStructuredDeliverable: async () => output || getProductionContract(deliverableId).generateOutput({
      objective: 'Launch a new product',
      strategySnapshot: {},
      dependencyOutputs: []
    })
  };
}

(async function run() {
  const success = await evaluateProductionContract({
    deliverableId: 'customer_profile',
    generatorApi: providerFor('customer_profile'),
    providerRuntime: passthroughRuntime,
    env: enabled
  });
  assert.strictEqual(success.ok, true);
  assert.strictEqual(success.provider, 'mock');
  assert.strictEqual(success.model, 'mock-structured-model');
  assert.strictEqual(success.validation, 'passed');
  assert.strictEqual(success.quality, 'passed');
  assert.strictEqual(success.allowanceConsumed, 0);
  assert.strictEqual(success.mutations, 0);
  assert(!JSON.stringify(success).match(/prompt|strategySnapshot|dependencyOutputs|Busy parents/i));

  const priorityContracts = [
    'customer_profile',
    'product_specification_brief',
    'validation_plan',
    'prototype_sample_validation_plan',
    'sourcing_manufacturer_brief',
    'unit_economics_pricing_model',
    'inventory_fulfillment_plan'
  ];
  for (const deliverableId of priorityContracts) {
    const result = await evaluateProductionContract({
      deliverableId,
      generatorApi: providerFor(deliverableId),
      providerRuntime: passthroughRuntime,
      env: enabled,
      includePreview: true
    });
    assert.strictEqual(result.ok, true, `${deliverableId} evaluation must pass`);
    assert(result.preview.length >= 6, `${deliverableId} must expose a useful local review preview`);
    assert(!JSON.stringify(result.preview).match(/strategySnapshot|dependencyOutputs|contract_version|output schema/i));
    assert.strictEqual(result.allowanceConsumed, 0);
    assert.strictEqual(result.mutations, 0);
  }

  const malformed = await evaluateProductionContract({
    deliverableId: 'customer_profile',
    generatorApi: providerFor('customer_profile', { summary: '' }),
    providerRuntime: passthroughRuntime,
    env: enabled
  });
  assert.strictEqual(malformed.ok, false);
  assert.strictEqual(malformed.failure.code, 'CONTRACT_VALIDATION_SCHEMA');
  assert.strictEqual(malformed.validation, 'failed');

  for (const scenario of [
    ['PROVIDER_REQUEST_REJECTED', { permanent: true }],
    ['PROVIDER_TIMEOUT', { ambiguous: true }],
    ['PROVIDER_RATE_LIMITED', { safeToRetry: true }],
    ['PROVIDER_CANCELLED', { ambiguous: true }],
    ['PROVIDER_NETWORK_FAILURE', { ambiguous: true }]
  ]) {
    const runtime = {
      async run() { throw new ProviderRuntimeError(scenario[0], scenario[1]); }
    };
    const result = await evaluateProductionContract({
      deliverableId: 'customer_profile',
      generatorApi: providerFor('customer_profile'),
      providerRuntime: runtime,
      env: enabled
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failure.code, scenario[0]);
    assert(!JSON.stringify(result).includes('secret provider detail'));
  }

  console.log('Story 3.198 AI Production Evaluation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
