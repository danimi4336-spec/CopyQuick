const generator = require('./generator');
const { assertCustomerReadyOutput } = require('./productionQuality');
const { defaultProviderRuntime } = require('./providerRuntime');
const { DETERMINISTIC_MODEL, safetyIdentifier } = require('./openaiProductionProvider');

function boundedRevisionCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2 ? parsed : 1;
}

function strategySummary(strategySnapshot) {
  return Object.entries(strategySnapshot || {}).map(function([key, item]) {
    const value = item?.value;
    if (!value || value === 'Unknown') return null;
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, function(char) { return char.toUpperCase(); });
    const prefix = item.semanticRole === 'strategic_recommendation' ? 'Recommended '
      : item.semanticRole === 'confirmed_fact' ? 'Confirmed '
        : item.semanticRole === 'inferred_fact' ? 'Inferred ' : '';
    return `${prefix}${label}: ${Array.isArray(value) ? value.join('; ') : value}`;
  }).filter(Boolean).join('\n');
}

function buildProductionContext({ productionRun, job, dependencyOutputs = [] }) {
  const strategySnapshot = job.strategySnapshot || productionRun.strategySnapshot || {};
  return {
    objective: productionRun.objective,
    deliverableId: job.deliverable_id,
    title: job.title,
    strategicDirection: job.strategic_direction,
    strategySnapshot,
    strategyText: strategySummary(strategySnapshot),
    brandContext: productionRun.brandContext || null,
    dependencyOutputs
  };
}

function buildStructuredProviderInput({ context, handler, prompt, userId, secret }) {
  return Object.freeze({
    title: context.title,
    prompt,
    outputSchema: handler.outputSchema,
    safetyIdentifier: safetyIdentifier(userId, secret)
  });
}

function generationFailure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function generateDeliverable({
  job,
  productionRun,
  dependencyOutputs = [],
  handler,
  generatorApi = generator,
  providerRuntime = defaultProviderRuntime,
  signal
}) {
  if (!handler) {
    const error = generationFailure('Unsupported production deliverable', 'UNSUPPORTED_DELIVERABLE');
    error.permanent = true;
    throw error;
  }
  if (job.contract_version && !handler.acceptsVersion(job.contract_version)) {
    const error = generationFailure('Production contract version is not supported', 'CONTRACT_VERSION_UNSUPPORTED');
    error.permanent = true;
    throw error;
  }
  const context = buildProductionContext({ productionRun, job, dependencyOutputs });
  const missingContext = handler.requiredContext.filter(function(key) {
    const value = context[key];
    return value === null || value === undefined || value === '';
  });
  if (missingContext.length) {
    throw generationFailure('Required approved production context is unavailable', 'CONTRACT_CONTEXT_MISSING');
  }
  const providedDependencies = new Set(dependencyOutputs.map(function(item) { return item.deliverableId; }));
  if (handler.requiredDependencies.some(function(id) { return !providedDependencies.has(id); })) {
    throw generationFailure('Required structured dependency output is unavailable', 'DEPENDENCY_CONTRACT_MISSING');
  }
  const primaryCustomer = context.strategySnapshot.primaryCustomer?.value;
  const communicationStyle = context.strategySnapshot.communicationStyle?.value;
  const inputText = handler.buildPrompt(context);
  const tone = typeof communicationStyle === 'string' ? communicationStyle.slice(0, 160) : 'professional';
  let rawResults;
  if (typeof generatorApi.generateStructuredDeliverable === 'function') {
    const providerInput = buildStructuredProviderInput({
      context,
      handler,
      prompt: inputText,
      userId: productionRun.user_id,
      secret: process.env.AI_SAFETY_IDENTIFIER_SECRET
    });
    const maximumRevisions = boundedRevisionCount(process.env.AI_PROVIDER_MAX_REVISIONS);
    let revision = 0;
    let revisionFailureCode = null;
    while (true) {
      const structuredOutput = await providerRuntime.run({
        operation: `production:${handler.id}${revision ? ':revision' : ''}`,
        input: providerInput,
        signal,
        invoke: ({ signal: providerSignal }) => generatorApi.generateStructuredDeliverable({
          ...providerInput,
          prompt: revision
            ? `${providerInput.prompt}\n\nRevise the prior attempt because it did not pass the required quality checks. Return a complete replacement that follows the requested structure, contains substantive non-repetitive content, reveals no internal context, and makes no unsupported claims. Keep marketer, publisher, testing, and compliance instructions only in fields explicitly named as plans or checklists. All headlines, descriptions, ad bodies, landing-page sections, and FAQs must be finished audience-facing copy.`
            : providerInput.prompt,
          signal: providerSignal
        })
      });
      const candidate = [{ text: handler.presentOutput(structuredOutput, [{ tone }])[0].text, tone, structuredOutput }];
      try {
        const normalized = handler.normalizeOutput(candidate, context);
        if (!handler.validateOutput(normalized, context)) throw generationFailure('Generator output did not satisfy the production contract', 'CONTRACT_VALIDATION_FAILED');
        assertCustomerReadyOutput(normalized, handler, context);
        rawResults = candidate;
        break;
      } catch (error) {
        if (revision >= maximumRevisions) throw error;
        revisionFailureCode = error?.code || 'quality failure';
        revision += 1;
      }
    }
  } else if (generatorApi === generator) {
    // The ordinary generator expands marketing-copy templates and cannot honor a
    // production schema. Keep internal orchestration prompts out of that path.
    const structuredOutput = handler.generateOutput(context);
    rawResults = [{ text: handler.presentOutput(structuredOutput, [{ tone }])[0].text, tone, structuredOutput }];
  } else {
    // Compatibility boundary for test/provider adapters that predate structured
    // production generation. Their output still passes the contract below.
    const providerInput = {
      productDescription: inputText,
      targetAudience: primaryCustomer || '',
      contentType: handler.contentType,
      tone
    };
    rawResults = await providerRuntime.run({
      operation: `production:${handler.id}`,
      input: providerInput,
      signal,
      invoke: ({ signal: providerSignal }) => generatorApi.generateCopy({ ...providerInput, signal: providerSignal })
    });
  }
  if (!Array.isArray(rawResults) || !rawResults.length || rawResults.some(function(item) { return !item?.text; })) {
    throw generationFailure('Generator returned no usable production output', 'INVALID_GENERATION_OUTPUT');
  }
  const structuredOutput = handler.normalizeOutput(rawResults, context);
  if (!handler.validateOutput(structuredOutput, context)) {
    throw generationFailure('Generator output did not satisfy the production contract', 'CONTRACT_VALIDATION_FAILED');
  }
  assertCustomerReadyOutput(structuredOutput, handler, context);
  const results = handler.presentOutput(structuredOutput, rawResults);
  const wordCount = results.reduce(function(sum, item) {
    return sum + item.text.split(/\s+/).filter(Boolean).length;
  }, 0);
  return {
    title: job.title,
    inputText,
    contentType: handler.contentType,
    tone: results[0].tone || 'professional',
    results,
    structuredOutput,
    contractVersion: handler.version,
    wordCount,
    provider: generatorApi?.provider || 'deterministic',
    aiModel: generatorApi?.model || DETERMINISTIC_MODEL,
    generationType: 'production',
    goal: productionRun.objective
  };
}

module.exports = {
  boundedRevisionCount,
  buildProductionContext,
  buildStructuredProviderInput,
  generateDeliverable
};
