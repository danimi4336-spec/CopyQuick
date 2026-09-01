function invalidProductionState(field) {
  const error = new Error('Persisted production state is invalid');
  error.code = 'PRODUCTION_STATE_INVALID';
  error.permanent = true;
  error.field = field;
  return error;
}

function parseJsonField(value, fallback, validator, field) {
  try {
    const parsed = JSON.parse(value || JSON.stringify(fallback));
    if (!validator(parsed)) throw invalidProductionState(field);
    return parsed;
  } catch (error) {
    if (error?.code === 'PRODUCTION_STATE_INVALID') throw error;
    throw invalidProductionState(field);
  }
}

function parseDependencies(value) {
  return parseJsonField(value, [], function(parsed) {
    return Array.isArray(parsed) && parsed.length <= 100 && new Set(parsed).size === parsed.length &&
      parsed.every(function(id) { return typeof id === 'string' && id.length > 0 && id.length <= 100; });
  }, 'dependencies');
}

function parseStrategySnapshot(value, field = 'strategy_snapshot') {
  return parseJsonField(value, {}, function(parsed) {
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  }, field);
}

function parseJob(job) {
  if (!job) return null;
  try {
    return {
      ...job,
      dependencies: parseDependencies(job.dependencies),
      strategySnapshot: parseStrategySnapshot(job.strategy_snapshot)
    };
  } catch (stateError) {
    return { ...job, dependencies: [], strategySnapshot: {}, stateError };
  }
}

module.exports = {
  invalidProductionState,
  parseDependencies,
  parseJob,
  parseStrategySnapshot
};
