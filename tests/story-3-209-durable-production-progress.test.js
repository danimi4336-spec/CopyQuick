const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine, MAX_SUPPORTED_SCHEMA_VERSION } = require('../db/migrations');
const {
  buildProductionPlanProgress,
  createProductionProgressSnapshot,
  resolveProductionProgressSet,
  serializeProductionPlanProgress
} = require('../lib/productionPlanProgress');

const db = new Database(':memory:');
runMigrationEngine(db, { logger: () => {} });
assert.strictEqual(MAX_SUPPORTED_SCHEMA_VERSION, 8);
assert(db.pragma('table_info(production_runs)').some(column => column.name === 'production_plan_snapshot'));

const userId = Number(db.prepare("INSERT INTO users (email, name) VALUES ('durable-progress@example.com', 'Durable Progress')").run().lastInsertRowid);
const fingerprint = 'durable-progress-209';
const persistedSet = {
  planFingerprint: fingerprint,
  displayName: null,
  selectedDeliverables: [
    { id: 'customer_profile', title: 'Customer Profile', artifactRole: 'planning_foundation', billingUnits: 0 },
    { id: 'product_positioning', title: 'Product Positioning', artifactRole: 'planning_foundation', billingUnits: 0 }
  ]
};
assert.deepStrictEqual(createProductionProgressSnapshot({
  ...persistedSet,
  approvedAt: 'internal-approval-time',
  strategySnapshot: { internal: 'must not be duplicated into progress state' }
}), {
  planFingerprint: fingerprint,
  displayName: null,
  selectedDeliverables: persistedSet.selectedDeliverables.map(item => ({
    id: item.id,
    title: item.title,
    artifactRole: item.artifactRole,
    billingUnits: item.billingUnits,
    readyToUse: false
  }))
}, 'the durable snapshot must contain only progress-safe fields');
const runId = Number(db.prepare(`
  INSERT INTO production_runs (
    user_id, objective, status, plan_fingerprint, idempotency_key, approved_at,
    strategy_snapshot, production_cost_units, production_plan_snapshot
  ) VALUES (?, 'launch_product', 'running', ?, 'durable-progress-run', CURRENT_TIMESTAMP, '{}', 0, ?)
`).run(userId, fingerprint, JSON.stringify(persistedSet)).lastInsertRowid);
db.prepare(`
  INSERT INTO production_jobs (
    production_run_id, deliverable_id, title, phase, sequence_order, status,
    strategic_direction, strategy_snapshot, dependencies
  ) VALUES (?, 'customer_profile', 'Customer Profile', 'define', 0, 'queued', 'Define the customer.', '{}', '[]')
`).run(runId);

function production() {
  return {
    id: runId,
    objective: 'launch_product',
    plan_fingerprint: fingerprint,
    jobs: db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ?').all(runId)
  };
}

const recovered = resolveProductionProgressSet({ db, userId, production: production() });
assert.deepStrictEqual(recovered, persistedSet, 'the run must recover its plan without session state');
let progress = buildProductionPlanProgress({ db, userId, production: production() });
assert.deepStrictEqual(serializeProductionPlanProgress(progress), {
  totalCount: 2,
  completedCount: 0,
  reusedCount: 0,
  batchNewCount: 1,
  batchIncompleteCount: 1,
  deferredCount: 1,
  remainingEstimatedCost: 0,
  planningFoundationCount: 2,
  readyToUseAssetCount: 0
});

const staleSessionSet = { planFingerprint: 'another-plan', selectedDeliverables: [{ id: 'value_proposition' }] };
assert.deepStrictEqual(resolveProductionProgressSet({
  db, userId, production: production(), approvedProductionSet: staleSessionSet
}), persistedSet, 'stale session state must not override the run snapshot');
assert.strictEqual(resolveProductionProgressSet({
  db, userId: userId + 1, production: production()
}), null, 'another user cannot recover the run snapshot');

db.prepare("UPDATE production_runs SET production_plan_snapshot = '{invalid json' WHERE id = ?").run(runId);
assert.strictEqual(resolveProductionProgressSet({ db, userId, production: production() }), null,
  'corrupt persisted state must fail closed when no exact legacy plan exists');

const migrationSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'db', 'migrations.js'), 'utf8');
assert.match(migrationSource, /production_plan_progress_snapshot/);
const initializationSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'productionInitialization.js'), 'utf8');
assert.match(initializationSource, /createProductionProgressSnapshot\(approved,/);

db.close();
console.log('Story 3.209 Durable Production Progress Recovery tests passed');
