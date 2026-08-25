const { generateDeliverable } = require('./generationService');
const { getProductionHandler } = require('./productionHandlers');
const { persistUsageReversalsTransaction } = require('./subscriptions');

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'skipped']);

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

function claimNextRunnableJob(db, userId, productionRunId) {
  return db.transaction(() => {
    const run = db.prepare(`
      SELECT * FROM production_runs
      WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')
    `).get(productionRunId, userId);
    if (!run) return null;

    const candidates = db.prepare(`
      SELECT * FROM production_jobs
      WHERE production_run_id = ? AND status = 'queued'
      ORDER BY sequence_order ASC
    `).all(run.id);
    const candidate = candidates.find(function(job) {
      return dependenciesCompleted(db, run.id, JSON.parse(job.dependencies || '[]'));
    });
    if (!candidate) return null;

    const claimed = db.prepare(`
      UPDATE production_jobs
      SET status = 'running', attempt_count = attempt_count + 1,
          started_at = CURRENT_TIMESTAMP, last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND production_run_id = ? AND status = 'queued'
    `).run(candidate.id, run.id);
    if (claimed.changes !== 1) return null;
    db.prepare(`
      UPDATE production_runs SET status = 'running', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(run.id);
    return parseJob(db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(candidate.id));
  })();
}

function loadDependencyOutputs(db, job) {
  if (!job.dependencies.length) return [];
  return job.dependencies.map(function(deliverableId) {
    const dependency = db.prepare(`
      SELECT production_jobs.deliverable_id, production_jobs.title, generations.results
      FROM production_jobs
      JOIN generations ON generations.id = production_jobs.generation_id
      WHERE production_jobs.production_run_id = ?
        AND production_jobs.deliverable_id = ?
        AND production_jobs.status = 'completed'
    `).get(job.production_run_id, deliverableId);
    if (!dependency) {
      const error = new Error('Required dependency output is unavailable');
      error.code = 'DEPENDENCY_OUTPUT_MISSING';
      throw error;
    }
    return {
      deliverableId: dependency.deliverable_id,
      title: dependency.title,
      result: JSON.parse(dependency.results || '[]')
    };
  });
}

function unlockEligibleDependents(db, productionRunId) {
  const waitingJobs = db.prepare(`
    SELECT * FROM production_jobs
    WHERE production_run_id = ? AND status = 'waiting_dependency'
    ORDER BY sequence_order ASC
  `).all(productionRunId);
  let unlocked = 0;
  waitingJobs.forEach(function(job) {
    const dependencies = JSON.parse(job.dependencies || '[]');
    if (dependenciesCompleted(db, productionRunId, dependencies)) {
      unlocked += db.prepare(`
        UPDATE production_jobs SET status = 'queued', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'waiting_dependency'
      `).run(job.id).changes;
    }
  });
  return unlocked;
}

function updateProductionRunStatus(db, productionRunId) {
  const jobs = db.prepare(`
    SELECT status FROM production_jobs WHERE production_run_id = ?
  `).all(productionRunId);
  if (!jobs.length) return null;
  const completed = jobs.filter(function(job) { return job.status === 'completed'; }).length;
  const terminal = jobs.filter(function(job) { return TERMINAL_JOB_STATUSES.has(job.status); }).length;
  let status = 'running';
  if (completed === jobs.length) status = 'completed';
  else if (terminal === jobs.length && completed === 0) status = 'failed';
  else if (terminal === jobs.length) status = 'partially_completed';

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

function persistCompletedJob(db, run, job, generated) {
  return db.transaction(() => {
    const generation = db.prepare(`
      INSERT INTO generations (
        user_id, title, input_text, content_type, tone, results,
        word_count, goal, generation_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.user_id,
      generated.title,
      generated.inputText,
      generated.contentType,
      generated.tone,
      JSON.stringify(generated.results),
      generated.wordCount,
      generated.goal,
      generated.generationType
    );
    const completed = db.prepare(`
      UPDATE production_jobs
      SET status = 'completed', generation_id = ?, error_message = NULL,
          last_error_code = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running' AND generation_id IS NULL
    `).run(generation.lastInsertRowid, job.id);
    if (completed.changes !== 1) throw new Error('Production job is no longer claimable for completion');
    unlockEligibleDependents(db, run.id);
    const runStatus = updateProductionRunStatus(db, run.id);
    return { generationId: generation.lastInsertRowid, runStatus };
  })();
}

function descendantJobs(db, productionRunId, failedDeliverableId) {
  const jobs = db.prepare(`
    SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order ASC
  `).all(productionRunId).map(parseJob);
  const blocked = new Set([failedDeliverableId]);
  let changed = true;
  while (changed) {
    changed = false;
    jobs.forEach(function(job) {
      if (!blocked.has(job.deliverable_id)
        && job.dependencies.some(function(id) { return blocked.has(id); })) {
        blocked.add(job.deliverable_id);
        changed = true;
      }
    });
  }
  return jobs.filter(function(job) {
    return job.deliverable_id !== failedDeliverableId
      && blocked.has(job.deliverable_id)
      && ['queued', 'waiting_dependency'].includes(job.status);
  });
}

function handleJobFailure(db, run, job, err) {
  const current = parseJob(db.prepare('SELECT * FROM production_jobs WHERE id = ?').get(job.id));
  if (!current || current.status !== 'running') return { outcome: 'not_owned' };
  const permanent = Boolean(err?.permanent) || current.attempt_count >= current.max_attempts;
  if (!permanent) {
    db.transaction(() => {
      db.prepare(`
        UPDATE production_jobs
        SET status = 'queued', error_message = ?, last_error_code = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'running'
      `).run('A generation attempt failed and will be retried.', 'GENERATION_RETRY', current.id);
      updateProductionRunStatus(db, run.id);
    })();
    return { outcome: 'retry_scheduled', jobId: current.id, attemptCount: current.attempt_count };
  }

  const skipped = descendantJobs(db, run.id, current.deliverable_id);
  const reversalJobs = [
    { ...current, reversalReason: 'permanent_generation_failure' },
    ...skipped.map(function(item) { return { ...item, reversalReason: 'prerequisite_failure' }; })
  ].filter(function(item) { return !item.reversal_usage_event_id; });
  const reversal = persistUsageReversalsTransaction(db, {
    userId: run.user_id,
    usagePeriodId: run.usage_period_id,
    productionRunId: run.id,
    jobs: reversalJobs,
    sourceRoute: 'production_execution',
    persistState: (txDb) => {
      txDb.prepare(`
        UPDATE production_jobs
        SET status = 'failed', error_message = ?, last_error_code = ?,
            failed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'running'
      `).run("We couldn't complete this asset after multiple attempts.", 'GENERATION_FAILED', current.id);
      const skipJob = txDb.prepare(`
        UPDATE production_jobs
        SET status = 'skipped', error_message = ?, last_error_code = ?,
            failed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('queued', 'waiting_dependency')
      `);
      skipped.forEach(function(item) {
        skipJob.run('Required prerequisite could not be completed.', 'PREREQUISITE_FAILED', item.id);
      });
      updateProductionRunStatus(txDb, run.id);
    }
  });
  return {
    outcome: 'permanent_failure',
    jobId: current.id,
    skippedCount: skipped.length,
    reversalCount: reversal.reversalCount
  };
}

async function executeNextProductionJob({ db, userId, productionRunId, generatorApi }) {
  const run = db.prepare(`
    SELECT * FROM production_runs WHERE id = ? AND user_id = ?
  `).get(productionRunId, userId);
  if (!run) return { outcome: 'not_found' };
  const job = claimNextRunnableJob(db, userId, run.id);
  if (!job) {
    const status = updateProductionRunStatus(db, run.id);
    return { outcome: 'no_runnable_job', runStatus: status };
  }

  try {
    const handler = getProductionHandler(job.deliverable_id);
    if (!handler) {
      const unsupported = new Error('Unsupported production deliverable');
      unsupported.code = 'UNSUPPORTED_DELIVERABLE';
      unsupported.permanent = true;
      throw unsupported;
    }
    const dependencyOutputs = loadDependencyOutputs(db, job);
    const generated = await Promise.resolve(generateDeliverable({
      job,
      productionRun: { ...run, strategySnapshot: JSON.parse(run.strategy_snapshot || '{}') },
      dependencyOutputs,
      handler,
      generatorApi
    }));
    const persisted = persistCompletedJob(db, run, job, generated);
    return {
      outcome: 'completed',
      jobId: job.id,
      generationId: persisted.generationId,
      runStatus: persisted.runStatus,
      dependencyOutputs
    };
  } catch (err) {
    return handleJobFailure(db, run, job, err);
  }
}

module.exports = {
  claimNextRunnableJob,
  executeNextProductionJob,
  loadDependencyOutputs,
  updateProductionRunStatus
};
