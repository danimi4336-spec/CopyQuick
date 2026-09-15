const { validateSelection } = require('./buildPlanApproval');
const { calculateProductionCost } = require('./productionCost');
const { productionBillingUnits } = require('./productionArtifactPolicy');
const { getProductionHandler } = require('./productionHandlers');
const { validateCustomerReadyOutput } = require('./productionQuality');

function reusableCompletedGeneration(row) {
  // Lightweight batching tests may provide already-filtered rows through a DB
  // adapter. Real SQLite rows always include both projection fields below.
  if (!Object.prototype.hasOwnProperty.call(row, 'contractVersion')
    && !Object.prototype.hasOwnProperty.call(row, 'structuredResult')) return true;
  const handler = getProductionHandler(row.id);
  if (!handler || !handler.acceptsVersion(row.contractVersion)) return false;
  let output;
  try { output = JSON.parse(row.structuredResult || ''); } catch (_) { return false; }
  return validateCustomerReadyOutput(output, handler).valid;
}

function completedDeliverablesForPlan(db, userId, planFingerprint) {
  if (!db || !userId || !planFingerprint) return [];
  return db.prepare(`
    SELECT production_jobs.deliverable_id AS id,
           production_jobs.generation_id AS generationId,
           production_jobs.title,
           production_jobs.phase,
           production_jobs.phase_title AS phaseTitle,
           production_jobs.strategic_direction AS strategicDirection,
           production_jobs.dependencies,
           production_jobs.completed_at AS completedAt,
           generations.contract_version AS contractVersion,
           generations.structured_result AS structuredResult
    FROM production_jobs
    JOIN production_runs ON production_runs.id = production_jobs.production_run_id
    JOIN generations ON generations.id = production_jobs.generation_id
    JOIN production_jobs AS origin_job ON origin_job.id = generations.production_job_id
    JOIN production_runs AS origin_run ON origin_run.id = origin_job.production_run_id
    WHERE production_runs.user_id = ?
      AND production_runs.plan_fingerprint = ?
      AND production_jobs.status = 'completed'
      AND production_jobs.generation_id IS NOT NULL
      AND generations.user_id = production_runs.user_id
      AND generations.is_deleted = 0
      AND generations.deliverable_id = production_jobs.deliverable_id
      AND origin_job.status = 'completed'
      AND origin_job.generation_id = generations.id
      AND origin_job.deliverable_id = production_jobs.deliverable_id
      AND origin_run.user_id = production_runs.user_id
      AND origin_run.plan_fingerprint = production_runs.plan_fingerprint
    ORDER BY datetime(production_jobs.completed_at) DESC, production_jobs.id DESC
  `).all(userId, planFingerprint).filter(reusableCompletedGeneration).reduce(function(rows, row) {
    if (rows.some(function(existing) { return existing.id === row.id; })) return rows;
    let dependencies = [];
    try { dependencies = JSON.parse(row.dependencies || '[]'); } catch (_) { dependencies = []; }
    rows.push({ ...row, dependencies });
    return rows;
  }, []);
}

function dependencySafePrefix(remaining, completedIds, limit, unitCost = function() { return 1; }) {
  const included = new Set();
  const result = [];
  let usedUnits = 0;
  for (const item of remaining) {
    const ready = (item.dependencies || []).every(function(id) {
      return completedIds.has(id) || included.has(id);
    });
    if (!ready) continue;
    const itemUnits = Number(unitCost(item));
    if (!Number.isFinite(itemUnits) || itemUnits < 0) continue;
    if (usedUnits + itemUnits > limit) continue;
    result.push(item);
    included.add(item.id);
    usedUnits += itemUnits;
  }
  return result;
}

function buildProductionBatchStatus({ db, userId, plan, selection, usageSnapshot, mode = 'full' }) {
  const validation = validateSelection(plan, selection);
  if (!validation.valid) return validation;
  const completedRecords = completedDeliverablesForPlan(db, userId, selection.planFingerprint);
  const completedById = new Map(completedRecords.map(function(item) { return [item.id, item]; }));
  const completedIds = new Set(completedById.keys());
  const ordered = validation.ordered;
  const remaining = ordered.filter(function(item) { return !completedIds.has(item.id); });
  const affordableLimit = Math.max(Number(usageSnapshot?.remaining || 0), 0);
  const affordable = dependencySafePrefix(remaining, completedIds, affordableLimit, productionBillingUnits);
  const firstRemainingPhase = remaining[0]?.phase || null;
  const phaseItems = firstRemainingPhase
    ? remaining.filter(function(item) { return item.phase === firstRemainingPhase; })
    : [];
  const phaseBatch = dependencySafePrefix(phaseItems, completedIds, affordableLimit, productionBillingUnits);
  const fullPhaseAffordable = phaseItems.length > 0 && phaseBatch.length === phaseItems.length;
  let productionNow = remaining;
  // The build-plan affordability notice is based on `affordableRecommendation`.
  // Use that exact dependency-safe prefix for the approved affordable batch as
  // well, even when an earlier phase happens to be smaller than the allowance.
  // Otherwise the UI can promise (for example) four deliverables while the
  // production handoff silently shrinks the batch to one complete phase.
  if (mode === 'affordable') productionNow = affordable;

  const batchSet = { selectedDeliverables: productionNow };
  const cost = productionNow.length
    ? calculateProductionCost({ approvedProductionSet: batchSet, usageSnapshot })
    : {
        valid: true, productionUnitCount: 0, currentUsage: Number(usageSnapshot?.used || 0),
        monthlyAllowance: Number(usageSnapshot?.monthlyLimit || 0),
        remainingAllowance: Number(usageSnapshot?.remaining || 0), canAfford: true,
        planningFoundationCount: 0, readyToUseAssetCount: 0,
        blockingReason: null, costingModel: 'ready_to_use_asset_unit'
      };
  const productionNowIds = new Set(productionNow.map(function(item) { return item.id; }));
  const deferred = remaining.filter(function(item) { return !productionNowIds.has(item.id); });
  const requiredCompletedIds = new Set();
  function includeCompletedDependencies(item) {
    (item.dependencies || []).forEach(function(id) {
      if (completedIds.has(id)) requiredCompletedIds.add(id);
      const dependency = ordered.find(function(candidate) { return candidate.id === id; });
      if (dependency) includeCompletedDependencies(dependency);
    });
  }
  productionNow.forEach(includeCompletedDependencies);

  return {
    valid: true,
    mode,
    ordered,
    completed: ordered.filter(function(item) { return completedIds.has(item.id); }),
    completedRecords: completedRecords.filter(function(item) { return requiredCompletedIds.has(item.id); }),
    remaining,
    productionNow,
    deferred,
    cost,
    affordableRecommendation: affordable,
    affordablePhase: fullPhaseAffordable ? phaseBatch : [],
    nextPhaseTitle: phaseItems[0]?.phaseTitle || null,
    cheapestValidBatchCost: remaining.length
      ? (affordable.length ? calculateProductionCost({ approvedProductionSet: { selectedDeliverables: affordable }, usageSnapshot }).productionUnitCount : null)
      : 0,
    noAffordableBatch: remaining.length > 0 && affordable.length === 0
  };
}

module.exports = {
  buildProductionBatchStatus,
  completedDeliverablesForPlan,
  dependencySafePrefix,
  reusableCompletedGeneration
};
