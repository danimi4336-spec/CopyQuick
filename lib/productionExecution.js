const crypto = require('crypto');
const { generateDeliverable } = require('./generationService');
const { getProductionHandler } = require('./productionHandlers');
const { persistUsageReversalsTransaction } = require('./subscriptions');

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'skipped']);
const DEFAULT_LEASE_SECONDS = 300;

function leaseSeconds(value = process.env.PRODUCTION_JOB_LEASE_SECONDS) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LEASE_SECONDS;
}

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid production execution time');
  return date;
}

function parseJob(job) {
  if (!job) return null;
  return {
    ...job,
    dependencies: JSON.parse(job.dependencies || '[]'),
    strategySnapshot: JSON.parse(job.strategy_snapshot || '{}')
  };
}

function dependenciesCompleted(db, productionRunId, dependencies) {
  if (!dependencies.length) return true;
  const placeholders = dependencies.map(function() { return '?'; }).join(',');
  const completed = db.prepare(`
    SELECT COUNT(*) AS count FROM production_jobs
    WHERE production_run_id = ? AND deliverable_id IN (${placeholders}) AND status = 'completed'
  `).get(productionRunId, ...dependencies).count;
  return completed === dependencies.length;
}

function unlockEligibleDependents(db, productionRunId) {
  const waitingJobs = db.prepare(`
    SELECT * FROM production_jobs
    WHERE production_run_id = ? AND status = 'waiting_dependency'
    ORDER BY sequence_order ASC
  `).all(productionRunId);
  let unlocked = 0;
  waitingJobs.forEach(function(job) {
    if (dependenciesCompleted(db, productionRunId, JSON.parse(job.dependencies || '[]'))) {
      unlocked += db.prepare(`
        UPDATE production_jobs SET status = 'queued', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'waiting_dependency'
      `).run(job.id).changes;
    }
  });
  return unlocked;
}

function updateProductionRunStatus(db, productionRunId) {
  const jobs = db.prepare('SELECT status FROM production_jobs WHERE production_run_id = ?').all(productionRunId);
  if (!jobs.length) return null;
  const completed = jobs.filter(function(job) { return job.status === 'completed'; }).length;
  const terminal = jobs.filter(function(job) { return TERMINAL_JOB_STATUSES.has(job.status); }).length;
  const hasRecovery = jobs.some(function(job) { return job.status === 'recovery_required'; });
  let status = 'running';
  if (completed === jobs.length) status = 'completed';
  else if (terminal === jobs.length && completed === 0) status = 'failed';
  else if (terminal === jobs.length) status = 'partially_completed';
  else if (hasRecovery) status = 'running';
  db.prepare(`
    UPDATE production_runs
    SET status = ?,
        completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        failed_at = CASE WHEN ? IN ('failed', 'partially_completed') THEN CURRENT_TIMESTAMP ELSE failed_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, status, status, productionRunId);
  return status;
}

function recoverExpiredJobs(db, userId, productionRunId, options = {}) {
  const now = dateValue(options.now).toISOString();
  return db.transaction(() => {
    const run = db.prepare('SELECT * FROM production_runs WHERE id = ? AND user_id = ?').get(productionRunId, userId);
    if (!run) return { outcome: 'not_found', recovered: [], ambiguous: [], normalized: [] };
    const expired = db.prepare(`
      SELECT * FROM production_jobs
      WHERE production_run_id = ? AND status = 'running'
        AND lease_expires_at IS NOT NULL AND datetime(lease_expires_at) <= datetime(?)
      ORDER BY sequence_order ASC
    `).all(run.id, now);
    const result = { outcome: 'recovered', recovered: [], ambiguous: [], normalized: [] };
    expired.forEach(function(job) {
      const generation = job.generation_id
        ? db.prepare('SELECT * FROM generations WHERE id = ? AND user_id = ?').get(job.generation_id, userId)
        : db.prepare('SELECT * FROM generations WHERE production_job_id = ? AND user_id = ?').get(job.id, userId);
      if (generation) {
        db.prepare(`
          UPDATE production_jobs
          SET status = 'completed', generation_id = ?, completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
              claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL,
              provider_started_at = NULL, recovery_reason = NULL, error_message = NULL,
              contract_version = COALESCE(contract_version, ?), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'running'
        `).run(generation.id, generation.contract_version || null, job.id);
        result.normalized.push(job.id);
      } else if (!job.provider_started_at) {
        db.prepare(`
          UPDATE production_jobs
          SET status = 'queued', claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL,
              recovery_reason = NULL, error_message = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'running'
        `).run('Interrupted before generation began. Safely queued again.', job.id);
        result.recovered.push(job.id);
      } else {
        db.prepare(`
          UPDATE production_jobs
          SET status = 'recovery_required', claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL,
              recovery_reason = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'running'
        `).run(
          'Provider invocation may have completed without a persisted result.',
          'This item was interrupted while being created. CopyQuick needs to safely verify it before trying again.',
          job.id
        );
        result.ambiguous.push(job.id);
      }
    });
    if (result.normalized.length) unlockEligibleDependents(db, run.id);
    updateProductionRunStatus(db, run.id);
    return result;
  })();
}

function claimNextRunnableJob(db, userId, productionRunId, options = {}) {
  const nowDate = dateValue(options.now);
  const claimedAt = nowDate.toISOString();
  const leaseExpiresAt = new Date(nowDate.getTime() + leaseSeconds(options.leaseSeconds) * 1000).toISOString();
  const claimToken = options.claimToken || (options.tokenFactory || crypto.randomUUID)();
  return db.transaction(() => {
    const run = db.prepare(`
      SELECT * FROM production_runs WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')
    `).get(productionRunId, userId);
    if (!run) return null;
    const candidates = db.prepare(`
      SELECT * FROM production_jobs WHERE production_run_id = ? AND status = 'queued' ORDER BY sequence_order ASC
    `).all(run.id);
    const candidate = candidates.find(function(job) {
      return dependenciesCompleted(db, run.id, JSON.parse(job.dependencies || '[]'));
    });
    if (!candidate) return null;
    const contract = getProductionHandler(candidate.deliverable_id);
    const claimed = db.prepare(`
      UPDATE production_jobs
      SET status = 'running', attempt_count = attempt_count + 1, started_at = CURRENT_TIMESTAMP,
          claimed_at = ?, lease_expires_at = ?, claim_token = ?, provider_started_at = NULL,
          contract_version = COALESCE(contract_version, ?), recovery_reason = NULL,
          last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND production_run_id = ? AND status = 'queued'
    `).run(claimedAt, leaseExpiresAt, claimToken, contract?.version || null, candidate.id, run.id);
    if (claimed.changes !== 1) return null;
    db.prepare(`UPDATE production_runs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(run.id);
    return parseJob(db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(candidate.id));
  })();
}

function loadDependencyOutputs(db, job) {
  if (!job.dependencies.length) return [];
  return job.dependencies.map(function(deliverableId) {
    const dependency = db.prepare(`
      SELECT production_jobs.deliverable_id, production_jobs.title, production_jobs.contract_version,
             generations.results, generations.structured_result
      FROM production_jobs JOIN generations ON generations.id = production_jobs.generation_id
      WHERE production_jobs.production_run_id = ? AND production_jobs.deliverable_id = ?
        AND production_jobs.status = 'completed'
    `).get(job.production_run_id, deliverableId);
    if (!dependency) {
      const error = new Error('Required dependency output is unavailable');
      error.code = 'DEPENDENCY_OUTPUT_MISSING';
      throw error;
    }
    const result = JSON.parse(dependency.results || '[]');
    return {
      deliverableId: dependency.deliverable_id,
      title: dependency.title,
      contractVersion: dependency.contract_version,
      output: dependency.structured_result ? JSON.parse(dependency.structured_result) : { content: result.map(function(item) { return item.text; }) },
      result
    };
  });
}

function markProviderStarted(db, job) {
  return db.prepare(`
    UPDATE production_jobs SET provider_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'running' AND claim_token = ?
  `).run(job.id, job.claim_token).changes === 1;
}

function persistCompletedJob(db, run, job, generated) {
  return db.transaction(() => {
    const completionTime = new Date().toISOString();
    const generation = db.prepare(`
      INSERT INTO generations (
        user_id, title, input_text, content_type, tone, results, word_count, goal,
        generation_type, production_job_id, deliverable_id, contract_version, structured_result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.user_id, generated.title, generated.inputText, generated.contentType, generated.tone,
      JSON.stringify(generated.results), generated.wordCount, generated.goal, generated.generationType,
      job.id, job.deliverable_id, generated.contractVersion, JSON.stringify(generated.structuredOutput)
    );
    const completed = db.prepare(`
      UPDATE production_jobs
      SET status = 'completed', generation_id = ?, error_message = NULL, last_error_code = NULL,
          completed_at = CURRENT_TIMESTAMP, claim_token = NULL, claimed_at = NULL,
          lease_expires_at = NULL, provider_started_at = NULL, recovery_reason = NULL,
          contract_version = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running' AND generation_id IS NULL AND claim_token = ?
        AND datetime(lease_expires_at) > datetime(?)
    `).run(generation.lastInsertRowid, generated.contractVersion, job.id, job.claim_token, completionTime);
    if (completed.changes !== 1) {
      const error = new Error('Production claim ownership was lost before completion');
      error.code = 'CLAIM_OWNERSHIP_LOST';
      throw error;
    }
    unlockEligibleDependents(db, run.id);
    return { generationId: generation.lastInsertRowid, runStatus: updateProductionRunStatus(db, run.id) };
  })();
}

function descendantJobs(db, productionRunId, failedDeliverableId) {
  const jobs = db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order ASC').all(productionRunId).map(parseJob);
  const blocked = new Set([failedDeliverableId]);
  let changed = true;
  while (changed) {
    changed = false;
    jobs.forEach(function(job) {
      if (!blocked.has(job.deliverable_id) && job.dependencies.some(function(id) { return blocked.has(id); })) {
        blocked.add(job.deliverable_id);
        changed = true;
      }
    });
  }
  return jobs.filter(function(job) {
    return job.deliverable_id !== failedDeliverableId && blocked.has(job.deliverable_id)
      && ['queued', 'waiting_dependency'].includes(job.status);
  });
}

function handleJobFailure(db, run, job, err) {
  const current = parseJob(db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(job.id));
  if (!current || current.status !== 'running' || current.claim_token !== job.claim_token) return { outcome: 'not_owned' };
  if (current.lease_expires_at && Date.parse(current.lease_expires_at) <= Date.now() && current.provider_started_at) {
    recoverExpiredJobs(db, run.user_id, run.id);
    return { outcome: 'recovery_required', jobId: current.id };
  }
  const permanent = Boolean(err?.permanent) || current.attempt_count >= current.max_attempts;
  if (!permanent) {
    db.transaction(() => {
      db.prepare(`
        UPDATE production_jobs
        SET status = 'queued', error_message = ?, last_error_code = ?, claim_token = NULL,
            claimed_at = NULL, lease_expires_at = NULL, provider_started_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'running' AND claim_token = ?
      `).run('A generation attempt failed and will be retried.', err?.code || 'GENERATION_RETRY', current.id, job.claim_token);
      updateProductionRunStatus(db, run.id);
    })();
    return { outcome: 'retry_scheduled', jobId: current.id, attemptCount: current.attempt_count };
  }
  const skipped = descendantJobs(db, run.id, current.deliverable_id);
  const reversalJobs = [{ ...current, reversalReason: 'permanent_generation_failure' }]
    .concat(skipped.map(function(item) { return { ...item, reversalReason: 'prerequisite_failure' }; }))
    .filter(function(item) { return !item.reversal_usage_event_id; });
  const reversal = persistUsageReversalsTransaction(db, {
    userId: run.user_id, usagePeriodId: run.usage_period_id, productionRunId: run.id,
    jobs: reversalJobs, sourceRoute: 'production_execution',
    persistState: (txDb) => {
      txDb.prepare(`
        UPDATE production_jobs
        SET status = 'failed', error_message = ?, last_error_code = ?, failed_at = CURRENT_TIMESTAMP,
            claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL, provider_started_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'running' AND claim_token = ?
      `).run("We couldn't complete this asset after multiple attempts.", err?.code || 'GENERATION_FAILED', current.id, job.claim_token);
      const skipJob = txDb.prepare(`
        UPDATE production_jobs
        SET status = 'skipped', error_message = ?, last_error_code = ?, failed_at = CURRENT_TIMESTAMP,
            claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL, provider_started_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('queued', 'waiting_dependency')
      `);
      skipped.forEach(function(item) { skipJob.run('Required prerequisite could not be completed.', 'PREREQUISITE_FAILED', item.id); });
      updateProductionRunStatus(txDb, run.id);
    }
  });
  return { outcome: 'permanent_failure', jobId: current.id, skippedCount: skipped.length, reversalCount: reversal.reversalCount };
}

async function executeNextProductionJob({ db, userId, productionRunId, generatorApi, now, leaseDurationSeconds }) {
  const run = db.prepare('SELECT * FROM production_runs WHERE id = ? AND user_id = ?').get(productionRunId, userId);
  if (!run) return { outcome: 'not_found' };
  recoverExpiredJobs(db, userId, run.id, { now });
  const job = claimNextRunnableJob(db, userId, run.id, { now, leaseSeconds: leaseDurationSeconds });
  if (!job) return { outcome: 'no_runnable_job', runStatus: updateProductionRunStatus(db, run.id) };
  try {
    const handler = getProductionHandler(job.deliverable_id);
    if (!handler) {
      const error = new Error('Unsupported production deliverable');
      error.code = 'UNSUPPORTED_DELIVERABLE';
      error.permanent = true;
      throw error;
    }
    const dependencyOutputs = loadDependencyOutputs(db, job);
    if (!markProviderStarted(db, job)) return { outcome: 'not_owned' };
    const generated = await Promise.resolve(generateDeliverable({
      job, productionRun: { ...run, strategySnapshot: JSON.parse(run.strategy_snapshot || '{}') },
      dependencyOutputs, handler, generatorApi
    }));
    const persisted = persistCompletedJob(db, run, job, generated);
    return { outcome: 'completed', jobId: job.id, generationId: persisted.generationId, runStatus: persisted.runStatus, dependencyOutputs };
  } catch (err) {
    return handleJobFailure(db, run, job, err);
  }
}

module.exports = {
  claimNextRunnableJob,
  executeNextProductionJob,
  handleJobFailure,
  loadDependencyOutputs,
  persistCompletedJob,
  recoverExpiredJobs,
  updateProductionRunStatus
};
