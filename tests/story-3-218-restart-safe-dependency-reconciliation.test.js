const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { eligibleRuns, recoverActiveRuns } = require('../lib/productionOrchestrator');

const db = new Database(':memory:');
runMigrationEngine(db, { logger: () => {} });

const userId = Number(db.prepare(`
  INSERT INTO users(email, name) VALUES('story-3-218@example.test', 'Restart Recovery')
`).run().lastInsertRowid);
const runId = Number(db.prepare(`
  INSERT INTO production_runs(
    user_id, objective, status, plan_fingerprint, idempotency_key,
    approved_at, strategy_snapshot, production_cost_units
  ) VALUES (?, 'get_more_customers', 'running', 'story-3-218-plan',
    'story-3-218-run', CURRENT_TIMESTAMP, '{}', 0)
`).run(userId).lastInsertRowid);

const insertJob = db.prepare(`
  INSERT INTO production_jobs(
    production_run_id, deliverable_id, title, phase, sequence_order,
    status, strategic_direction, strategy_snapshot, dependencies
  ) VALUES (?, ?, ?, 'foundation', ?, ?, 'Test direction.', '{}', ?)
`);
insertJob.run(runId, 'acquisition_snapshot', 'Customer Acquisition Snapshot', 0, 'completed', '[]');
insertJob.run(runId, 'acquisition_channel_strategy', 'Acquisition Channel Strategy', 1, 'completed', '["acquisition_snapshot"]');
insertJob.run(runId, 'campaign_brief', 'Lead Generation Campaign Brief', 2, 'completed', '["acquisition_snapshot","acquisition_channel_strategy"]');
insertJob.run(runId, 'conversion_path_brief', 'Conversion Path Brief', 3, 'waiting_dependency', '["acquisition_snapshot","campaign_brief"]');
insertJob.run(runId, 'acquisition_measurement_plan', 'Acquisition Measurement Plan', 4, 'waiting_dependency', '["acquisition_channel_strategy","conversion_path_brief"]');

assert.strictEqual(eligibleRuns(db, new Date().toISOString()).length, 0,
  'a restarted run with only waiting jobs previously could not be scheduled');

const recoveries = recoverActiveRuns(db, new Date().toISOString());
assert.strictEqual(recoveries.length, 1);
assert.strictEqual(recoveries[0].unlockedCount, 1);
assert.strictEqual(db.prepare(`
  SELECT status FROM production_jobs WHERE production_run_id = ? AND deliverable_id = 'conversion_path_brief'
`).get(runId).status, 'queued');
assert.strictEqual(db.prepare(`
  SELECT status FROM production_jobs WHERE production_run_id = ? AND deliverable_id = 'acquisition_measurement_plan'
`).get(runId).status, 'waiting_dependency');
assert.strictEqual(eligibleRuns(db, new Date().toISOString())[0].id, runId,
  'dependency reconciliation makes the recovered run schedulable in the same worker cycle');

const secondRecovery = recoverActiveRuns(db, new Date().toISOString());
assert.strictEqual(secondRecovery[0].unlockedCount, 0, 'reconciliation is idempotent');

db.close();
console.log('Story 3.218 Restart-Safe Dependency Reconciliation tests passed');
