require('dotenv').config();
const { createOpenAIProductionProvider } = require('../lib/openaiProductionProvider');
const { createProviderRuntime } = require('../lib/providerRuntime');
const { createMeteredFetch, liveAcceptanceConfig, runLiveObjectiveAcceptance } = require('../lib/liveObjectiveAcceptance');

async function main() {
  if (!process.argv.includes('--confirm-live-provider')) {
    const error = new Error('Live provider confirmation is required.');
    error.code = 'LIVE_OBJECTIVE_ACCEPTANCE_CONFIRMATION_REQUIRED';
    throw error;
  }
  const objectiveIds = process.argv
    .filter(argument => argument.startsWith('--objective='))
    .map(argument => argument.slice('--objective='.length))
    .filter(Boolean);
  const includeRuleDiagnostics = process.argv.includes('--rule-diagnostics');
  process.env.AI_PROVIDER_MAX_REVISIONS = '0';
  process.env.OPENAI_RESEARCH_ENABLED = 'false';
  const config = liveAcceptanceConfig(process.env);
  const ledger = [];
  const meteredFetch = createMeteredFetch({ config, ledger });
  const generatorApi = createOpenAIProductionProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: config.model,
    fetchImpl: meteredFetch.fetch
  });
  const providerRuntime = createProviderRuntime({
    timeoutMs: 120000,
    maxConcurrency: 1,
    logger: () => {},
    controlReader: () => ({ mode: 'running' })
  });
  const result = await runLiveObjectiveAcceptance({
    env: process.env,
    generatorApi,
    providerRuntime,
    meteredFetch,
    objectiveIds,
    includeRuleDiagnostics
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch(function(error) {
  process.stderr.write(`${JSON.stringify({ ok: false, failure: { code: String(error?.code || 'LIVE_OBJECTIVE_ACCEPTANCE_FAILED') } }, null, 2)}\n`);
  process.exitCode = 1;
});
