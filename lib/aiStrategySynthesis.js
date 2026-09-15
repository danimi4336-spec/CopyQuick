const { configuredProductionProvider } = require('./openaiProductionProvider');
const { defaultProviderRuntime } = require('./providerRuntime');
const { buildStrategy } = require('./strategyEngine');

const STRATEGY_SYNTHESIS_SCHEMA = Object.freeze({
  recommendations: 'array',
  recommendationReasons: 'array',
  additionalRisks: 'array',
  assumptions: 'array',
  rationale: 'array'
});

function enabled(env = process.env) {
  return String(env.AI_STRATEGY_ENABLED || '').toLowerCase() === 'true';
}

function safeItems(value, maximum = 6) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(function(item) {
    if (!item || item.length > 500) return false;
    return !/\b(?:guaranteed|proven|clinically proven|certified|search volume|monthly searches|market size)\b/i.test(item)
      && !/\b\d[\d,.]*%\b/.test(item);
  }).slice(0, maximum);
}

function strategyPrompt({ objective, understanding, answers, baseStrategy }) {
  const facts = Object.entries(understanding || {}).filter(([, item]) => item?.value && item.value !== 'unsure').map(([key, item]) => ({
    key, value: item.value, source: item.source === 'user_confirmed' ? 'confirmed' : 'inferred'
  }));
  const openSections = Object.entries(baseStrategy.strategy || {}).filter(([, item]) => item.semanticRole === 'unresolved').map(([key]) => key);
  return [
    'Augment this deterministic launch strategy with concise, evidence-disciplined guidance.',
    `Objective: ${objective}`,
    `Founder description: ${String(answers?.initial_description || '').slice(0, 2000)}`,
    `Known facts: ${JSON.stringify(facts).slice(0, 6000)}`,
    `Open strategy sections: ${openSections.join(', ') || 'none'}`,
    `Existing recommendations: ${JSON.stringify(baseStrategy.recommendations || []).slice(0, 4000)}`,
    'Do not change confirmed facts. Do not invent research, demand, prices, costs, performance, efficacy, specifications, suppliers, legal conclusions, proof, certifications, or measurements.',
    'Recommendations and risks must explicitly remain hypotheses, decisions, or validation work when evidence is missing.',
    'Keep recommendationReasons aligned by array index with recommendations.'
  ].join('\n');
}

function mergeSynthesis(baseStrategy, output, identity) {
  const recommendations = safeItems(output?.recommendations);
  const reasons = safeItems(output?.recommendationReasons);
  const additionalRisks = safeItems(output?.additionalRisks);
  const assumptions = safeItems(output?.assumptions);
  const rationale = safeItems(output?.rationale);
  const aiRecommendations = recommendations.map((recommendation, index) => ({
    recommendation,
    reason: reasons[index] || 'This is an AI-assisted hypothesis that requires validation before execution.',
    semanticRole: 'strategic_recommendation',
    source: 'ai_assisted'
  }));
  const existingRisks = Array.isArray(baseStrategy.strategy?.risks?.value)
    ? baseStrategy.strategy.risks.value : [];
  const strategy = additionalRisks.length ? {
    ...baseStrategy.strategy,
    risks: {
      ...baseStrategy.strategy.risks,
      value: [...new Set([...existingRisks, ...additionalRisks])],
      semanticRole: 'derived_risk'
    }
  } : baseStrategy.strategy;
  return {
    ...baseStrategy,
    strategy,
    assumptions: [...new Set([...(baseStrategy.assumptions || []), ...assumptions])],
    recommendations: [...(baseStrategy.recommendations || []), ...aiRecommendations],
    aiRationale: rationale,
    synthesis: { mode: 'ai_assisted', provider: identity.provider, model: identity.model }
  };
}

async function buildStrategyWithAI({ objective, understanding = {}, answers = {}, confirmedUnderstanding = {}, generatorApi, providerRuntime = defaultProviderRuntime, signal, env = process.env } = {}) {
  const baseStrategy = buildStrategy({ objective, understanding, answers, confirmedUnderstanding });
  if (!enabled(env)) return { ...baseStrategy, synthesis: { mode: 'deterministic', reason: 'AI_STRATEGY_DISABLED' } };
  let provider = generatorApi;
  try { provider = provider || configuredProductionProvider(env); }
  catch (error) {
    return { ...baseStrategy, synthesis: { mode: 'deterministic_fallback', reason: String(error?.code || 'AI_PROVIDER_CONFIGURATION_FAILED') } };
  }
  if (!provider?.generateStructuredDeliverable) {
    return { ...baseStrategy, synthesis: { mode: 'deterministic_fallback', reason: 'AI_PROVIDER_NOT_CONFIGURED' } };
  }
  const identity = { provider: provider.provider || 'configured', model: provider.model || null };
  try {
    const output = await providerRuntime.run({
      operation: 'strategy:synthesis',
      input: { objective, understanding, answers, baseStrategy },
      signal,
      invoke: ({ signal: providerSignal }) => provider.generateStructuredDeliverable({
        deliverableId: 'strategy_synthesis',
        title: 'Strategy Synthesis',
        prompt: strategyPrompt({ objective, understanding, answers, baseStrategy }),
        outputSchema: STRATEGY_SYNTHESIS_SCHEMA,
        signal: providerSignal
      })
    });
    return mergeSynthesis(baseStrategy, output, identity);
  } catch (error) {
    return {
      ...baseStrategy,
      synthesis: { ...identity, mode: 'deterministic_fallback', reason: String(error?.code || 'AI_STRATEGY_FAILED') }
    };
  }
}

module.exports = {
  STRATEGY_SYNTHESIS_SCHEMA,
  buildStrategyWithAI,
  enabled,
  mergeSynthesis,
  safeItems,
  strategyPrompt
};
