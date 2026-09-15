const { evaluateProductionContract } = require('../lib/aiProductionEvaluation');
const { configuredProductionProvider } = require('../lib/openaiProductionProvider');

async function main() {
  const args = process.argv.slice(2);
  const includePreview = args.includes('--show-output');
  const deliverableId = args.find(arg => !arg.startsWith('--')) || undefined;
  const generatorApi = configuredProductionProvider(process.env);
  const result = await evaluateProductionContract({ deliverableId, generatorApi, includePreview });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch(function(error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    failure: { code: String(error?.code || 'AI_EVALUATION_FAILED') }
  }, null, 2)}\n`);
  process.exitCode = 1;
});
