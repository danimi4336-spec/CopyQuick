const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createApprovedProductionSet, createDefaultSelection, planFingerprint } = require('../lib/buildPlanApproval');
const { initializeProduction } = require('../lib/productionInitialization');
const { executeNextProductionJob } = require('../lib/productionExecution');
const { completedDeliverablesForPlan } = require('../lib/productionBatchPlanning');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function discoveryState() {
  const understanding = {
    businessType: confirmed('physical_product', 'Physical Product'),
    targetAudience: confirmed('busy parents', 'Busy parents'),
    customerMotivation: confirmed('convenience', 'It makes something easier or faster'),
    salesChannel: confirmed('own_website', 'Shopify / my own website'),
    conceptMaturity: confirmed('idea_only', 'I only have the product idea'),
    competitiveDifferentiation: confirmed('unsure', "I'm not sure yet"),
    launchStage: confirmed('idea', 'Idea or early concept')
  };
  const answers = { initial_description: 'I want to launch a reusable insulated lunch container for busy parents through Shopify.' };
  const strategyResult = buildStrategy({ objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers });
  const plan = buildPlan({ objective: 'launch_product', confirmedUnderstanding: understanding, strategyResult, answers });
  const selection = createDefaultSelection(plan);
  const approval = createApprovedProductionSet({ plan, selection, strategyResult });
  selection.approvedAt = approval.approvedAt;
  const now = new Date().toISOString();
  return {
    objective: 'launch_product', answers, understanding, confirmedUnderstanding: understanding,
    planningReadiness: { ready: true }, discoveryCompleteForNow: true,
    planningConfirmedAt: now, strategyResult, strategyUpdatedAt: now,
    buildPlan: plan, buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
    buildPlanFingerprint: planFingerprint(plan), buildPlanSelection: selection,
    approvedProductionSet: approval.productionSet
  };
}

function adapter({ failPositioning = false, calls = [] } = {}) {
  return {
    generateCopy(input) {
      const isPositioning = /planning foundation titled Product Positioning/i.test(input.productDescription);
      calls.push(isPositioning ? 'product_positioning' : input.productDescription.match(/titled ([^.\n]+)/i)?.[1] || 'other');
      if (failPositioning && isPositioning) {
        const error = new Error('Synthetic positioning failure');
        error.code = 'SYNTHETIC_POSITIONING_FAILURE';
        throw error;
      }
      return [{ text: 'Compatibility adapter output; the production contract supplies the deterministic structured result.', tone: 'professional' }];
    }
  };
}

async function drain(db, userId, productionRunId, generatorApi, limit = 80) {
  const results = [];
  let cycle = 0;
  while (limit > 0) {
    const result = await executeNextProductionJob({
      db, userId, productionRunId, generatorApi,
      now: new Date(Date.now() + cycle * 60 * 1000),
      retryDelayBaseSeconds: 1
    });
    results.push(result);
    if (['completed', 'failed', 'partially_completed'].includes(result.runStatus)) break;
    cycle += 1;
    limit -= 1;
  }
  assert(limit > 0, 'production recovery must not loop indefinitely');
  return results;
}

async function run() {
  const db = new Database(':memory:');
  runMigrationEngine(db, { logger: () => {} });
  const userId = Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES ('recovery-owner@example.com', 'Recovery Owner', 'pro', 100, 0)
  `).run().lastInsertRowid);
  const otherUserId = Number(db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES ('other-owner@example.com', 'Other Owner', 'pro', 100, 0)
  `).run().lastInsertRowid);
  const state = discoveryState();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  const firstStart = initializeProduction({ db, user, discoverySession: state });
  assert.strictEqual(firstStart.valid, true);
  const setupGenerator = adapter();
  for (let completed = 0; completed < 3; completed += 1) {
    assert.strictEqual((await executeNextProductionJob({
      db, userId, productionRunId: firstStart.productionRunId, generatorApi: setupGenerator
    })).outcome, 'completed');
  }
  db.prepare(`
    UPDATE production_jobs
    SET status = 'failed', attempt_count = max_attempts, last_error_code = 'SYNTHETIC_POSITIONING_FAILURE',
        error_message = 'Synthetic terminal failure', failed_at = CURRENT_TIMESTAMP
    WHERE production_run_id = ? AND deliverable_id = 'product_positioning'
  `).run(firstStart.productionRunId);
  db.prepare(`
    UPDATE production_jobs
    SET status = 'skipped', last_error_code = 'PREREQUISITE_FAILED', failed_at = CURRENT_TIMESTAMP
    WHERE production_run_id = ? AND status != 'completed' AND deliverable_id != 'product_positioning'
  `).run(firstStart.productionRunId);
  db.prepare(`
    UPDATE production_runs SET status = 'partially_completed', failed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(firstStart.productionRunId);
  const firstRun = db.prepare('SELECT status FROM production_runs WHERE id = ?').get(firstStart.productionRunId);
  assert(['failed', 'partially_completed'].includes(firstRun.status));
  const failedPositioning = db.prepare(`
    SELECT * FROM production_jobs WHERE production_run_id = ? AND deliverable_id = 'product_positioning'
  `).get(firstStart.productionRunId);
  assert.strictEqual(failedPositioning.status, 'failed');
  assert.strictEqual(failedPositioning.attempt_count, 3);
  assert.strictEqual(db.prepare(`
    SELECT status FROM production_jobs WHERE production_run_id = ? AND deliverable_id = 'value_proposition'
  `).get(firstStart.productionRunId).status, 'skipped');

  const originalProfile = db.prepare(`
    SELECT generation_id FROM production_jobs
    WHERE production_run_id = ? AND deliverable_id = 'customer_profile'
  `).get(firstStart.productionRunId);
  assert(originalProfile.generation_id);

  const secondApproval = createApprovedProductionSet({
    plan: state.buildPlan, selection: state.buildPlanSelection, strategyResult: state.strategyResult
  });
  secondApproval.approvedAt = new Date(Date.now() + 1000).toISOString();
  secondApproval.productionSet.approvedAt = secondApproval.approvedAt;
  state.buildPlanSelection.approvedAt = secondApproval.approvedAt;
  state.approvedProductionSet = secondApproval.productionSet;

  const secondStart = initializeProduction({ db, user, discoverySession: state });
  assert.strictEqual(secondStart.valid, true);
  assert.notStrictEqual(secondStart.productionRunId, firstStart.productionRunId);
  const secondJobs = db.prepare(`
    SELECT * FROM production_jobs WHERE production_run_id = ? ORDER BY sequence_order
  `).all(secondStart.productionRunId);
  const carriedProfile = secondJobs.find(job => job.deliverable_id === 'customer_profile');
  const replacementPositioning = secondJobs.find(job => job.deliverable_id === 'product_positioning');
  assert.strictEqual(carriedProfile.status, 'completed');
  assert.strictEqual(carriedProfile.generation_id, originalProfile.generation_id);
  assert.strictEqual(replacementPositioning.status, 'queued', 'a replacement job whose carried prerequisites are complete must be immediately runnable');

  const successCalls = [];
  const recoveryResults = await drain(db, userId, secondStart.productionRunId, adapter({ calls: successCalls }));
  assert(recoveryResults.some(result => result.jobId === replacementPositioning.id && result.outcome === 'completed'));
  assert.strictEqual(successCalls.includes('Customer Profile'), false, 'completed prerequisites must not be generated again');
  assert.strictEqual(db.prepare('SELECT status FROM production_runs WHERE id = ?').get(secondStart.productionRunId).status, 'completed');
  assert(db.prepare(`
    SELECT status FROM production_jobs WHERE production_run_id = ? AND deliverable_id = 'value_proposition'
  `).get(secondStart.productionRunId).status === 'completed');
  assert(db.prepare(`
    SELECT status FROM production_jobs WHERE production_run_id = ? AND deliverable_id = 'validation_plan'
  `).get(secondStart.productionRunId).status === 'completed');

  const fingerprint = state.buildPlanFingerprint;
  const reusable = completedDeliverablesForPlan(db, userId, fingerprint);
  assert(reusable.some(item => item.id === 'customer_profile'));
  assert.deepStrictEqual(completedDeliverablesForPlan(db, otherUserId, fingerprint), [], 'another user cannot reuse the owner’s generations');
  assert.deepStrictEqual(completedDeliverablesForPlan(db, userId, 'different-plan'), [], 'another plan cannot reuse these generations');

  const profileGeneration = db.prepare('SELECT * FROM generations WHERE id = ?').get(originalProfile.generation_id);
  db.prepare('UPDATE generations SET is_deleted = 1 WHERE id = ?').run(profileGeneration.id);
  assert(!completedDeliverablesForPlan(db, userId, fingerprint).some(item => item.id === 'customer_profile'));
  db.prepare('UPDATE generations SET is_deleted = 0, contract_version = ? WHERE id = ?').run('customer_profile:v999', profileGeneration.id);
  assert(!completedDeliverablesForPlan(db, userId, fingerprint).some(item => item.id === 'customer_profile'));
  db.prepare('UPDATE generations SET contract_version = ?, structured_result = ? WHERE id = ?')
    .run(profileGeneration.contract_version, '{invalid json', profileGeneration.id);
  assert(!completedDeliverablesForPlan(db, userId, fingerprint).some(item => item.id === 'customer_profile'));
  db.prepare('UPDATE generations SET structured_result = ?, user_id = ? WHERE id = ?')
    .run(profileGeneration.structured_result, otherUserId, profileGeneration.id);
  assert(!completedDeliverablesForPlan(db, userId, fingerprint).some(item => item.id === 'customer_profile'));

  db.close();
  console.log('Story 3.207 Failed Production Recovery tests passed');
}

run().catch(function(error) {
  console.error(error);
  process.exitCode = 1;
});
