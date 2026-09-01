const { reconcileRecoveryJob } = require('./productionExecution');

const RECOVERY_ACTIONS = new Set(['safe_retry', 'mark_failed', 'mark_completed']);

function positiveLimit(value, fallback = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : fallback;
}

function safeToken(value, fallback) {
  const normalized = String(value || '');
  return /^[A-Za-z0-9_:-]{1,160}$/.test(normalized) ? normalized : fallback;
}

function inspectProductionRecovery(db, { limit = 100 } = {}) {
  const boundedLimit = positiveLimit(limit);
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'recovery_required' THEN 1 ELSE 0 END) AS recovery_required_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count
    FROM production_jobs
  `).get();
  const rows = db.prepare(`
    SELECT production_jobs.id AS job_id, production_jobs.production_run_id AS run_id,
           production_jobs.deliverable_id, production_jobs.status,
           production_jobs.attempt_count, production_jobs.max_attempts,
           production_jobs.last_error_code, production_jobs.updated_at
    FROM production_jobs
    WHERE production_jobs.status IN ('recovery_required', 'failed')
    ORDER BY CASE production_jobs.status WHEN 'recovery_required' THEN 0 ELSE 1 END,
             datetime(production_jobs.updated_at) ASC, production_jobs.id ASC
    LIMIT ?
  `).all(boundedLimit + 1);
  const truncated = rows.length > boundedLimit;
  const issues = rows.slice(0, boundedLimit).map(function(issue) {
    return {
      runId: issue.run_id,
      jobId: issue.job_id,
      deliverableId: safeToken(issue.deliverable_id, 'unknown'),
      status: issue.status,
      attemptCount: issue.attempt_count,
      maxAttempts: issue.max_attempts,
      failureCode: issue.last_error_code ? safeToken(issue.last_error_code, 'PRODUCTION_FAILURE') : null,
      updatedAt: issue.updated_at
    };
  });
  return {
    recoveryRequiredCount: Number(counts.recovery_required_count || 0),
    failedCount: Number(counts.failed_count || 0),
    skippedCount: Number(counts.skipped_count || 0),
    issueCount: issues.length,
    truncated,
    issues
  };
}

function applyProductionRecovery(db, {
  productionRunId,
  productionJobId,
  action,
  generationId,
  verifiedSafe = false
}) {
  if (!Number.isInteger(productionRunId) || productionRunId <= 0
    || !Number.isInteger(productionJobId) || productionJobId <= 0
    || !RECOVERY_ACTIONS.has(action)) {
    return { valid: false, code: 'PRODUCTION_RECOVERY_INPUT_INVALID' };
  }
  if (!verifiedSafe) return { valid: false, code: 'PRODUCTION_RECOVERY_VERIFICATION_REQUIRED' };
  if (action === 'mark_completed' && (!Number.isInteger(generationId) || generationId <= 0)) {
    return { valid: false, code: 'PRODUCTION_RECOVERY_GENERATION_REQUIRED' };
  }
  const owner = db.prepare(`
    SELECT production_runs.user_id FROM production_runs
    JOIN production_jobs ON production_jobs.production_run_id = production_runs.id
    WHERE production_runs.id = ? AND production_jobs.id = ?
  `).get(productionRunId, productionJobId);
  if (!owner) return { valid: false, code: 'PRODUCTION_RECOVERY_NOT_FOUND' };
  const result = reconcileRecoveryJob(db, {
    userId: owner.user_id,
    productionRunId,
    productionJobId,
    action,
    generationId,
    verifiedSafe: true
  });
  return result.valid
    ? { ...result, code: 'PRODUCTION_RECOVERY_APPLIED' }
    : { valid: false, code: 'PRODUCTION_RECOVERY_REJECTED' };
}

module.exports = { RECOVERY_ACTIONS, applyProductionRecovery, inspectProductionRecovery, positiveLimit, safeToken };
