const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  configuredProductionProvider,
  productionExecutionMode,
  productionProviderIsIsolated,
  productionProviderStatus
} = require('../lib/openaiProductionProvider');
const { sanitizedOperationalEvent } = require('../lib/operationalLogger');

const liveLocalEnvironment = {
  COPYQUICK_EXECUTION_MODE: 'acceptance',
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'local-test-key-that-must-not-be-used',
  OPENAI_MODEL: 'gpt-test'
};

let fetchCalls = 0;
const isolatedProvider = configuredProductionProvider(liveLocalEnvironment, {
  fetchImpl: async function() {
    fetchCalls += 1;
    throw new Error('Acceptance isolation allowed an external request.');
  }
});

assert.strictEqual(productionExecutionMode({}), 'standard');
assert.strictEqual(productionExecutionMode({ COPYQUICK_EXECUTION_MODE: 'STANDARD' }), 'standard');
assert.strictEqual(productionExecutionMode(liveLocalEnvironment), 'acceptance');
assert.strictEqual(productionProviderIsIsolated(liveLocalEnvironment), true);
assert.strictEqual(isolatedProvider, undefined);
assert.strictEqual(fetchCalls, 0);
assert.deepStrictEqual(productionProviderStatus(liveLocalEnvironment), {
  mode: 'deterministic',
  live: false,
  provider: 'deterministic',
  model: 'CopyQuick Deterministic',
  executionMode: 'acceptance',
  isolated: true,
  label: 'Acceptance-isolated deterministic engine',
  description: 'Acceptance isolation is active. New deliverables use CopyQuick templates and cannot call an external AI provider.'
});
assert.deepStrictEqual(sanitizedOperationalEvent({
  event: 'production_generation_provider_configured',
  operation: 'deterministic',
  outcome: 'isolated',
  executionMode: 'acceptance',
  isolated: true,
  ignoredSecret: 'must-not-be-logged'
}), {
  event: 'production_generation_provider_configured',
  operation: 'deterministic',
  outcome: 'isolated',
  executionMode: 'acceptance',
  isolated: true
});

assert.throws(
  () => configuredProductionProvider({
    COPYQUICK_EXECUTION_MODE: 'preview',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'unused'
  }),
  error => error.code === 'COPYQUICK_EXECUTION_MODE_UNSUPPORTED'
);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /configuredProductionProvider\(process\.env\)/);
assert.match(serverSource, /productionProviderStatus\(process\.env\)/);
assert.match(serverSource, /executionMode/);
assert.match(serverSource, /isolated: Boolean\(providerStatus\.isolated\)/);
assert.match(serverSource, /providerStatus\.isolated \? 'isolated'/);

const runtimeDocumentation = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'AI_PROVIDER_RUNTIME.md'),
  'utf8'
);
assert.match(runtimeDocumentation, /COPYQUICK_EXECUTION_MODE=acceptance npm start/);
assert.match(runtimeDocumentation, /forces production generation through CopyQuick's deterministic/);

console.log('Story 3.214 Local AI Provider Isolation tests passed');
