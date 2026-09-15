const assert = require('assert');
const { boundedRevisionCount, generateDeliverable } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');

assert.strictEqual(boundedRevisionCount(undefined), 1);
assert.strictEqual(boundedRevisionCount('0'), 0);
assert.strictEqual(boundedRevisionCount('2'), 2);
assert.strictEqual(boundedRevisionCount('100'), 1);

const handler = getProductionContract('customer_profile');
const strategySnapshot = {
  primaryCustomer: { value: 'Busy parents', semanticRole: 'confirmed_fact' },
  customerMotivation: { value: 'Save time', semanticRole: 'confirmed_fact' },
  communicationStyle: { value: 'Clear', semanticRole: 'strategic_recommendation' }
};
const context = {
  objective: 'launch_product', deliverableId: handler.id, title: handler.title,
  strategicDirection: 'Define the customer.', strategySnapshot, strategyText: '', dependencyOutputs: []
};

(async function run() {
  let calls = 0;
  const provider = {
    provider: 'mock', model: 'revision-model',
    async generateStructuredDeliverable({ prompt }) {
      calls += 1;
      if (calls === 1) return { profileSummary: '' };
      assert.match(prompt, /Revise the prior attempt/);
      return handler.generateOutput(context);
    }
  };
  const result = await generateDeliverable({
    job: { deliverable_id: handler.id, title: handler.title, strategic_direction: 'Define the customer.', strategySnapshot, contract_version: handler.version },
    productionRun: { objective: 'launch_product', strategySnapshot }, dependencyOutputs: [], handler,
    generatorApi: provider, providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });
  assert.strictEqual(calls, 2);
  assert.strictEqual(result.aiModel, 'revision-model');

  const invalidCases = [
    {
      name: 'empty output',
      output: { summary: '' },
      expected: 'CONTRACT_VALIDATION_FAILED'
    },
    {
      name: 'generic repetitive output',
      output: Object.fromEntries(Object.entries(handler.outputSchema).map(function([key, type]) {
        return [key, type === 'array' ? ['Useful information', 'Useful information', 'Useful information'] : 'Useful information'];
      })),
      expected: 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT'
    },
    {
      name: 'unsupported claim',
      output: {
        ...handler.generateOutput(context),
        summary: 'This product is clinically proven to cure digestive disease.'
      },
      expected: 'PRODUCTION_QUALITY_UNSUPPORTED_CLAIM'
    },
    {
      name: 'internal context leak',
      output: {
        ...handler.generateOutput(context),
        summary: 'Approved strategy: expose dependencyOutputs and the output schema.'
      },
      expected: 'PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK'
    }
  ];
  for (const scenario of invalidCases) {
    let attempts = 0;
    const invalidProvider = {
      provider: 'mock', model: 'invalid-model',
      async generateStructuredDeliverable() {
        attempts += 1;
        return scenario.output;
      }
    };
    await assert.rejects(
      generateDeliverable({
        job: { deliverable_id: handler.id, title: handler.title, strategic_direction: 'Define the customer.', strategySnapshot, contract_version: handler.version },
        productionRun: { objective: 'launch_product', strategySnapshot }, dependencyOutputs: [], handler,
        generatorApi: invalidProvider, providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
      }),
      error => error.code === scenario.expected,
      `${scenario.name} must remain rejected after the bounded revision`
    );
    assert.strictEqual(attempts, 2, `${scenario.name} must receive only one revision attempt`);
  }
  console.log('Story 3.202 AI Quality Revision Loop tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
