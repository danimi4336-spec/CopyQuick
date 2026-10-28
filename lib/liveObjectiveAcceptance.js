const { evaluateProductionContract } = require('./aiProductionEvaluation');
const { createObjectiveRuntime } = require('./objectiveRuntime');
const { objectiveUniverse } = require('./objectiveFramework');
const { objectiveAcceptanceFixtures } = require('./objectiveAcceptanceFixtures');
const { isReadyToUseAsset } = require('./productionArtifactPolicy');

const SUPPORTED_MODEL = 'gpt-5.4-mini';
const DEFAULT_MAX_CALLS = 7;
const DEFAULT_MAX_COST_USD = 0.35;
const DEFAULT_MAX_OUTPUT_TOKENS = 5000;
const PRICE_PER_MILLION = Object.freeze({ input: 0.75, cachedInput: 0.075, output: 4.50 });

function acceptanceError(code) {
  const error = new Error('Live objective acceptance is unavailable.');
  error.code = code;
  error.permanent = true;
  return error;
}

function boundedNumber(value, fallback, { minimum, maximum, integer = false }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || integer && !Number.isInteger(parsed)) return fallback;
  return parsed;
}

function liveAcceptanceConfig(env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_PRODUCTION_FORBIDDEN');
  if (String(env.AI_OBJECTIVE_EVALUATION_ENABLED || '').toLowerCase() !== 'true') throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_DISABLED');
  if (String(env.AI_PROVIDER || '').toLowerCase() !== 'openai') throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_PROVIDER_UNSUPPORTED');
  const model = String(env.OPENAI_MODEL || '').trim();
  if (model !== SUPPORTED_MODEL && !model.startsWith(`${SUPPORTED_MODEL}-`)) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_MODEL_UNPRICED');
  if (!String(env.OPENAI_API_KEY || '').trim()) throw acceptanceError('OPENAI_API_KEY_REQUIRED');
  return Object.freeze({
    model,
    maxCalls: boundedNumber(env.AI_OBJECTIVE_EVALUATION_MAX_CALLS, DEFAULT_MAX_CALLS, { minimum: 1, maximum: DEFAULT_MAX_CALLS, integer: true }),
    maxCostUsd: boundedNumber(env.AI_OBJECTIVE_EVALUATION_MAX_COST_USD, DEFAULT_MAX_COST_USD, { minimum: 0.01, maximum: DEFAULT_MAX_COST_USD }),
    maxOutputTokens: boundedNumber(env.AI_OBJECTIVE_EVALUATION_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, { minimum: 500, maximum: DEFAULT_MAX_OUTPUT_TOKENS, integer: true })
  });
}

function tokenUsage(payload = {}) {
  const usage = payload.usage || {};
  const inputTokens = Math.max(0, Number(usage.input_tokens) || 0);
  const outputTokens = Math.max(0, Number(usage.output_tokens) || 0);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(usage.input_tokens_details?.cached_tokens) || 0));
  return { inputTokens, cachedInputTokens, outputTokens };
}

function estimatedCostUsd({ inputTokens = 0, cachedInputTokens = 0, outputTokens = 0 } = {}) {
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return (uncachedInputTokens * PRICE_PER_MILLION.input
    + cachedInputTokens * PRICE_PER_MILLION.cachedInput
    + outputTokens * PRICE_PER_MILLION.output) / 1_000_000;
}

function conservativeReservationUsd(body, maxOutputTokens) {
  const maximumInputTokens = Buffer.byteLength(String(body || ''), 'utf8');
  return estimatedCostUsd({ inputTokens: maximumInputTokens, outputTokens: maxOutputTokens });
}

function createMeteredFetch({ fetchImpl = globalThis.fetch, config, ledger = [] } = {}) {
  if (typeof fetchImpl !== 'function') throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_FETCH_UNAVAILABLE');
  let spentUsd = 0;
  let calls = 0;
  return Object.freeze({
    async fetch(url, options = {}) {
      if (calls >= config.maxCalls) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_CALL_LIMIT');
      let request;
      try { request = JSON.parse(String(options.body || '')); }
      catch (_) { throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_REQUEST_INVALID'); }
      request.max_output_tokens = config.maxOutputTokens;
      const body = JSON.stringify(request);
      const reservedUsd = conservativeReservationUsd(body, config.maxOutputTokens);
      if (spentUsd + reservedUsd > config.maxCostUsd) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_BUDGET_RESERVED');
      calls += 1;
      const response = await fetchImpl(url, { ...options, body });
      let payload;
      try { payload = await response.clone().json(); } catch (_) {}
      if (response?.ok && (!payload?.usage || !Number.isFinite(Number(payload.usage.input_tokens)) || !Number.isFinite(Number(payload.usage.output_tokens)))) {
        throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_USAGE_MISSING');
      }
      const usage = tokenUsage(payload);
      const costUsd = estimatedCostUsd(usage);
      spentUsd += costUsd;
      ledger.push(Object.freeze({ call: calls, ...usage, costUsd }));
      if (spentUsd > config.maxCostUsd) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_BUDGET_EXCEEDED');
      return response;
    },
    snapshot() {
      return Object.freeze({ calls, spentUsd, remainingUsd: Math.max(0, config.maxCostUsd - spentUsd) });
    }
  });
}

function objectiveCases() {
  const fixtures = objectiveAcceptanceFixtures();
  return objectiveUniverse.filter(item => item.available).map(function(definition) {
    const fixture = fixtures[definition.id];
    if (!fixture) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_FIXTURE_MISSING');
    const runtime = createObjectiveRuntime(definition.id);
    const discovery = runtime.discovery.analyze({ ...fixture, unknowns: [] });
    if (!discovery.planningReadiness.ready) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_FIXTURE_INCOMPLETE');
    const strategy = runtime.strategy.build({ understanding: fixture.understanding, confirmedUnderstanding: fixture.understanding, answers: fixture.answers });
    const plan = runtime.buildPlan({ confirmedUnderstanding: fixture.understanding, strategyResult: strategy, answers: fixture.answers });
    const deliverables = plan.phases.flatMap(phase => phase.deliverables || []);
    const representative = deliverables.find(item => isReadyToUseAsset(item.id)) || deliverables[0];
    if (!representative) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_DELIVERABLE_MISSING');
    return Object.freeze({
      objective: definition.id,
      objectiveLabel: definition.title || definition.label || definition.id,
      deliverableId: representative.id,
      context: Object.freeze({
        objective: definition.id,
        offerDescription: fixture.answers.initial_description,
        strategySnapshot: strategy.strategy
      })
    });
  });
}

async function runLiveObjectiveAcceptance({
  env = process.env,
  generatorApi,
  providerRuntime,
  meteredFetch,
  evaluate = evaluateProductionContract,
  objectiveIds,
  includeRuleDiagnostics = false
} = {}) {
  const config = liveAcceptanceConfig(env);
  const requested = Array.isArray(objectiveIds) && objectiveIds.length ? new Set(objectiveIds) : null;
  const cases = objectiveCases().filter(item => !requested || requested.has(item.objective));
  if (requested && (cases.length !== requested.size || cases.length === 0)) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_OBJECTIVE_UNSUPPORTED');
  if (cases.length > config.maxCalls) throw acceptanceError('LIVE_OBJECTIVE_ACCEPTANCE_CALL_LIMIT');
  const results = [];
  const evaluationEnv = {
    NODE_ENV: env.NODE_ENV,
    AI_EVALUATION_ENABLED: 'true'
  };
  for (const item of cases) {
    const before = meteredFetch?.snapshot?.() || { calls: results.length, spentUsd: 0 };
    const result = await evaluate({
      deliverableId: item.deliverableId,
      generatorApi,
      providerRuntime,
      env: evaluationEnv,
      context: item.context,
      includeRuleDiagnostics
    });
    const after = meteredFetch?.snapshot?.() || before;
    results.push(Object.freeze({
      objective: item.objective,
      deliverableId: item.deliverableId,
      ok: result.ok,
      validation: result.validation,
      quality: result.quality,
      sectionCount: result.sectionCount || 0,
      wordCount: result.wordCount || 0,
      durationMs: result.durationMs,
      providerCalls: after.calls - before.calls,
      estimatedCostUsd: Math.max(0, after.spentUsd - before.spentUsd),
      ...(result.failure ? { failure: result.failure } : {})
    }));
    if (!result.ok) break;
  }
  const totals = meteredFetch?.snapshot?.() || { calls: results.length, spentUsd: 0, remainingUsd: config.maxCostUsd };
  return Object.freeze({
    ok: results.length === cases.length && results.every(result => result.ok),
    mode: 'isolated_live_objective_acceptance',
    provider: 'openai',
    model: config.model,
    objectives: results,
    totals,
    mutations: 0,
    allowanceConsumed: 0,
    researchCalls: 0
  });
}

module.exports = {
  DEFAULT_MAX_CALLS,
  DEFAULT_MAX_COST_USD,
  DEFAULT_MAX_OUTPUT_TOKENS,
  PRICE_PER_MILLION,
  SUPPORTED_MODEL,
  conservativeReservationUsd,
  createMeteredFetch,
  estimatedCostUsd,
  liveAcceptanceConfig,
  objectiveCases,
  runLiveObjectiveAcceptance,
  tokenUsage
};
