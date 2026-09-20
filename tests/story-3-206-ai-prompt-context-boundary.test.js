const assert = require('assert');
const {
  buildProductionContext,
  buildStructuredProviderInput,
  generateDeliverable
} = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const {
  containsInternalContextLeak,
  validateCustomerReadyOutput,
  validateProductPositioningSemantics
} = require('../lib/productionQuality');

const handler = getProductionContract('product_positioning');
const strategySnapshot = {
  primaryCustomer: { value: 'Busy parents', semanticRole: 'confirmed_fact', sourceFields: ['targetAudience'] },
  customerMotivation: { value: 'Save time', semanticRole: 'confirmed_fact', sourceFields: ['customerMotivation'] },
  marketPosition: { value: 'Practical Daily Organization', semanticRole: 'strategic_recommendation' }
};
const dependencyOutputs = [{
  deliverableId: 'customer_profile',
  title: 'Customer Profile',
  contractVersion: 'customer_profile:v3',
  generationId: 9182,
  output: handler.generateOutput({
    objective: 'launch_product',
    title: 'Product Positioning',
    strategicDirection: 'Define a useful positioning hypothesis.',
    strategySnapshot,
    dependencyOutputs: []
  })
}];
const context = buildProductionContext({
  productionRun: {
    id: 701,
    user_id: 42,
    objective: 'launch_product',
    strategySnapshot,
    brandContext: { businessName: 'LunchLoop', voice: 'Warm and practical' }
  },
  job: {
    id: 811,
    deliverable_id: handler.id,
    title: 'Product Positioning',
    strategic_direction: 'Define a useful positioning hypothesis.',
    strategySnapshot
  },
  dependencyOutputs
});

const completePositioning = handler.generateOutput(context);
assert.strictEqual(validateProductPositioningSemantics(completePositioning), true);
assert.strictEqual(validateCustomerReadyOutput(completePositioning, handler).valid, true);
const openMarketPositioning = handler.generateOutput({
  ...context,
  strategySnapshot: {
    primaryCustomer: strategySnapshot.primaryCustomer,
    customerMotivation: strategySnapshot.customerMotivation
  }
});
assert.strictEqual(validateProductPositioningSemantics(openMarketPositioning), true);
assert.strictEqual(validateCustomerReadyOutput(openMarketPositioning, handler).valid, true);
[
  {
    name: 'generic statement',
    output: { ...completePositioning, positioningStatement: 'A premium natural wellness choice for everyone.' }
  },
  {
    name: 'unframed market label',
    output: { ...completePositioning, marketPosition: 'Premium Natural Wellness' }
  },
  {
    name: 'empty differentiation substance',
    output: { ...completePositioning, differentiation: 'A uniquely better choice for customers everywhere.' }
  },
  {
    name: 'missing evidence discipline',
    output: { ...completePositioning, proofPoints: ['Quality matters to customers.', 'People appreciate good service.', 'The brand has a compelling story.'] }
  },
  {
    name: 'non-actionable pillars',
    output: { ...completePositioning, positioningPillars: ['Quality', 'Trust', 'Value'] }
  },
  {
    name: 'non-actionable messaging',
    output: { ...completePositioning, messagingImplications: ['Great wellness for all.', 'Premium quality every day.', 'A better choice for everyone.'] }
  }
].forEach(function(scenario) {
  assert.strictEqual(validateProductPositioningSemantics(scenario.output), false, scenario.name);
  assert.deepStrictEqual(validateCustomerReadyOutput(scenario.output, handler), {
    valid: false,
    code: 'PRODUCTION_QUALITY_POSITIONING_SEMANTICS'
  }, scenario.name);
});
assert.match(handler.buildPrompt(context), /identify the audience and priority need/i);
assert.match(handler.buildPrompt(context), /Do not return generic branding language/i);

const profileContract = getProductionContract('customer_profile');
const profileContext = {
  objective: 'launch_product',
  title: 'Customer Profile',
  strategicDirection: 'Define the current customer responsibly.',
  strategySnapshot,
  dependencyOutputs: []
};
const safeProfile = profileContract.generateOutput(profileContext);
const paraphrasedLeaks = [
  'Based on the supplied context, the intended audience is busy parents.',
  'According to the upstream brief, customers want to save time.',
  'The prerequisite document identifies busy parents as the target.',
  'The dependency output says that convenience is the main motivation.',
  'The semantic role for this audience is confirmed_fact.',
  'The generation pipeline supplied these positioning details.',
  'I was instructed to describe busy parents as the priority customer.',
  'This deliverable follows the requested structure and schema.'
];
paraphrasedLeaks.forEach(function(leak) {
  assert.strictEqual(containsInternalContextLeak(leak), true, leak);
  assert.deepStrictEqual(validateCustomerReadyOutput({ ...safeProfile, summary: leak }, profileContract), {
    valid: false,
    code: 'PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK'
  }, leak);
});

const legitimatePlanningLanguage = [
  'Use customer interviews to validate whether busy parents prioritize simpler weekday routines.',
  'Evidence from representative customers should be documented before adopting this positioning direction.',
  'The customer profile is a working hypothesis until recurring needs are confirmed through research.'
];
legitimatePlanningLanguage.forEach(function(value) {
  assert.strictEqual(containsInternalContextLeak(value), false, value);
  assert.strictEqual(validateCustomerReadyOutput({ ...safeProfile, summary: value }, profileContract).valid, true, value);
});

const projected = buildStructuredProviderInput({
  context,
  handler,
  prompt: handler.buildPrompt(context),
  userId: 42,
  secret: 'test-only-secret'
});
assert.deepStrictEqual(Object.keys(projected), ['title', 'prompt', 'outputSchema', 'safetyIdentifier']);
assert.strictEqual(projected.title, 'Product Positioning');
assert.match(projected.safetyIdentifier, /^cq_[a-f0-9]{32}$/);
assert.strictEqual(projected.context, undefined);
assert.strictEqual(projected.deliverableId, undefined);
assert.strictEqual(projected.productionRun, undefined);
assert.strictEqual(projected.job, undefined);
assert.strictEqual(projected.dependencyOutputs, undefined);
assert.strictEqual(projected.strategySnapshot, undefined);
assert(!JSON.stringify(projected).includes('9182'));
assert(!JSON.stringify(projected).includes('811'));
assert(!JSON.stringify(projected).includes('701'));
assert(!JSON.stringify(projected).includes('targetAudience'));

(async function run() {
  const output = handler.generateOutput(context);
  const calls = [];
  const provider = {
    provider: 'mock',
    model: 'boundary-model',
    async generateStructuredDeliverable(input) {
      calls.push(input);
      if (calls.length === 1) return { positioningStatement: '' };
      return output;
    }
  };
  await generateDeliverable({
    job: {
      id: 811,
      deliverable_id: handler.id,
      title: 'Product Positioning',
      strategic_direction: 'Define a useful positioning hypothesis.',
      strategySnapshot,
      contract_version: handler.version
    },
    productionRun: {
      id: 701,
      user_id: 42,
      objective: 'launch_product',
      strategySnapshot,
      brandContext: { businessName: 'LunchLoop', voice: 'Warm and practical' }
    },
    dependencyOutputs,
    handler,
    generatorApi: provider,
    providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  });

  assert.strictEqual(calls.length, 2);
  calls.forEach(function(input) {
    assert.deepStrictEqual(
      Object.keys(input).sort(),
      ['outputSchema', 'prompt', 'safetyIdentifier', 'signal', 'title'].sort()
    );
    assert.strictEqual(input.context, undefined);
    assert.strictEqual(input.deliverableId, undefined);
    assert.strictEqual(input.productionRun, undefined);
    assert.strictEqual(input.job, undefined);
    assert.strictEqual(input.dependencyOutputs, undefined);
    assert.strictEqual(input.strategySnapshot, undefined);
  });
  assert.doesNotMatch(calls[1].prompt, /product_positioning/);
  assert.match(calls[1].prompt, /CONTRACT_VALIDATION_FAILED/);
  assert.match(calls[1].prompt, /did not pass the required quality checks/);

  let leakingAttempts = 0;
  const leakingProvider = {
    provider: 'mock',
    model: 'leaking-model',
    async generateStructuredDeliverable() {
      leakingAttempts += 1;
      return { ...safeProfile, summary: 'According to the upstream deliverable, busy parents are the approved audience.' };
    }
  };
  await assert.rejects(generateDeliverable({
    job: {
      id: 812,
      deliverable_id: profileContract.id,
      title: 'Customer Profile',
      strategic_direction: 'Define the current customer responsibly.',
      strategySnapshot,
      contract_version: profileContract.version
    },
    productionRun: { id: 702, user_id: 42, objective: 'launch_product', strategySnapshot },
    dependencyOutputs: [],
    handler: profileContract,
    generatorApi: leakingProvider,
    providerRuntime: { run: ({ invoke, signal }) => invoke({ signal }) }
  }), function(error) {
    return error.code === 'PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK';
  });
  assert.strictEqual(leakingAttempts, 2, 'leaking output must receive only the bounded revision attempt');
  console.log('Story 3.206 AI Prompt Context Boundary tests passed');
})().catch(function(error) {
  console.error(error);
  process.exitCode = 1;
});
