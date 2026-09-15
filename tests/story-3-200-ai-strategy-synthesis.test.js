const assert = require('assert');
const { buildStrategyWithAI, safeItems } = require('../lib/aiStrategySynthesis');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

const understanding = {
  businessType: confirmed('physical_product', 'Physical Product'),
  targetAudience: confirmed('Busy parents'),
  customerMotivation: confirmed('convenience', 'Save time and reduce effort'),
  salesChannel: confirmed('own_website', 'Shopify / my own website'),
  launchStage: confirmed('idea', 'Idea or early concept')
};
const enabled = { AI_STRATEGY_ENABLED: 'true' };
const runtime = { run: ({ invoke, signal }) => invoke({ signal }) };

assert.deepStrictEqual(safeItems(['Validate demand', 'Guaranteed 98% growth', 'Clinically proven']), ['Validate demand']);

(async function run() {
  const provider = {
    provider: 'mock', model: 'mock-strategy',
    async generateStructuredDeliverable() {
      return {
        recommendations: ['Test insulation-duration priorities with prospective customers.'],
        recommendationReasons: ['This clarifies the specification before supplier outreach.'],
        additionalRisks: ['Material and insulation performance remain hypotheses requiring prototype evidence.'],
        assumptions: ['Assume Shopify remains the initial channel until the builder changes it.'],
        rationale: ['Sequence customer evidence before inventory commitment.']
      };
    }
  };
  const result = await buildStrategyWithAI({
    objective: 'launch_product', understanding, confirmedUnderstanding: understanding,
    answers: { initial_description: 'A reusable insulated lunch container for busy parents' },
    generatorApi: provider, providerRuntime: runtime, env: enabled
  });
  assert.strictEqual(result.synthesis.mode, 'ai_assisted');
  assert.strictEqual(result.strategy.primaryCustomer.value, 'Busy parents');
  assert.strictEqual(result.strategy.primaryCustomer.semanticRole, 'confirmed_fact');
  assert(result.recommendations.some(item => item.source === 'ai_assisted'));
  assert(result.strategy.risks.value.some(item => /prototype evidence/.test(item)));
  assert.deepStrictEqual(result.aiRationale, ['Sequence customer evidence before inventory commitment.']);

  const unsafeProvider = {
    ...provider,
    async generateStructuredDeliverable() {
      return {
        recommendations: ['Guaranteed 98% conversion'], recommendationReasons: ['Proven result'],
        additionalRisks: [], assumptions: [], rationale: []
      };
    }
  };
  const unsafe = await buildStrategyWithAI({
    objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers: {},
    generatorApi: unsafeProvider, providerRuntime: runtime, env: enabled
  });
  assert(!unsafe.recommendations.some(item => /98%/.test(item.recommendation)));

  const fallback = await buildStrategyWithAI({
    objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers: {},
    generatorApi: provider,
    providerRuntime: { async run() { const error = new Error('private response'); error.code = 'PROVIDER_RATE_LIMITED'; throw error; } },
    env: enabled
  });
  assert.strictEqual(fallback.synthesis.mode, 'deterministic_fallback');
  assert.strictEqual(fallback.synthesis.reason, 'PROVIDER_RATE_LIMITED');
  assert(!JSON.stringify(fallback).includes('private response'));

  console.log('Story 3.200 AI Strategy Synthesis tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
