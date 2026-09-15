const assert = require('assert');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { interpretDiscovery, normalizeInterpretation } = require('../lib/aiDiscoveryInterpreter');

const enabled = { AI_DISCOVERY_ENABLED: 'true' };
const passthroughRuntime = { run: ({ invoke, signal }) => invoke({ signal }) };

assert.deepStrictEqual(normalizeInterpretation({
  businessType: 'physical_product',
  industry: 'invented_industry',
  targetAudience: ' Busy parents ',
  uncertaintyNotes: ['Materials are unknown'],
  suggestedQuestions: ['What must it keep cold?']
}), {
  fields: { businessType: 'physical_product', targetAudience: 'Busy parents' },
  uncertaintyNotes: ['Materials are unknown'],
  suggestedQuestions: ['What must it keep cold?']
});

(async function run() {
  const provider = {
    provider: 'mock', model: 'mock-discovery',
    async generateStructuredDeliverable() {
      return {
        businessType: 'physical_product', industry: 'unknown', category: 'unknown',
        targetAudience: 'Busy parents', salesChannel: 'own_website',
        uncertaintyNotes: ['Insulation performance is unknown'],
        suggestedQuestions: ['What duration should food stay cold?']
      };
    }
  };
  const assisted = await understandBusiness({
    objective: 'launch_product',
    answer: 'A reusable insulated lunch container',
    generatorApi: provider,
    providerRuntime: passthroughRuntime,
    env: enabled
  });
  assert.strictEqual(assisted.interpretation.mode, 'ai_assisted');
  assert.strictEqual(assisted.understanding.businessType.value, 'physical_product');
  assert.strictEqual(assisted.understanding.businessType.source, 'ai_inference');
  assert.strictEqual(assisted.understanding.targetAudience.value, 'Busy parents');
  assert.strictEqual(assisted.understanding.salesChannel.value, 'own_website');
  assert.deepStrictEqual(assisted.interpretation.suggestedQuestions, ['What duration should food stay cold?']);

  const confirmed = await understandBusiness({
    objective: 'launch_product', answer: 'A lunch container', generatorApi: provider,
    providerRuntime: passthroughRuntime, env: enabled,
    existingUnderstanding: {
      targetAudience: { value: 'Teachers', label: 'Teachers', confidence: 1, source: 'user_confirmed' }
    }
  });
  assert.strictEqual(confirmed.understanding.targetAudience.value, 'Teachers');
  assert.strictEqual(confirmed.understanding.targetAudience.source, 'user_confirmed');

  const fallback = await understandBusiness({
    objective: 'launch_product', answer: 'A lunch container', generatorApi: provider,
    providerRuntime: { async run() { const error = new Error('private failure'); error.code = 'PROVIDER_TIMEOUT'; throw error; } },
    env: enabled
  });
  assert.strictEqual(fallback.interpretation.mode, 'deterministic_fallback');
  assert.strictEqual(fallback.interpretation.reason, 'PROVIDER_TIMEOUT');
  assert(!JSON.stringify(fallback).includes('private failure'));

  const disabled = await interpretDiscovery({ env: {}, answer: 'anything' });
  assert.deepStrictEqual(disabled, { mode: 'deterministic', reason: 'AI_DISCOVERY_DISABLED' });

  console.log('Story 3.199 AI Discovery Interpretation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
