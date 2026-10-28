const assert = require('assert');
const {
  DEFAULT_MAX_COST_USD,
  createMeteredFetch,
  estimatedCostUsd,
  liveAcceptanceConfig,
  objectiveCases,
  runLiveObjectiveAcceptance,
  tokenUsage
} = require('../lib/liveObjectiveAcceptance');

function allowedEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    AI_OBJECTIVE_EVALUATION_ENABLED: 'true',
    AI_PROVIDER: 'openai',
    OPENAI_MODEL: 'gpt-5.4-mini',
    OPENAI_API_KEY: 'test-key-never-sent',
    ...overrides
  };
}

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() { return payload; },
    clone() { return response(payload, { ok, status }); }
  };
}

(async function run() {
  assert.throws(() => liveAcceptanceConfig(allowedEnv({ NODE_ENV: 'production' })), error => error.code === 'LIVE_OBJECTIVE_ACCEPTANCE_PRODUCTION_FORBIDDEN');
  assert.throws(() => liveAcceptanceConfig(allowedEnv({ AI_OBJECTIVE_EVALUATION_ENABLED: 'false' })), error => error.code === 'LIVE_OBJECTIVE_ACCEPTANCE_DISABLED');
  assert.throws(() => liveAcceptanceConfig(allowedEnv({ AI_PROVIDER: 'deterministic' })), error => error.code === 'LIVE_OBJECTIVE_ACCEPTANCE_PROVIDER_UNSUPPORTED');
  assert.throws(() => liveAcceptanceConfig(allowedEnv({ OPENAI_MODEL: 'unknown-priced-model' })), error => error.code === 'LIVE_OBJECTIVE_ACCEPTANCE_MODEL_UNPRICED');
  assert.throws(() => liveAcceptanceConfig(allowedEnv({ OPENAI_API_KEY: '' })), error => error.code === 'OPENAI_API_KEY_REQUIRED');

  const config = liveAcceptanceConfig(allowedEnv({
    AI_OBJECTIVE_EVALUATION_MAX_CALLS: '99',
    AI_OBJECTIVE_EVALUATION_MAX_COST_USD: '99',
    AI_OBJECTIVE_EVALUATION_MAX_OUTPUT_TOKENS: '99999'
  }));
  assert.strictEqual(config.maxCalls, 7);
  assert.strictEqual(config.maxCostUsd, DEFAULT_MAX_COST_USD);
  assert.strictEqual(config.maxOutputTokens, 5000);

  assert.deepStrictEqual(tokenUsage({ usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 400 } } }), {
    inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200
  });
  assert.strictEqual(estimatedCostUsd({ inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200 }), 0.00138);

  const observedRequests = [];
  const ledger = [];
  const metered = createMeteredFetch({
    config: { maxCalls: 1, maxCostUsd: 0.35, maxOutputTokens: 1234 },
    ledger,
    fetchImpl: async (_url, options) => {
      observedRequests.push(JSON.parse(options.body));
      return response({ usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 400 } } });
    }
  });
  await metered.fetch('https://example.invalid', { body: JSON.stringify({ model: 'gpt-5.4-mini', input: 'sanitized' }) });
  assert.strictEqual(observedRequests[0].max_output_tokens, 1234);
  assert.strictEqual(ledger.length, 1);
  assert.deepStrictEqual(metered.snapshot(), { calls: 1, spentUsd: 0.00138, remainingUsd: 0.34862 });
  await assert.rejects(() => metered.fetch('https://example.invalid', { body: '{}' }), error => error.code === 'LIVE_OBJECTIVE_ACCEPTANCE_CALL_LIMIT');

  const missingUsage = createMeteredFetch({
    config: { maxCalls: 1, maxCostUsd: 0.35, maxOutputTokens: 1234 },
    fetchImpl: async () => response({ output_text: '{}' })
  });
  await assert.rejects(() => missingUsage.fetch('https://example.invalid', { body: '{}' }), error => error.code === 'LIVE_OBJECTIVE_ACCEPTANCE_USAGE_MISSING');

  const cases = objectiveCases();
  assert.deepStrictEqual(cases.map(item => item.objective), [
    'launch_product', 'get_more_customers', 'increase_conversion_rates', 'improve_search_rankings',
    'build_brand', 'promote_service', 'validate_idea'
  ]);
  assert.strictEqual(new Set(cases.map(item => item.objective)).size, 7);
  assert(cases.every(item => item.deliverableId && item.context.offerDescription && item.context.strategySnapshot));

  let calls = 0;
  const fakeMeter = {
    snapshot() { return { calls, spentUsd: calls * 0.01, remainingUsd: 0.35 - calls * 0.01 }; }
  };
  const result = await runLiveObjectiveAcceptance({
    env: allowedEnv(),
    meteredFetch: fakeMeter,
    includeRuleDiagnostics: true,
    evaluate: async options => {
      calls += 1;
      assert.strictEqual(options.env.AI_EVALUATION_ENABLED, 'true');
      assert.strictEqual(options.includeRuleDiagnostics, true);
      assert(!JSON.stringify(options).includes('test-key-never-sent'));
      return { ok: true, validation: 'passed', quality: 'passed', sectionCount: 2, wordCount: 100, durationMs: 5 };
    }
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.objectives.length, 7);
  assert.strictEqual(result.totals.calls, 7);
  assert.strictEqual(result.mutations, 0);
  assert.strictEqual(result.allowanceConsumed, 0);
  assert.strictEqual(result.researchCalls, 0);
  assert(!JSON.stringify(result).includes('test-key-never-sent'));

  let failedCalls = 0;
  const failed = await runLiveObjectiveAcceptance({
    env: allowedEnv(),
    meteredFetch: { snapshot: () => ({ calls: failedCalls, spentUsd: 0, remainingUsd: 0.35 }) },
    evaluate: async () => {
      failedCalls += 1;
      return { ok: false, validation: 'failed', quality: 'not_completed', durationMs: 5, failure: { code: 'SANITIZED_FAILURE' } };
    }
  });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.objectives.length, 1);
  assert.strictEqual(failedCalls, 1);

  let filteredCalls = 0;
  const filtered = await runLiveObjectiveAcceptance({
    env: allowedEnv({ AI_OBJECTIVE_EVALUATION_MAX_CALLS: '1' }),
    objectiveIds: ['validate_idea'],
    meteredFetch: { snapshot: () => ({ calls: filteredCalls, spentUsd: 0, remainingUsd: 0.35 }) },
    evaluate: async () => {
      filteredCalls += 1;
      return { ok: true, validation: 'passed', quality: 'passed', sectionCount: 1, wordCount: 50, durationMs: 5 };
    }
  });
  assert.strictEqual(filtered.ok, true);
  assert.deepStrictEqual(filtered.objectives.map(item => item.objective), ['validate_idea']);
  await assert.rejects(() => runLiveObjectiveAcceptance({
    env: allowedEnv(), objectiveIds: ['unsupported_objective'], evaluate: async () => ({ ok: true })
  }), error => error.code === 'LIVE_OBJECTIVE_ACCEPTANCE_OBJECTIVE_UNSUPPORTED');

  await assert.rejects(() => runLiveObjectiveAcceptance({
    env: allowedEnv({ AI_OBJECTIVE_EVALUATION_MAX_CALLS: '6' }),
    meteredFetch: fakeMeter,
    evaluate: async () => ({ ok: true })
  }), error => error.code === 'LIVE_OBJECTIVE_ACCEPTANCE_CALL_LIMIT');

  console.log('Story 3.263 live objective acceptance tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
