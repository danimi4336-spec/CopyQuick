const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { getLatestProductionResume } = require('../lib/productionResume');

const db = new Database(':memory:');
runMigrationEngine(db, { logger: () => {} });
const ownerId = Number(db.prepare("INSERT INTO users(email, name) VALUES ('resume-owner@example.com', 'Owner')").run().lastInsertRowid);
const otherId = Number(db.prepare("INSERT INTO users(email, name) VALUES ('resume-other@example.com', 'Other')").run().lastInsertRowid);
const fingerprint = 'resume-plan-31000001';
const snapshot = {
  planFingerprint: fingerprint,
  selectedDeliverables: [
    { id: 'customer_profile', title: 'Customer Profile', artifactRole: 'planning_foundation', billingUnits: 0, readyToUse: false },
    { id: 'product_positioning', title: 'Product Positioning', artifactRole: 'planning_foundation', billingUnits: 0, readyToUse: false }
  ]
};

function insertRun({ userId, status, key, createdAt, planSnapshot = snapshot }) {
  return Number(db.prepare(`
    INSERT INTO production_runs (
      user_id, objective, status, plan_fingerprint, idempotency_key, approved_at,
      strategy_snapshot, production_cost_units, production_plan_snapshot, created_at
    ) VALUES (?, 'launch_product', ?, ?, ?, CURRENT_TIMESTAMP, '{}', 0, ?, ?)
  `).run(userId, status, fingerprint, key, planSnapshot ? JSON.stringify(planSnapshot) : null, createdAt).lastInsertRowid);
}

function insertJob(runId, id, status, sequence) {
  db.prepare(`
    INSERT INTO production_jobs (
      production_run_id, deliverable_id, title, phase, sequence_order, status,
      strategic_direction, strategy_snapshot, dependencies
    ) VALUES (?, ?, ?, 'define', ?, ?, 'Test direction', '{}', '[]')
  `).run(runId, id, id.replace(/_/g, ' '), sequence, status);
}

const activeRunId = insertRun({ userId: ownerId, status: 'running', key: 'owner-active', createdAt: '2026-09-14T10:00:00Z' });
insertJob(activeRunId, 'customer_profile', 'queued', 0);
const newerCompletedId = insertRun({ userId: ownerId, status: 'completed', key: 'owner-completed', createdAt: '2026-09-14T11:00:00Z' });
insertJob(newerCompletedId, 'customer_profile', 'completed', 0);
const otherRunId = insertRun({ userId: otherId, status: 'running', key: 'other-active', createdAt: '2026-09-14T12:00:00Z' });
insertJob(otherRunId, 'customer_profile', 'queued', 0);

const ownerResume = getLatestProductionResume(db, ownerId);
assert.strictEqual(ownerResume.id, activeRunId, 'an active run takes priority over a newer terminal run');
assert.strictEqual(ownerResume.href, `/production/${activeRunId}`);
assert.strictEqual(ownerResume.actionLabel, 'Resume Production');
assert.strictEqual(ownerResume.progress.totalCount, 2);
assert.strictEqual(ownerResume.progress.batchIncompleteCount, 1);
assert.strictEqual(getLatestProductionResume(db, otherId).id, otherRunId, 'runs remain scoped to their owner');
assert.strictEqual(getLatestProductionResume(db, 999999), null);

db.prepare("UPDATE production_runs SET status = 'completed' WHERE id = ?").run(activeRunId);
const completedResume = getLatestProductionResume(db, ownerId);
assert.strictEqual(completedResume.id, newerCompletedId);
assert.strictEqual(completedResume.actionLabel, 'View Deliverables');

db.prepare("UPDATE production_runs SET production_plan_snapshot = '{invalid json' WHERE id = ?").run(newerCompletedId);
const degraded = getLatestProductionResume(db, ownerId);
assert.strictEqual(degraded.progress, null);
assert.strictEqual(degraded.batchTotalCount, 1, 'corrupt progress metadata degrades to truthful batch progress');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
assert.match(routeSource, /latestProduction: getLatestProductionResume\(db, userId\)/);
const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.ejs'), 'utf8');
assert.match(viewSource, /Your Production Plan/);
assert.match(viewSource, /latestProduction\.href/);
assert.doesNotMatch(viewSource, /action="\/production/);

db.close();
console.log('Story 3.210 Durable Production Resume Navigation tests passed');
