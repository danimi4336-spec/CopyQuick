const generator = require('./generator');
const { assertCustomerReadyOutput } = require('./productionQuality');
const { defaultProviderRuntime } = require('./providerRuntime');
const { DETERMINISTIC_MODEL, safetyIdentifier } = require('./openaiProductionProvider');
const { buildEvidenceLedger } = require('./productionEvidence');
const { reconcileClaimSupport } = require('./productionClaims');
const { ARTICLE_BLOCK_REPAIR_SCHEMA } = require('./productionContentBlocks');

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
  const brandContext = productionRun.brandContext || null;
  return {
    objective: productionRun.objective,
    deliverableId: job.deliverable_id,
    title: job.title,
    strategicDirection: job.strategic_direction,
    strategySnapshot,
    strategyText: strategySummary(strategySnapshot),
    brandContext,
    dependencyOutputs,
    evidenceLedger: buildEvidenceLedger({ strategySnapshot, brandContext, dependencyOutputs })
  };
}

function buildStructuredProviderInput({ context, handler, prompt, userId, secret }) {
  return Object.freeze({
    title: context.title,
    prompt,
    outputSchema: handler.providerOutputSchema || handler.outputSchema,
    safetyIdentifier: safetyIdentifier(userId, secret)
  });
}

function generationFailure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function revisionQualityGuidance(code) {
  const guidance = {
    CONTRACT_VALIDATION_SCHEMA: 'Return every required field in the requested schema with the correct string or array type and non-empty content.',
    CONTRACT_VALIDATION_CTA_FIDELITY: 'Include the confirmed call-to-action wording exactly and unchanged in every required CTA field.',
    CONTRACT_VALIDATION_ORGANIC_LENGTH: 'Rewrite the pillar article draft to contain 800–1,600 substantive words.',
    CONTRACT_VALIDATION_ORGANIC_HEADINGS: 'Structure the pillar article draft with at least four useful H2 or H3 Markdown headings and do not include an H1.',
    CONTRACT_VALIDATION_ORGANIC_OUTLINE: 'Return an internal content outline containing at least five distinct entries.',
    CONTRACT_VALIDATION_ORGANIC_DISTRIBUTION: 'Return at least two complete, standalone distribution posts.',
    CONTRACT_VALIDATION_FAILED: 'The replacement must satisfy every required field, type, item count, heading, length, and exact-CTA constraint in the contract.',
    PRODUCTION_QUALITY_UNCONFIRMED_PUBLICATION_STATUS: 'Remove every unconfirmed publication or recency claim. Do not call any article, guide, post, page, or content new, latest, newly published, newly released, published, launched, released, or updated. Describe the subject directly without implying that publication has happened.',
    PRODUCTION_QUALITY_INVENTED_AUDIENCE_BEHAVIOR: 'Remove generalized claims about what owners, businesses, customers, prospects, readers, or searchers often, usually, typically, generally, commonly, want, need, prefer, or do. Address the confirmed audience directly or use a conditional statement tied to confirmed facts.',
    PRODUCTION_QUALITY_REPETITIVE_OUTPUT: 'Remove repeated or substantially overlapping paragraphs and sections. Each section must make a distinct contribution and must not restate the audience, premise, benefit, or next step.',
    PRODUCTION_QUALITY_UNRESOLVED_PLACEHOLDER: 'Remove bracketed placeholders from public copy. Write standalone copy and leave destination links to the publishing platform.',
    PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS: 'Move all publishing, testing, validation, measurement, and editorial instructions out of public-copy fields and into the designated internal-guidance fields.',
    PRODUCTION_QUALITY_UNSUPPORTED_CLAIM: 'Remove unsupported proof, performance, efficacy, ranking, demand, comparison, guarantee, and quantified-result claims.',
    PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK: 'Remove references to prompts, contracts, schemas, dependencies, approved context, semantic roles, or generation instructions.',
    PRODUCTION_QUALITY_INSUFFICIENT_USEFULNESS: 'Rebuild the asset around decision-useful substance. Develop distinct sections, include concrete checks and actions, state scope boundaries, cover the major decision dimensions, and ground the public copy in confirmed facts from the evidence ledger.',
    PRODUCTION_QUALITY_CLAIM_PROVENANCE: 'Rebuild the public copy and claimSupport map together. Map every substantive public sentence verbatim to a confirmed-fact ledger ID shown in the evidence ledger, to conditional_guidance when the sentence is genuinely a question, imperative, or conditional, or to general_guidance when it is non-local, non-regulated explanatory guidance that makes no audience, business, offer, or outcome claim. Remove unsupported unconditional assertions rather than disguising them as guidance.'
  };
  return guidance[code] || 'Correct the rejected output so it satisfies all contract and customer-facing quality requirements.';
}

function contractValidationError(handler, output, context) {
  const failure = typeof handler?.validationFailures === 'function' ? handler.validationFailures(output, context)[0] : null;
  return generationFailure('Generator output did not satisfy the production contract', failure ? `CONTRACT_VALIDATION_${failure}` : 'CONTRACT_VALIDATION_FAILED');
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
  let deterministicFallbackUsed = false;
  if (typeof generatorApi.generateStructuredDeliverable === 'function') {
    const providerInput = buildStructuredProviderInput({
      context,
      handler,
      prompt: inputText,
      userId: productionRun.user_id,
      secret: process.env.AI_SAFETY_IDENTIFIER_SECRET
    });
    const maximumRevisions = boundedRevisionCount(process.env.AI_PROVIDER_MAX_REVISIONS);
    const publicFields = (handler.publicFieldKeys || []).join(', ') || 'none';
    const internalFields = (handler.internalFieldKeys || []).join(', ') || 'none';
    let revision = 0;
    let priorFailureCode = null;
    let repairPrompt = null;
    let priorProviderOutput = null;
    let repairBlockIds = [];
    while (true) {
      const generatedOutput = await providerRuntime.run({
        operation: `production:${handler.id}${revision ? ':revision' : ''}`,
        input: providerInput,
        signal,
        invoke: ({ signal: providerSignal }) => generatorApi.generateStructuredDeliverable({
          ...providerInput,
          ...(repairBlockIds.length ? { outputSchema: { articleBlocks: ARTICLE_BLOCK_REPAIR_SCHEMA } } : {}),
          prompt: revision
            ? repairBlockIds.length
              ? `${repairPrompt}\n\nRejection code: ${priorFailureCode || 'PRODUCTION_BLOCK_PROVENANCE_FAILED'}. Return only the requested replacement blocks.`
              : `${providerInput.prompt}\n\nRevise the prior attempt because it did not pass the required quality checks. Rejection code: ${priorFailureCode || 'QUALITY_CHECK_FAILED'}. ${revisionQualityGuidance(priorFailureCode)} Return a complete replacement that follows the requested structure, contains substantive non-repetitive content, reveals no internal context, and makes no unsupported claims. Public-copy fields (${publicFields}) must contain only finished audience-facing copy. Internal-guidance fields (${internalFields}) are the only place for strategy, intent, outlines, validation notes, testing advice, publishing instructions, and checklists.`
            : providerInput.prompt,
          signal: providerSignal
        })
      });
      const providerOutput = repairBlockIds.length && priorProviderOutput
        ? {
            ...priorProviderOutput,
            articleBlocks: [
              ...(priorProviderOutput.articleBlocks || []).filter(block => {
                const blockId = String(block?.id || '').trim() || 'unknown';
                return !repairBlockIds.includes(blockId);
              }),
              ...(generatedOutput.articleBlocks || [])
            ]
          }
        : generatedOutput;
      let structuredOutput;
      try {
        structuredOutput = typeof handler.normalizeProviderOutput === 'function'
          ? handler.normalizeProviderOutput(providerOutput, context)
          : providerOutput;
        let candidate = [{ text: handler.presentOutput(structuredOutput, [{ tone }])[0].text, tone, structuredOutput }];
        const normalized = reconcileClaimSupport(handler.normalizeOutput(candidate, context), handler, context);
        if (!handler.validateOutput(normalized, context)) throw contractValidationError(handler, normalized, context);
        assertCustomerReadyOutput(normalized, handler, context);
        candidate = [{ text: handler.presentOutput(normalized, [{ tone }])[0].text, tone, structuredOutput: normalized }];
        rawResults = candidate;
        break;
      } catch (error) {
        if (revision >= maximumRevisions) {
          if (handler.id === 'organic_content_campaign') {
            const fallback = reconcileClaimSupport(handler.generateOutput(context), handler, context);
            if (handler.validateOutput(fallback, context)) {
              assertCustomerReadyOutput(fallback, handler, context);
              rawResults = [{
                text: handler.presentOutput(fallback, [{ tone }])[0].text,
                tone,
                structuredOutput: fallback
              }];
              deterministicFallbackUsed = true;
              break;
            }
          }
          throw error;
        }
        priorFailureCode = error?.code || 'QUALITY_CHECK_FAILED';
        if (error?.details?.invalidBlocks) {
          repairBlockIds = error.details.invalidBlocks.map(block => block.id);
          priorProviderOutput = providerOutput;
          const invalidIds = repairBlockIds.join(', ') || 'missing blocks';
          repairPrompt = `${inputText}\n\nReturn only an articleBlocks array containing replacements for these invalid block IDs: ${invalidIds}. Each replacement must keep one of those exact IDs. Its supportType describes its primary support; every factual sentence must match a listed confirmed source ID, while questions, imperatives, conditional statements, and neutral general explanations may use their corresponding safe guidance category. Do not return or rewrite valid blocks or any other deliverable fields.`;
        } else {
          repairBlockIds = [];
          priorProviderOutput = null;
          repairPrompt = null;
        }
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
    throw contractValidationError(handler, structuredOutput, context);
  }
  try {
    assertCustomerReadyOutput(structuredOutput, handler, context);
  } catch (error) {
    error.deliverableId = handler.id;
    throw error;
  }
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
    provider: deterministicFallbackUsed ? 'hybrid' : (generatorApi?.provider || 'deterministic'),
    aiModel: deterministicFallbackUsed
      ? `${generatorApi?.model || 'provider'}+${DETERMINISTIC_MODEL}`
      : (generatorApi?.model || DETERMINISTIC_MODEL),
    generationType: 'production',
    goal: productionRun.objective
  };
}

module.exports = {
  boundedRevisionCount,
  buildProductionContext,
  buildStructuredProviderInput,
  revisionQualityGuidance,
  generateDeliverable
};
