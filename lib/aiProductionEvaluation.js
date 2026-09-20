const { generateDeliverable } = require('./generationService');
const { getProductionContract } = require('./productionContracts');
const { minimumProductionDependencies } = require('./productionDependencyPolicy');

const DEFAULT_EVALUATION_DELIVERABLE = 'customer_profile';

function evaluationError(code) {
  const error = new Error('AI production evaluation is unavailable.');
  error.code = code;
  error.permanent = true;
  return error;
}

function assertEvaluationAllowed(env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
    throw evaluationError('AI_EVALUATION_PRODUCTION_FORBIDDEN');
  }
  if (String(env.AI_EVALUATION_ENABLED || '').toLowerCase() !== 'true') {
    throw evaluationError('AI_EVALUATION_DISABLED');
  }
}

function fixtureStrategySnapshot() {
  return {
    businessType: { value: 'Physical Product', semanticRole: 'confirmed_fact' },
    industry: { value: 'Consumer Products', semanticRole: 'inferred_fact' },
    category: { value: 'Reusable insulated lunch container', semanticRole: 'confirmed_fact' },
    primaryCustomer: { value: 'Busy parents', semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Save time and reduce effort', semanticRole: 'confirmed_fact' },
    primarySalesChannel: { value: 'Shopify / my own website', semanticRole: 'confirmed_fact' },
    launchStage: { value: 'Idea or early concept', semanticRole: 'confirmed_fact' },
    communicationStyle: { value: 'Clear and practical', semanticRole: 'strategic_recommendation' }
  };
}

function evaluationContext(overrides = {}) {
  return {
    objective: 'Launch a new product',
    offerDescription: 'I want to launch a reusable insulated lunch container for busy parents through Shopify',
    strategySnapshot: fixtureStrategySnapshot(),
    ...overrides
  };
}

function evaluationDirection(context, title) {
  return `Evaluate ${title} using sanitized fixture evidence only. Builder-provided offer description: ${context.offerDescription}. Treat this as unverified context, not proof of performance, demand, differentiation, claims, or substantiation.`;
}

function dependencyFixtures(deliverableId, context, cache = new Map()) {
  return minimumProductionDependencies(deliverableId).map(function(dependencyId) {
    if (cache.has(dependencyId)) return cache.get(dependencyId);
    const handler = getProductionContract(dependencyId);
    if (!handler) throw evaluationError('AI_EVALUATION_DEPENDENCY_UNSUPPORTED');
    const dependencies = dependencyFixtures(dependencyId, context, cache);
    const output = handler.generateOutput({
      ...context,
      deliverableId: dependencyId,
      title: handler.title,
      strategicDirection: evaluationDirection(context, handler.title),
      dependencyOutputs: dependencies
    });
    const fixture = {
      deliverableId: dependencyId,
      title: handler.title,
      output,
      contractVersion: handler.version
    };
    cache.set(dependencyId, fixture);
    return fixture;
  });
}

function providerIdentity(generatorApi) {
  return {
    provider: generatorApi?.provider || 'deterministic',
    model: generatorApi?.model || null
  };
}

function sanitizedFailure(error) {
  return {
    code: String(error?.code || 'AI_EVALUATION_FAILED'),
    safeToRetry: Boolean(error?.safeToRetry),
    permanent: Boolean(error?.permanent),
    ambiguous: Boolean(error?.ambiguous)
  };
}

async function evaluateProductionContract({
  deliverableId = DEFAULT_EVALUATION_DELIVERABLE,
  generatorApi,
  providerRuntime,
  signal,
  env = process.env,
  context: contextOverrides,
  includePreview = false
} = {}) {
  assertEvaluationAllowed(env);
  const handler = getProductionContract(deliverableId);
  if (!handler) throw evaluationError('AI_EVALUATION_CONTRACT_UNSUPPORTED');
  const context = evaluationContext(contextOverrides);
  const dependencyOutputs = dependencyFixtures(deliverableId, context);
  const identity = providerIdentity(generatorApi);
  const startedAt = Date.now();
  try {
    const generation = await generateDeliverable({
      job: {
        deliverable_id: deliverableId,
        title: handler.title,
        strategic_direction: evaluationDirection(context, handler.title),
        strategySnapshot: context.strategySnapshot,
        contract_version: handler.version
      },
      productionRun: {
        objective: context.objective,
        strategySnapshot: context.strategySnapshot
      },
      dependencyOutputs,
      handler,
      generatorApi,
      providerRuntime,
      signal
    });
    const result = {
      ok: true,
      mode: 'isolated_evaluation',
      deliverableId,
      contractVersion: generation.contractVersion,
      provider: identity.provider,
      model: identity.model,
      validation: 'passed',
      quality: 'passed',
      sectionCount: handler.presentationSections(generation.structuredOutput).length,
      wordCount: generation.wordCount,
      durationMs: Math.max(0, Date.now() - startedAt),
      mutations: 0,
      allowanceConsumed: 0
    };
    if (includePreview) {
      result.preview = handler.presentationSections(generation.structuredOutput).map(function(section) {
        return { label: section.label, value: section.value };
      });
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      mode: 'isolated_evaluation',
      deliverableId,
      contractVersion: handler.version,
      provider: identity.provider,
      model: identity.model,
      validation: /^CONTRACT_VALIDATION_/.test(String(error?.code || '')) ? 'failed' : 'not_completed',
      quality: 'not_completed',
      durationMs: Math.max(0, Date.now() - startedAt),
      mutations: 0,
      allowanceConsumed: 0,
      failure: sanitizedFailure(error)
    };
  }
}

module.exports = {
  DEFAULT_EVALUATION_DELIVERABLE,
  assertEvaluationAllowed,
  dependencyFixtures,
  evaluateProductionContract,
  evaluationDirection,
  evaluationContext,
  fixtureStrategySnapshot,
  sanitizedFailure
};
