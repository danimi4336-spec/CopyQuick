const crypto = require('crypto');
const { createProductionStrategySnapshot, planFingerprint } = require('./buildPlanApproval');
const { isDiscoverySessionReady } = require('./discoveryRequirements');
const { calculateProductionCost } = require('./productionCost');
const { buildProductionBatchStatus } = require('./productionBatchPlanning');
const { createProductionProgressSnapshot } = require('./productionPlanProgress');
const { deriveProductionPlanName } = require('./productionPlanIdentity');
const { getProductionHandler } = require('./productionHandlers');
const { recordProductionJobEvent } = require('./productionEvents');
const { parseJob, parseStrategySnapshot } = require('./productionState');
const {
  getCurrentUsageSnapshot,
  getCurrentUsageSnapshotReadOnly,
  persistUsageTransaction,
  UsageLimitExceededError
} = require('./subscriptions');

function hasCurrentStrategyState(session) {
  if (!session?.planningConfirmedAt
    || !session?.confirmedUnderstanding
    || !session?.strategyResult
    || !session?.strategyUpdatedAt) return false;
  const confirmedAt = Date.parse(session.planningConfirmedAt);
  const strategyAt = Date.parse(session.strategyUpdatedAt);
  return Number.isFinite(confirmedAt) && Number.isFinite(strategyAt) && strategyAt >= confirmedAt;
}

function validateApprovedProductionSession(session) {
  if (!isDiscoverySessionReady(session)) {
    return { valid: false, redirect: '/discovery/reflection', reason: 'Resolve the essential discovery requirements before production.' };
  }
  if (!session?.planningConfirmedAt || !session?.confirmedUnderstanding) {
    return { valid: false, redirect: '/discovery/reflection', reason: 'Confirm the current business understanding again before production.' };
  }
  if (!hasCurrentStrategyState(session)) {
    return { valid: false, redirect: '/discovery/strategy', reason: 'Review the current strategy again before production.' };
  }
  if (!session.buildPlan || !session.buildPlanSource || !session.buildPlanFingerprint) {
    return { valid: false, redirect: '/discovery/build-plan', reason: 'Review the current Build Plan again before production.' };
  }
  if (session.buildPlanSource.planningConfirmedAt !== session.planningConfirmedAt
    || session.buildPlanSource.strategyUpdatedAt !== session.strategyUpdatedAt
    || session.buildPlanFingerprint !== planFingerprint(session.buildPlan)) {
    return { valid: false, redirect: '/discovery/build-plan', reason: 'The Build Plan changed and must be reviewed again.' };
  }
  const approved = session.approvedProductionSet;
  if (!approved || approved.planFingerprint !== session.buildPlanFingerprint) {
    return { valid: false, redirect: '/discovery/build-plan', reason: 'Approve the current Build Plan before production.' };
  }
  if (!approved.approvedAt
    || session.buildPlanSelection?.approvedAt !== approved.approvedAt) {
    return { valid: false, redirect: '/discovery/build-plan', reason: 'The production approval is no longer current.' };
  }
  const selectedIds = (approved.selectedDeliverables || []).map(function(item) { return item.id; });
  if (!selectedIds.length
    || selectedIds.length !== (approved.productionOrder || []).length
    || selectedIds.some(function(id, index) { return approved.productionOrder[index] !== id; })) {
    return { valid: false, redirect: '/discovery/build-plan', reason: 'The approved production order is invalid.' };
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    return { valid: false, redirect: '/discovery/build-plan', reason: 'The approved production set contains duplicate deliverables.' };
  }
  const planItems = session.buildPlan.phases.flatMap(function(phase) { return phase.deliverables; });
  const planById = new Map(planItems.map(function(item) { return [item.id, item]; }));
  const positionById = new Map(selectedIds.map(function(id, index) { return [id, index]; }));
  const invalidItem = approved.selectedDeliverables.find(function(item, index) {
    const planned = planById.get(item.id);
    const dependencies = item.dependencies || [];
    return !planned
      || item.phase !== planned.phase
      || item.reason !== planned.reason
      || item.strategicDirection !== planned.strategicDirection
      || JSON.stringify(dependencies) !== JSON.stringify(planned.dependencies || [])
      || dependencies.some(function(dependencyId) {
        return !positionById.has(dependencyId) || positionById.get(dependencyId) >= index;
      });
  });
  if (invalidItem) {
    return { valid: false, redirect: '/discovery/build-plan', reason: 'The approved production set no longer matches the current Build Plan.' };
  }
  const selectedFromSession = session.buildPlanSelection?.selectedDeliverableIds || [];
  if (selectedFromSession.length !== selectedIds.length
    || selectedFromSession.some(function(id) { return !positionById.has(id); })) {
    return { valid: false, redirect: '/discovery/build-plan', reason: 'The approved production selection is no longer current.' };
  }
  const expectedStrategySnapshot = createProductionStrategySnapshot({
    objective: session.objective,
    strategyResult: session.strategyResult,
    confirmedUnderstanding: session.confirmedUnderstanding
  });
  if (JSON.stringify(approved.strategySnapshot || {}) !== JSON.stringify(expectedStrategySnapshot)) {
    return { valid: false, redirect: '/discovery/strategy', reason: 'The approved strategy changed and must be reviewed again.' };
  }
  return { valid: true, approvedProductionSet: approved };
}

function productionIdempotencyKey(userId, approvedProductionSet, completedDeliverableIds = []) {
  return crypto.createHash('sha256').update([
    userId,
    approvedProductionSet.planFingerprint,
    approvedProductionSet.approvedAt,
    approvedProductionSet.batchMode || 'full',
    completedDeliverableIds.join(',')
  ].join(':')).digest('hex');
}

function getProductionReview({ db, user, discoverySession }) {
  const freshness = validateApprovedProductionSession(discoverySession);
  if (!freshness.valid) return freshness;
  const usageSnapshot = getCurrentUsageSnapshotReadOnly(db, user);
  const batch = buildProductionBatchStatus({
    db, userId: user.id, plan: discoverySession.buildPlan,
    selection: discoverySession.buildPlanSelection, usageSnapshot,
    mode: freshness.approvedProductionSet.batchMode || 'full'
  });
  if (!batch.valid) return { valid: false, redirect: '/discovery/build-plan', reason: batch.error };
  if (!batch.productionNow.length) {
    return {
      valid: false,
      redirect: '/discovery/build-plan',
      reason: batch.completed.length === batch.ordered.length
        ? 'All deliverables in this plan are already completed.'
        : 'No dependency-safe production batch fits the current generation balance.'
    };
  }
  const cost = batch.cost;
  if (!cost.valid) return { valid: false, redirect: '/discovery/build-plan', reason: cost.blockingReason };
  return {
    valid: true,
    approvedProductionSet: freshness.approvedProductionSet,
    batch,
    cost
  };
}

function getExistingRun(db, userId, idempotencyKey) {
  return db.prepare(`
    SELECT * FROM production_runs WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey);
}

function getActiveRun(db, userId, approvedProductionSet) {
  return db.prepare(`
    SELECT * FROM production_runs
    WHERE user_id = ?
      AND plan_fingerprint = ?
      AND approved_at = ?
      AND status IN ('queued', 'running', 'blocked')
    ORDER BY id DESC
    LIMIT 1
  `).get(userId, approvedProductionSet.planFingerprint, approvedProductionSet.approvedAt);
}

function initializeProduction({ db, user, discoverySession }) {
  const freshness = validateApprovedProductionSession(discoverySession);
  if (!freshness.valid) return freshness;
  const approved = freshness.approvedProductionSet;
  const active = getActiveRun(db, user.id, approved);
  if (active) return { valid: true, duplicate: true, productionRunId: active.id };

  const usageSnapshot = getCurrentUsageSnapshot(db, user);
  const batch = buildProductionBatchStatus({
    db, userId: user.id, plan: discoverySession.buildPlan,
    selection: discoverySession.buildPlanSelection, usageSnapshot,
    mode: approved.batchMode || 'full'
  });
  if (!batch.valid) return { valid: false, redirect: '/discovery/build-plan', reason: batch.error };
  const idempotencyKey = productionIdempotencyKey(
    user.id,
    approved,
    batch.completed.map(function(item) { return item.id; })
  );
  const existing = getExistingRun(db, user.id, idempotencyKey);
  if (existing) return { valid: true, duplicate: true, productionRunId: existing.id };
  if (!batch.productionNow.length) {
    return { valid: false, insufficientAllowance: true, cost: batch.cost, reason: 'No dependency-safe production batch fits the current generation balance.' };
  }
  const cost = batch.cost;
  if (!cost.valid) return { valid: false, redirect: '/discovery/build-plan', reason: cost.blockingReason };
  if (!cost.canAfford) return { valid: false, insufficientAllowance: true, cost, reason: cost.blockingReason };

  const strategySnapshotJson = JSON.stringify(approved.strategySnapshot || {});
  try {
    const persisted = persistUsageTransaction(db, {
      userId: user.id,
      usagePeriodId: usageSnapshot.usagePeriod.id,
      eventType: 'production_start',
      sourceRoute: 'POST /production/start',
      units: cost.productionUnitCount,
      metadata: {
        planFingerprint: approved.planFingerprint,
        deliverableCount: batch.productionNow.length,
        planningFoundationCount: cost.planningFoundationCount,
        readyToUseAssetCount: cost.readyToUseAssetCount,
        completedPrerequisiteCount: batch.completedRecords.length,
        costingModel: cost.costingModel
      },
      persistResource: (txDb) => {
        const runInsert = txDb.prepare(`
          INSERT OR IGNORE INTO production_runs (
            user_id, objective, status, plan_fingerprint, idempotency_key,
            approved_at, started_at, strategy_snapshot, production_cost_units, usage_period_id,
            production_plan_snapshot
          ) VALUES (?, ?, 'queued', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
        `).run(
          user.id,
          approved.objective,
          approved.planFingerprint,
          idempotencyKey,
          approved.approvedAt,
          strategySnapshotJson,
          cost.productionUnitCount,
          usageSnapshot.usagePeriod.id,
          JSON.stringify(createProductionProgressSnapshot(approved, {
            displayName: deriveProductionPlanName(discoverySession)
          }))
        );
        if (runInsert.changes !== 1) {
          const duplicate = getExistingRun(txDb, user.id, idempotencyKey);
          return { duplicate: true, productionRunId: duplicate.id };
        }

        const productionRunId = runInsert.lastInsertRowid;
        const insertJob = txDb.prepare(`
          INSERT INTO production_jobs (
            production_run_id, deliverable_id, title, phase, phase_title,
            sequence_order, status, strategic_direction, strategy_snapshot, dependencies,
            contract_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const carried = new Map(batch.completedRecords.map(function(item) { return [item.id, item]; }));
        const runItems = approved.selectedDeliverables.filter(function(item) {
          return carried.has(item.id) || batch.productionNow.some(function(candidate) { return candidate.id === item.id; });
        });
        runItems.forEach(function(item, index) {
          const dependencies = item.dependencies || [];
          const prior = carried.get(item.id);
          const dependenciesAlreadyCompleted = dependencies.every(function(dependencyId) {
            return carried.has(dependencyId);
          });
          const initialStatus = prior
            ? 'completed'
            : dependenciesAlreadyCompleted ? 'queued' : 'waiting_dependency';
          const insertedJob = insertJob.run(
            productionRunId,
            item.id,
            item.title,
            item.phase,
            item.phaseTitle || '',
            index,
            initialStatus,
            item.strategicDirection || '',
            strategySnapshotJson,
            JSON.stringify(dependencies),
            getProductionHandler(item.id)?.version || null
          );
          if (prior) {
            txDb.prepare(`
              UPDATE production_jobs
              SET generation_id = ?, completed_at = COALESCE(?, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(prior.generationId, prior.completedAt, insertedJob.lastInsertRowid);
          }
          recordProductionJobEvent(txDb, {
            productionRunId,
            productionJobId: insertedJob.lastInsertRowid,
            eventType: 'job_created',
            toStatus: initialStatus,
            metadata: { contractVersion: getProductionHandler(item.id)?.version || '', reused: Boolean(prior) }
          });
        });
        return { productionRunId };
      },
      buildUsageReference: (resource) => ({ productionRunId: resource.productionRunId }),
      finalizeResource: (txDb, resource) => {
        txDb.prepare(`
          UPDATE production_runs SET usage_event_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(resource.usageEventId, resource.productionRunId);
      }
    });
    return {
      valid: true,
      duplicate: Boolean(persisted.duplicate),
      productionRunId: persisted.productionRunId,
      cost,
      batch
    };
  } catch (err) {
    if (err instanceof UsageLimitExceededError || err?.code === 'USAGE_LIMIT_EXCEEDED') {
      return { valid: false, insufficientAllowance: true, cost, reason: 'The available generation allowance changed. Review the current cost before starting.' };
    }
    throw err;
  }
}

function getProductionRun(db, userId, runId) {
  const run = db.prepare(`
    SELECT * FROM production_runs WHERE id = ? AND user_id = ?
  `).get(runId, userId);
  if (!run) return null;
  const jobs = db.prepare(`
    SELECT * FROM production_jobs
    WHERE production_run_id = ?
    ORDER BY sequence_order ASC
  `).all(run.id).map(parseJob);
  let strategySnapshot = {};
  let costingModel = 'existing_generation_unit';
  let runStateInvalid = false;
  try {
    strategySnapshot = parseStrategySnapshot(run.strategy_snapshot, 'run_strategy_snapshot');
  } catch (error) {
    runStateInvalid = true;
  }
  if (run.usage_event_id) {
    const usageEvent = db.prepare('SELECT metadata FROM usage_events WHERE id = ?').get(run.usage_event_id);
    try {
      costingModel = JSON.parse(usageEvent?.metadata || '{}').costingModel || costingModel;
    } catch (_) { /* Preserve the legacy model label for malformed historical metadata. */ }
  }
  return {
    ...run,
    strategySnapshot,
    costingModel,
    stateInvalid: runStateInvalid || jobs.some(function(job) { return Boolean(job.stateError); }),
    jobs
  };
}

module.exports = {
  getProductionReview,
  getProductionRun,
  initializeProduction,
  productionIdempotencyKey,
  validateApprovedProductionSession
};
