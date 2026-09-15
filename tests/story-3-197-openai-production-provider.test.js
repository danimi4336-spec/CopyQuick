const assert = require('assert');
const {
  DEFAULT_OPENAI_MODEL,
  configuredProductionProvider,
  createOpenAIProductionProvider,
  productionProviderStatus,
  safetyIdentifier,
  storedProductionSource,
  toJsonSchema
} = require('../lib/openaiProductionProvider');

assert.strictEqual(configuredProductionProvider({}), undefined);
assert.strictEqual(configuredProductionProvider({ AI_PROVIDER: 'deterministic' }), undefined);
assert.throws(
  () => configuredProductionProvider({ AI_PROVIDER: 'openai' }),
  error => error.code === 'OPENAI_API_KEY_REQUIRED'
);
assert.throws(
  () => configuredProductionProvider({ AI_PROVIDER: 'unknown', OPENAI_API_KEY: 'unused' }),
  error => error.code === 'AI_PROVIDER_UNSUPPORTED'
);

assert.deepStrictEqual(toJsonSchema({ summary: 'string', actions: 'array' }), {
  type: 'object',
  properties: {
    summary: { type: 'string', minLength: 1 },
    actions: { type: 'array', items: { type: 'string' }, minItems: 1 }
  },
  required: ['summary', 'actions'],
  additionalProperties: false
});
assert.strictEqual(safetyIdentifier(null, 'secret'), null);
assert.match(safetyIdentifier(42, 'test-secret'), /^cq_[a-f0-9]{32}$/);
assert.strictEqual(safetyIdentifier(42, 'test-secret'), safetyIdentifier(42, 'test-secret'));
assert.deepStrictEqual(productionProviderStatus({}), {
  mode: 'deterministic', live: false, provider: 'deterministic', model: 'CopyQuick Deterministic',
  label: 'Deterministic structured engine',
  description: 'New deliverables will use CopyQuick templates and validation without calling an external AI model.'
});
assert.strictEqual(productionProviderStatus({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'key' }).live, true);
assert.strictEqual(productionProviderStatus({ AI_PROVIDER: 'openai' }).mode, 'misconfigured');
assert.strictEqual(storedProductionSource('CopyQuick Deterministic').live, false);
assert.deepStrictEqual(storedProductionSource('gpt-test'), {
  mode: 'ai', live: true, provider: 'openai', model: 'gpt-test', label: 'OpenAI production AI'
});

(async function run() {
  let request;
  const provider = createOpenAIProductionProvider({
    apiKey: 'test-key-not-a-secret',
    fetchImpl: async function(url, options) {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: 'completed', output_text: JSON.stringify({ summary: 'Useful summary', actions: ['Validate demand'] }) };
        }
      };
    }
  });
  const output = await provider.generateStructuredDeliverable({
    deliverableId: 'validation_plan',
    title: 'Validation Plan',
    prompt: 'Create the approved validation plan.',
    outputSchema: { summary: 'string', actions: 'array' },
    safetyIdentifier: 'cq_test_safety_identifier',
    signal: new AbortController().signal
  });
  assert.deepStrictEqual(output, { summary: 'Useful summary', actions: ['Validate demand'] });
  assert.strictEqual(provider.model, DEFAULT_OPENAI_MODEL);
  assert.strictEqual(request.url, 'https://api.openai.com/v1/responses');
  assert.strictEqual(request.options.headers.Authorization, 'Bearer test-key-not-a-secret');
  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.store, false);
  assert.strictEqual(body.safety_identifier, 'cq_test_safety_identifier');
  assert.strictEqual(body.text.format.type, 'json_schema');
  assert.strictEqual(body.text.format.strict, true);
  assert.deepStrictEqual(body.text.format.schema.required, ['summary', 'actions']);
  assert(!request.options.body.includes('test-key-not-a-secret'));

  const rejected = createOpenAIProductionProvider({
    apiKey: 'test-key',
    fetchImpl: async () => ({ ok: false, status: 429 })
  });
  await assert.rejects(
    rejected.generateStructuredDeliverable({ deliverableId: 'test', prompt: 'test', outputSchema: { result: 'string' } }),
    error => error.status === 429 && !error.message.includes('test-key')
  );

  const malformed = createOpenAIProductionProvider({
    apiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'completed', output_text: 'not json' }) })
  });
  await assert.rejects(
    malformed.generateStructuredDeliverable({ deliverableId: 'test', prompt: 'test', outputSchema: { result: 'string' } }),
    error => error.status === 502
  );

  console.log('Story 3.197 OpenAI Production Provider tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
