const { executeNextProductionJob, recoverExpiredJobs, updateProductionRunStatus } = require('./productionExecution');

const MAX_CYCLE_WORK = 16;
const DEFAULT_RECOVERY_SCAN_LIMIT = 100;
const MAX_RECOVERY_SCAN_LIMIT = 1000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function maxConcurrency(value = process.env.PRODUCTION_MAX_CONCURRENCY) {
  return Math.min(positiveInteger(value, 1), MAX_CYCLE_WORK);
}

function eligibleRuns(db, now, excludedRunIds = []) {
  const excluded = [...new Set(excludedRunIds)].filter(Number.isSafeInteger);
  const exclusion = excluded.length
    ? `AND production_runs.id NOT IN (${excluded.map(() => '?').join(',')})`
    : '';
  return db.prepare(`
    SELECT production_runs.*
    FROM production_runs
    WHERE production_runs.status IN ('queued', 'running')
      AND EXISTS (
        SELECT 1 FROM production_jobs
        WHERE production_jobs.production_run_id = production_runs.id
          AND production_jobs.status = 'queued'
          AND (production_jobs.next_attempt_at IS NULL OR datetime(production_jobs.next_attempt_at) <= datetime(?))
      )
      ${exclusion}
    ORDER BY CASE WHEN production_runs.last_scheduled_at IS NULL THEN 0 ELSE 1 END ASC,
             datetime(production_runs.last_scheduled_at) ASC,
             production_runs.id ASC
    LIMIT 1
  `).all(now, ...excluded);
}

function recoverActiveRuns(db, now, scanLimit = process.env.PRODUCTION_RECOVERY_SCAN_LIMIT) {
  const limit = Math.min(positiveInteger(scanLimit, DEFAULT_RECOVERY_SCAN_LIMIT), MAX_RECOVERY_SCAN_LIMIT);
  const runs = db.prepare(`
    SELECT id, user_id FROM production_runs WHERE status IN ('queued', 'running', 'blocked')
    ORDER BY datetime(updated_at) ASC, id ASC
    LIMIT ?
  `).all(limit);
  return runs.map(function(run) {
    const recovery = recoverExpiredJobs(db, run.user_id, run.id, { now, blockedStatus: true });
    updateProductionRunStatus(db, run.id, { blockedStatus: true });
    return recovery;
  });
}

async function runOrchestratorCycle({
  db,
  generatorApi,
  now = new Date(),
  concurrency,
  leaseDurationSeconds,
  retryBaseSeconds
}) {
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const recoveries = recoverActiveRuns(db, timestamp);
  const attemptedRuns = [];
  const results = [];
  const limit = maxConcurrency(concurrency);
  while (results.length < limit) {
    const run = eligibleRuns(db, timestamp, attemptedRuns)[0];
    if (!run) break;
    attemptedRuns.push(run.id);
    db.prepare(`
      UPDATE production_runs SET last_scheduled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(timestamp, run.id);
    const result = await executeNextProductionJob({
      db,
      userId: run.user_id,
      productionRunId: run.id,
      generatorApi,
      now: timestamp,
      leaseDurationSeconds,
      retryDelayBaseSeconds: retryBaseSeconds === undefined ? 5 : retryBaseSeconds
    });
    results.push({ productionRunId: run.id, userId: run.user_id, ...result });
  }
  return { recoveries, results, workPerformed: results.length };
}

module.exports = {
  DEFAULT_RECOVERY_SCAN_LIMIT,
  MAX_CYCLE_WORK,
  MAX_RECOVERY_SCAN_LIMIT,
  eligibleRuns,
  maxConcurrency,
  recoverActiveRuns,
  runOrchestratorCycle
};
