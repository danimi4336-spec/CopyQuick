const { buildProductionContext } = require('./generationService');
const { loadDependencyOutputs } = require('./productionExecution');
const { parseJob, parseStrategySnapshot } = require('./productionState');

function loadProductionValidationContext(db, { userId, generation }, dependencies = {}) {
  if (!generation?.production_job_id) return null;
  const rawJob = db.prepare('SELECT * FROM production_jobs WHERE id = ? AND generation_id = ?')
    .get(generation.production_job_id, generation.id);
  if (!rawJob) return null;
  const job = parseJob(rawJob);
  if (job.stateError) return null;
  const rawRun = db.prepare('SELECT * FROM production_runs WHERE id = ? AND user_id = ?')
    .get(job.production_run_id, userId);
  if (!rawRun) return null;
  const brand = db.prepare(`
    SELECT business_name, brand_voice, brand_voice_custom, unique_value, key_messages
    FROM brand_brain WHERE user_id = ?
  `).get(userId);
  const brandContext = brand ? {
    businessName: String(brand.business_name || '').slice(0, 200),
    voice: String(brand.brand_voice === 'custom' ? brand.brand_voice_custom : brand.brand_voice || '').slice(0, 300),
    uniqueValue: String(brand.unique_value || '').slice(0, 1000),
    keyMessages: String(brand.key_messages || '').slice(0, 1000)
  } : null;
  const dependencyLoader = dependencies.loadDependencyOutputs || loadDependencyOutputs;
  return buildProductionContext({
    productionRun: {
      ...rawRun,
      strategySnapshot: parseStrategySnapshot(rawRun.strategy_snapshot, 'run_strategy_snapshot'),
      brandContext
    },
    job,
    dependencyOutputs: dependencyLoader(db, job)
  });
}

module.exports = { loadProductionValidationContext };
