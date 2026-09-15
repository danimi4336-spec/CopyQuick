const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { getProductionHandler } = require('../lib/productionHandlers');
const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const {
  buildProductionPlanProgress,
  serializeProductionPlanProgress
} = require('../lib/productionPlanProgress');

function planItem(id) {
  const handler = getProductionHandler(id);
  const policy = getProductionArtifactPolicy(id);
  return {
    id,
    title: handler.title,
    artifactRole: policy.role,
    billingUnits: policy.billingUnits,
    readyToUse: policy.readyToUse
  };
}

function insertGeneration(db, { userId, jobId, deliverableId, output }) {
  const handler = getProductionHandler(deliverableId);
  return Number(db.prepare(`
    INSERT INTO generations (
      user_id, title, input_text, content_type, ai_model, results, generation_type,
      production_job_id, deliverable_id, contract_version, structured_result
    ) VALUES (?, ?, 'bounded test context', ?, 'CopyQuick Deterministic', '[]', 'production', ?, ?, ?, ?)
  `).run(
    userId, handler.title, handler.contentType, jobId, deliverableId,
    handler.version, JSON.stringify(output)
  ).lastInsertRowid);
}

const db = new Database(':memory:');
runMigrationEngine(db, { logger: () => {} });
const userId = Number(db.prepare("INSERT INTO users (email, name) VALUES ('progress@example.com', 'Progress Owner')").run().lastInsertRowid);
const fingerprint = 'story-3-208-progress-fingerprint';
const strategySnapshot = {
  primaryCustomer: { value: 'Busy parents', semanticRole: 'confirmed_fact' },
  customerMotivation: { value: 'Save Time and Reduce Effort', semanticRole: 'confirmed_fact' }
};

const firstRunId = Number(db.prepare(`
  INSERT INTO production_runs (user_id, objective, status, plan_fingerprint, idempotency_key, approved_at, strategy_snapshot, production_cost_units)
  VALUES (?, 'launch_product', 'partially_completed', ?, 'progress-first', '2026-09-14T10:00:00Z', ?, 0)
`).run(userId, fingerprint, JSON.stringify(strategySnapshot)).lastInsertRowid);
const profileHandler = getProductionHandler('customer_profile');
const profileJobId = Number(db.prepare(`
  INSERT INTO production_jobs (
    production_run_id, deliverable_id, title, phase, sequence_order, status,
    strategic_direction, strategy_snapshot, dependencies, contract_version
  ) VALUES (?, 'customer_profile', 'Customer Profile', 'define', 0, 'running', 'Define the customer.', ?, '[]', ?)
`).run(firstRunId, JSON.stringify(strategySnapshot), profileHandler.version).lastInsertRowid);
const profileOutput = profileHandler.generateOutput({
  objective: 'launch_product', title: 'Customer Profile', strategicDirection: 'Define the customer.',
  strategySnapshot, dependencyOutputs: []
});
const profileGenerationId = insertGeneration(db, {
  userId, jobId: profileJobId, deliverableId: 'customer_profile', output: profileOutput
});
db.prepare("UPDATE production_jobs SET status = 'completed', generation_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
  .run(profileGenerationId, profileJobId);

const secondRunId = Number(db.prepare(`
  INSERT INTO production_runs (user_id, objective, status, plan_fingerprint, idempotency_key, approved_at, strategy_snapshot, production_cost_units)
  VALUES (?, 'launch_product', 'running', ?, 'progress-second', '2026-09-14T11:00:00Z', ?, 0)
`).run(userId, fingerprint, JSON.stringify(strategySnapshot)).lastInsertRowid);
const carriedProfileJobId = Number(db.prepare(`
  INSERT INTO production_jobs (
    production_run_id, deliverable_id, title, phase, sequence_order, status,
    strategic_direction, strategy_snapshot, dependencies, contract_version, generation_id, completed_at
  ) VALUES (?, 'customer_profile', 'Customer Profile', 'define', 0, 'completed', 'Define the customer.', ?, '[]', ?, ?, CURRENT_TIMESTAMP)
`).run(secondRunId, JSON.stringify(strategySnapshot), profileHandler.version, profileGenerationId).lastInsertRowid);
assert.notStrictEqual(carriedProfileJobId, profileJobId);

const positioningHandler = getProductionHandler('product_positioning');
const positioningJobId = Number(db.prepare(`
  INSERT INTO production_jobs (
    production_run_id, deliverable_id, title, phase, sequence_order, status,
    strategic_direction, strategy_snapshot, dependencies, contract_version
  ) VALUES (?, 'product_positioning', 'Product Positioning', 'define', 1, 'queued', 'Define positioning.', ?, '["customer_profile"]', ?)
`).run(secondRunId, JSON.stringify(strategySnapshot), positioningHandler.version).lastInsertRowid);
const valueHandler = getProductionHandler('value_proposition');
const valueJobId = Number(db.prepare(`
  INSERT INTO production_jobs (
    production_run_id, deliverable_id, title, phase, sequence_order, status,
    strategic_direction, strategy_snapshot, dependencies, contract_version
  ) VALUES (?, 'value_proposition', 'Value Proposition', 'define', 2, 'waiting_dependency', 'Define value.', ?, '["customer_profile","product_positioning"]', ?)
`).run(secondRunId, JSON.stringify(strategySnapshot), valueHandler.version).lastInsertRowid);

const approvedProductionSet = {
  planFingerprint: fingerprint,
  selectedDeliverables: [
    planItem('customer_profile'),
    planItem('product_positioning'),
    planItem('value_proposition'),
    planItem('validation_plan')
  ]
};
function production() {
  return {
    id: secondRunId,
    plan_fingerprint: fingerprint,
    jobs: db.prepare('SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order').all(secondRunId)
  };
}

let progress = buildProductionPlanProgress({ db, userId, production: production(), approvedProductionSet });
assert.deepStrictEqual(serializeProductionPlanProgress(progress), {
  totalCount: 4,
  completedCount: 1,
  reusedCount: 1,
  batchNewCount: 2,
  batchIncompleteCount: 2,
  deferredCount: 1,
  remainingEstimatedCost: 0,
  planningFoundationCount: 4,
  readyToUseAssetCount: 0
});

const positioningOutput = positioningHandler.generateOutput({
  objective: 'launch_product', title: 'Product Positioning', strategicDirection: 'Define positioning.',
  strategySnapshot,
  dependencyOutputs: [{ deliverableId: 'customer_profile', title: 'Customer Profile', contractVersion: profileHandler.version, output: profileOutput }]
});
const positioningGenerationId = insertGeneration(db, {
  userId, jobId: positioningJobId, deliverableId: 'product_positioning', output: positioningOutput
});
db.prepare("UPDATE production_jobs SET status = 'completed', generation_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
  .run(positioningGenerationId, positioningJobId);
db.prepare("UPDATE production_jobs SET status = 'queued' WHERE id = ?").run(valueJobId);

progress = buildProductionPlanProgress({ db, userId, production: production(), approvedProductionSet });
assert.strictEqual(progress.batchNew.length, 2, 'completed batch work must remain historically part of the batch');
assert.strictEqual(progress.batchIncomplete.length, 1);
assert.strictEqual(progress.completed.length, 2);

const valueOutput = valueHandler.generateOutput({
  objective: 'launch_product', title: 'Value Proposition', strategicDirection: 'Define value.',
  strategySnapshot,
  dependencyOutputs: [
    { deliverableId: 'customer_profile', title: 'Customer Profile', contractVersion: profileHandler.version, output: profileOutput },
    { deliverableId: 'product_positioning', title: 'Product Positioning', contractVersion: positioningHandler.version, output: positioningOutput }
  ]
});
const valueGenerationId = insertGeneration(db, {
  userId, jobId: valueJobId, deliverableId: 'value_proposition', output: valueOutput
});
db.prepare("UPDATE production_jobs SET status = 'completed', generation_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
  .run(valueGenerationId, valueJobId);
db.prepare("UPDATE production_runs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(secondRunId);

progress = buildProductionPlanProgress({ db, userId, production: production(), approvedProductionSet });
assert.strictEqual(progress.completed.length, 3);
assert.strictEqual(progress.reused.length, 1);
assert.strictEqual(progress.batchNew.length, 2);
assert.strictEqual(progress.batchIncomplete.length, 0);
assert.strictEqual(progress.deferred.length, 1);

assert.strictEqual(buildProductionPlanProgress({
  db, userId, production: production(), approvedProductionSet: { ...approvedProductionSet, planFingerprint: 'wrong' }
}), null);
assert.strictEqual(buildProductionPlanProgress({
  db, userId: userId + 1, production: production(), approvedProductionSet
}), null, 'progress cannot be calculated through another user identity');

const studioView = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');
assert.match(studioView, /plan-progress-overall/);
assert.match(studioView, /plan-progress-current/);
assert.match(studioView, /batchNewCount/);
assert.match(studioView, /batchIncompleteCount/);
assert.match(studioView, /reusedCount/);
assert.doesNotMatch(studioView, /window\.location\.reload\(\)/);
const productionRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'production.js'), 'utf8');
assert.match(productionRoute, /serializeProductionPlanProgress\(planProgress\)/);

db.close();
console.log('Story 3.208 Truthful Cross-Batch Production Progress tests passed');
