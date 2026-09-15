const { completedDeliverablesForPlan } = require('./productionBatchPlanning');
const {
  isPlanningFoundation,
  isReadyToUseAsset,
  productionBillingUnits
} = require('./productionArtifactPolicy');
const { validateSelection } = require('./buildPlanApproval');
const { validateWorkflowState } = require('./savedBuildPlans');
const { cleanPlanName, deriveProductionPlanName } = require('./productionPlanIdentity');

function validProgressSet(value, fingerprint) {
  if (!value || value.planFingerprint !== fingerprint || !Array.isArray(value.selectedDeliverables)
    || value.selectedDeliverables.length === 0) return null;
  const ids = value.selectedDeliverables.map(item => item?.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return null;
  return value;
}

function createProductionProgressSnapshot(approvedProductionSet, options = {}) {
  const value = validProgressSet(approvedProductionSet, approvedProductionSet?.planFingerprint);
  if (!value) return null;
  return {
    planFingerprint: value.planFingerprint,
    displayName: cleanPlanName(options.displayName),
    selectedDeliverables: value.selectedDeliverables.map(item => ({
      id: item.id,
      title: String(item.title || '').slice(0, 200),
      artifactRole: item.artifactRole || null,
      billingUnits: Number(item.billingUnits || 0),
      readyToUse: Boolean(item.readyToUse)
    }))
  };
}

function parseProgressSet(value, fingerprint) {
  if (!value) return null;
  try {
    return validProgressSet(typeof value === 'string' ? JSON.parse(value) : value, fingerprint);
  } catch (_) {
    return null;
  }
}

function legacySavedPlanSet(db, userId, production) {
  const row = db.prepare(`
    SELECT workflow_state
    FROM saved_build_plan_states
    WHERE user_id = ? AND objective = ? AND plan_fingerprint = ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(userId, production.objective, production.plan_fingerprint);
  if (!row) return null;
  let state;
  try { state = JSON.parse(row.workflow_state); } catch (_) { return null; }
  if (!validateWorkflowState(state, production.plan_fingerprint)) return null;
  const selection = validateSelection(state.buildPlan, state.buildPlanSelection);
  if (!selection.valid) return null;
  return validProgressSet({
    planFingerprint: production.plan_fingerprint,
    displayName: deriveProductionPlanName(state),
    selectedDeliverables: selection.ordered
  }, production.plan_fingerprint);
}

function resolveProductionProgressSet({ db, userId, production, approvedProductionSet }) {
  if (!db || !userId || !production) return null;
  const ownedRun = db.prepare(`
    SELECT production_plan_snapshot AS productionPlanSnapshot
    FROM production_runs
    WHERE id = ? AND user_id = ? AND plan_fingerprint = ?
  `).get(production.id, userId, production.plan_fingerprint);
  if (!ownedRun) return null;
  return parseProgressSet(approvedProductionSet, production.plan_fingerprint)
    || parseProgressSet(ownedRun.productionPlanSnapshot, production.plan_fingerprint)
    || legacySavedPlanSet(db, userId, production);
}

function buildProductionPlanProgress({ db, userId, production, approvedProductionSet }) {
  const progressSet = resolveProductionProgressSet({ db, userId, production, approvedProductionSet });
  if (!progressSet) return null;
  const ownedRun = db.prepare(`
    SELECT 1
    FROM production_runs
    WHERE id = ? AND user_id = ? AND plan_fingerprint = ?
  `).get(production.id, userId, production.plan_fingerprint);
  if (!ownedRun) return null;

  const selected = progressSet.selectedDeliverables;
  const completedIds = new Set(completedDeliverablesForPlan(
    db, userId, production.plan_fingerprint
  ).map(function(item) { return item.id; }));
  const runJobs = new Map((production.jobs || []).map(function(job) {
    return [job.deliverable_id, job];
  }));
  const reusedIds = new Set(db.prepare(`
    SELECT production_jobs.deliverable_id AS id
    FROM production_jobs
    JOIN generations ON generations.id = production_jobs.generation_id
    WHERE production_jobs.production_run_id = ?
      AND production_jobs.status = 'completed'
      AND generations.production_job_id != production_jobs.id
  `).all(production.id).map(function(row) { return row.id; }));

  const completed = selected.filter(function(item) { return completedIds.has(item.id); });
  const reused = selected.filter(function(item) { return reusedIds.has(item.id); });
  const batchNew = selected.filter(function(item) {
    return runJobs.has(item.id) && !reusedIds.has(item.id);
  });
  const batchIncomplete = batchNew.filter(function(item) {
    return runJobs.get(item.id)?.status !== 'completed';
  });
  const deferred = selected.filter(function(item) {
    return !runJobs.has(item.id) && !completedIds.has(item.id);
  });

  return {
    total: selected.length,
    completed,
    reused,
    batchNew,
    batchIncomplete,
    deferred,
    remainingEstimatedCost: deferred.reduce(function(total, item) {
      return total + Number(productionBillingUnits(item) || 0);
    }, 0),
    planningFoundationCount: selected.filter(isPlanningFoundation).length,
    readyToUseAssetCount: selected.filter(isReadyToUseAsset).length
  };
}

function serializeProductionPlanProgress(progress) {
  if (!progress) return null;
  return {
    totalCount: progress.total,
    completedCount: progress.completed.length,
    reusedCount: progress.reused.length,
    batchNewCount: progress.batchNew.length,
    batchIncompleteCount: progress.batchIncomplete.length,
    deferredCount: progress.deferred.length,
    remainingEstimatedCost: progress.remainingEstimatedCost,
    planningFoundationCount: progress.planningFoundationCount,
    readyToUseAssetCount: progress.readyToUseAssetCount
  };
}

module.exports = {
  buildProductionPlanProgress,
  createProductionProgressSnapshot,
  resolveProductionProgressSet,
  serializeProductionPlanProgress,
  validProgressSet
};
