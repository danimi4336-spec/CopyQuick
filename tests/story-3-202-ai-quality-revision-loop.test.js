const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boundedRevisionCount, generateDeliverable, productionRegenerationUsageUnits, revisionFailureDiagnostics, revisionQualityGuidance } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');

assert.strictEqual(boundedRevisionCount(undefined), 1);
assert.strictEqual(boundedRevisionCount('0'), 0);
assert.strictEqual(boundedRevisionCount('2'), 2);
assert.strictEqual(boundedRevisionCount('100'), 1);
assert.strictEqual(productionRegenerationUsageUnits({ fallbackUsed: false }), 1);
assert.strictEqual(productionRegenerationUsageUnits({ fallbackUsed: true }), 0);

const generationRouteSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
assert.match(generationRouteSource,
  /const \{ loadDependencyOutputs \} = require\('\.\.\/lib\/productionExecution'\);/,
  'the live production-regeneration route imports the dependency loader it invokes');
assert.match(revisionQualityGuidance('PRODUCTION_QUALITY_UNCONFIRMED_PUBLICATION_STATUS'), /do not call any article, guide, post, page, or content new/i);
assert.match(revisionQualityGuidance('CONTRACT_VALIDATION_ORGANIC_LENGTH'), /800–1,600 substantive words/);
assert.match(revisionQualityGuidance('PRODUCTION_QUALITY_INSUFFICIENT_USEFULNESS'), /at least five distinct verbs/i);
assert.match(revisionFailureDiagnostics({ details: {
  failures: ['cover the industry-specific reader decision dimensions'],
  metrics: { developedSectionCount: 6, coveredTopics: ['scope'] }
} }), /coveredTopics.*scope/);
assert.match(revisionFailureDiagnostics({ details: {
  unsupportedClaims: [{ rule: 'unsupported_claim_4', excerpt: 'This approach is guaranteed to deliver results.' }]
} }), /guaranteed to deliver results/);

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

  const organicHandler = getProductionContract('organic_content_campaign');
  const organicStrategySnapshot = {
    primaryCustomer: { value: 'Owners of Toronto businesses', semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Generate qualified leads', semanticRole: 'confirmed_fact' },
    confirmedOffer: { value: 'Monthly bookkeeping', semanticRole: 'confirmed_fact' },
    confirmedPrimaryCta: { value: 'Book a free consultation', semanticRole: 'confirmed_fact' }
  };
  const organicContext = {
    objective: 'improve_search_rankings', deliverableId: organicHandler.id, title: organicHandler.title,
    strategicDirection: 'Create grounded search content.', strategySnapshot: organicStrategySnapshot,
    strategyText: '', dependencyOutputs: []
  };
  const organicDependencies = organicHandler.requiredDependencies.map(function(deliverableId) {
    const dependencyHandler = getProductionContract(deliverableId);
    return {
      deliverableId,
      title: dependencyHandler.title,
      contractVersion: dependencyHandler.version,
      output: dependencyHandler.generateOutput({ ...organicContext, deliverableId, title: dependencyHandler.title })
    };
  });
  organicContext.dependencyOutputs = organicDependencies;
  let organicCalls = 0;
  const organicProvider = {
    provider: 'mock', model: 'revision-model',
    async generateStructuredDeliverable({ prompt }) {
      organicCalls += 1;
      const output = organicHandler.generateOutput(organicContext);
      if (organicCalls === 1) return { ...output, distributionPosts: ['Read our new article about bookkeeping.', ...output.distributionPosts] };
      assert.match(prompt, /PRODUCTION_QUALITY_UNCONFIRMED_PUBLICATION_STATUS/);
      assert.match(prompt, /Do not call any article, guide, post, page, or content new/i);
      return output;
    }
  };
  const organicResult = await generateDeliverable({
    job: { deliverable_id: organicHandler.id, title: organicHandler.title, strategic_direction: 'Create grounded search content.', strategySnapshot: organicStrategySnapshot, contract_version: organicHandler.version },
    productionRun: { objective: 'improve_search_rankings', strategySnapshot: organicStrategySnapshot }, dependencyOutputs: organicDependencies, handler: organicHandler,
    generatorApi: organicProvider, providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });
  assert.strictEqual(organicCalls, 2);
  assert.strictEqual(organicResult.contractVersion, 'organic_content_campaign:v16');

  let reconciliationCalls = 0;
  const reconciledResult = await generateDeliverable({
    job: { deliverable_id: organicHandler.id, title: organicHandler.title, strategic_direction: 'Create grounded search content.', strategySnapshot: organicStrategySnapshot, contract_version: organicHandler.version },
    productionRun: { objective: 'improve_search_rankings', strategySnapshot: organicStrategySnapshot }, dependencyOutputs: organicDependencies, handler: organicHandler,
    generatorApi: {
      provider: 'mock', model: 'reconciliation-model',
      async generateStructuredDeliverable() {
        reconciliationCalls += 1;
        return { ...organicHandler.generateOutput(organicContext), claimSupport: [] };
      }
    },
    providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });
  assert.strictEqual(reconciliationCalls, 1, 'omitted audit mappings are reconstructed without spending a revision');
  assert(reconciledResult.structuredOutput.claimSupport.length > 0);

  let blockRepairCalls = 0;
  const blockHandler = {
    id: 'block_repair_test', title: 'Block Repair Test', version: 'block_repair_test:v1', contentType: 'sales_message',
    requiredContext: ['objective', 'strategySnapshot', 'strategicDirection'], requiredDependencies: [],
    outputSchema: { summary: 'string' }, providerOutputSchema: { summary: 'string', articleBlocks: 'array' },
    publicFieldKeys: ['summary'], internalFieldKeys: [], acceptsVersion: version => version === 'block_repair_test:v1',
    buildPrompt: () => 'Create evidence-first blocks.',
    normalizeProviderOutput(output) {
      if (output.articleBlocks.some(block => block.id === 'bad' && block.copy === 'unsupported')) {
        const error = new Error('invalid block');
        error.code = 'PRODUCTION_BLOCK_PROVENANCE_FAILED';
        error.details = { invalidBlocks: [{ id: 'bad' }], validBlockIds: ['good'] };
        throw error;
      }
      return { summary: 'A complete customer-facing summary with enough useful detail to review.' };
    },
    normalizeOutput: results => results[0].structuredOutput,
    validateOutput: output => Boolean(output.summary), validationFailures: () => [],
    presentOutput: (output, raw) => [{ text: output.summary || 'pending', tone: raw?.[0]?.tone || 'professional' }]
  };
  const blockRepairResult = await generateDeliverable({
    job: { deliverable_id: blockHandler.id, title: blockHandler.title, strategic_direction: 'Create blocks.', strategySnapshot, contract_version: blockHandler.version },
    productionRun: { objective: 'launch_product', strategySnapshot }, dependencyOutputs: [], handler: blockHandler,
    generatorApi: {
      provider: 'mock', model: 'block-repair-model',
      async generateStructuredDeliverable({ prompt, outputSchema }) {
        blockRepairCalls += 1;
        if (blockRepairCalls === 1) {
          return { summary: 'kept', articleBlocks: [{ id: 'good', copy: 'supported' }, { id: 'bad', copy: 'unsupported' }] };
        }
        assert.deepStrictEqual(Object.keys(outputSchema), ['articleBlocks']);
        assert.match(prompt, /Return only an articleBlocks array/);
        return { articleBlocks: [{ id: 'bad', copy: 'supported replacement' }] };
      }
    },
    providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });
  assert.strictEqual(blockRepairCalls, 2);
  assert.strictEqual(blockRepairResult.structuredOutput.summary, 'A complete customer-facing summary with enough useful detail to review.');

  let lengthRevisionCalls = 0;
  await generateDeliverable({
    job: { deliverable_id: organicHandler.id, title: organicHandler.title, strategic_direction: 'Create grounded search content.', strategySnapshot: organicStrategySnapshot, contract_version: organicHandler.version },
    productionRun: { objective: 'improve_search_rankings', strategySnapshot: organicStrategySnapshot }, dependencyOutputs: organicDependencies, handler: organicHandler,
    generatorApi: {
      provider: 'mock', model: 'length-revision-model',
      async generateStructuredDeliverable({ prompt }) {
        lengthRevisionCalls += 1;
        const output = organicHandler.generateOutput(organicContext);
        if (lengthRevisionCalls === 1) return { ...output, introduction: '## Scope\nA short draft.\n## Checks\nReview records.\n## Options\nCompare fit.\n## Next step\nChoose carefully.' };
        assert.match(prompt, /CONTRACT_VALIDATION_ORGANIC_LENGTH/);
        assert.match(prompt, /800–1,600 substantive words/);
        return output;
      }
    },
    providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });
  assert.strictEqual(lengthRevisionCalls, 2);

  let fallbackCalls = 0;
  const fallbackResult = await generateDeliverable({
    job: { deliverable_id: organicHandler.id, title: organicHandler.title, strategic_direction: 'Create grounded search content.', strategySnapshot: organicStrategySnapshot, contract_version: organicHandler.version },
    productionRun: { objective: 'improve_search_rankings', strategySnapshot: organicStrategySnapshot }, dependencyOutputs: organicDependencies, handler: organicHandler,
    generatorApi: {
      provider: 'mock', model: 'persistently-short-model',
      async generateStructuredDeliverable() {
        fallbackCalls += 1;
        const output = organicHandler.generateOutput(organicContext);
        return { ...output, introduction: '## Scope\nA short draft.\n## Checks\nReview records.\n## Options\nCompare fit.\n## Next step\nChoose carefully.' };
      }
    },
    providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });
  assert.strictEqual(fallbackCalls, 2, 'the provider receives one bounded revision before fallback');
  assert.strictEqual(fallbackResult.provider, 'hybrid');
  assert.match(fallbackResult.aiModel, /persistently-short-model\+.*deterministic/i);
  assert.strictEqual(fallbackResult.fallbackUsed, true);
  assert.strictEqual(fallbackResult.fallbackReasonCode, 'CONTRACT_VALIDATION_ORGANIC_LENGTH');
  assert.strictEqual(organicHandler.validateOutput(fallbackResult.structuredOutput, organicContext), true);

  let providerFailureCalls = 0;
  const providerFailureResult = await generateDeliverable({
    job: { deliverable_id: organicHandler.id, title: organicHandler.title, strategic_direction: 'Create grounded search content.', strategySnapshot: organicStrategySnapshot, contract_version: organicHandler.version },
    productionRun: { objective: 'improve_search_rankings', strategySnapshot: organicStrategySnapshot }, dependencyOutputs: organicDependencies, handler: organicHandler,
    generatorApi: {
      provider: 'mock', model: 'unavailable-model',
      async generateStructuredDeliverable() {
        providerFailureCalls += 1;
        const error = new Error('provider timed out');
        error.code = 'AI_PROVIDER_TIMEOUT';
        throw error;
      }
    },
    providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });
  assert.strictEqual(providerFailureCalls, 1, 'provider failures fall back immediately instead of spending another long attempt');
  assert.strictEqual(providerFailureResult.provider, 'hybrid');
  assert.match(providerFailureResult.aiModel, /unavailable-model\+.*deterministic/i);
  assert.strictEqual(providerFailureResult.fallbackUsed, true);
  assert.strictEqual(providerFailureResult.fallbackReasonCode, 'AI_PROVIDER_TIMEOUT');
  assert.strictEqual(organicHandler.validateOutput(providerFailureResult.structuredOutput, organicContext), true);

  const invalidCases = [
    {
      name: 'empty output',
      output: { summary: '' },
      expected: 'CONTRACT_VALIDATION_SCHEMA'
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
