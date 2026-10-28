const assert = require('assert');
const { assertIsolatedTestDatabase } = require('./helpers/isolatedTestDatabase');

assertIsolatedTestDatabase();
process.env.AI_DISCOVERY_ENABLED = 'false';
process.env.AI_STRATEGY_ENABLED = 'false';
process.env.AI_PRODUCTION_ENABLED = 'false';
process.env.RESEARCH_ENABLED = 'false';

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const {
  createApprovedProductionSet,
  createDefaultSelection,
  planFingerprint,
  updateSelection,
  validateSelection
} = require('../lib/buildPlanApproval');
const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const { activeMemory } = require('../lib/businessMemory');
const { objectiveAcceptanceFixtures } = require('../lib/objectiveAcceptanceFixtures');
const { objectiveUniverse } = require('../lib/objectiveFramework');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { executeNextProductionJob } = require('../lib/productionExecution');
const { getProductionRun, initializeProduction } = require('../lib/productionInitialization');
const {
  getSavedPlanReadOnly,
  resumeSavedPlan,
  saveBuildPlan,
  validateWorkflowState
} = require('../lib/savedBuildPlans');

function createOwner(db, objective, index) {
  const id = Number(db.prepare(`
    INSERT INTO users (email, name, builder_goal, plan_tier, monthly_limit, generations_used)
    VALUES (?, ?, ?, 'pro', 100, 0)
  `).run(`story-3-264-${index}@example.com`, `Objective Owner ${index}`, objective).lastInsertRowid);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function buildWorkflow(objective, fixture) {
  const runtime = createObjectiveRuntime(objective);
  const discovery = runtime.discovery.analyze({
    understanding: fixture.understanding,
    unknowns: [],
    answers: fixture.answers
  });
  assert.strictEqual(discovery.planningReadiness.ready, true, `${objective} Discovery must be ready`);
  const strategyResult = runtime.strategy.build({
    understanding: fixture.understanding,
    confirmedUnderstanding: fixture.understanding,
    answers: fixture.answers
  });
  const buildPlan = runtime.buildPlan({
    confirmedUnderstanding: fixture.understanding,
    strategyResult,
    answers: fixture.answers
  });
  assert.strictEqual(buildPlan.readiness.ready, true, `${objective} Build Plan must be ready`);
  let buildPlanSelection = createDefaultSelection(buildPlan);
  if (!validateSelection(buildPlan, buildPlanSelection).valid && buildPlan.summary.requiresReadyAsset) {
    const firstReadyAsset = buildPlan.phases.flatMap(phase => phase.deliverables)
      .find(item => getProductionArtifactPolicy(item.id)?.readyToUse);
    assert(firstReadyAsset, `${objective} must offer a ready-to-use asset`);
    const updated = updateSelection({
      plan: buildPlan,
      currentSelection: buildPlanSelection,
      requestedDeliverableIds: buildPlanSelection.selectedDeliverableIds.concat(firstReadyAsset.id)
    });
    assert.strictEqual(updated.valid, true, `${objective} ready-asset selection must be valid`);
    buildPlanSelection = updated.selection;
  }
  assert.strictEqual(validateSelection(buildPlan, buildPlanSelection).valid, true,
    `${objective} default customer selection must be valid`);
  const now = new Date(Date.UTC(2026, 9, 27, 12, 0, 0)).toISOString();
  return {
    ...discovery,
    objective,
    answers: fixture.answers,
    understanding: fixture.understanding,
    confirmedUnderstanding: fixture.understanding,
    planningConfirmedAt: now,
    strategyResult,
    strategyUpdatedAt: now,
    buildPlan,
    buildPlanUpdatedAt: now,
    buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
    buildPlanFingerprint: planFingerprint(buildPlan),
    buildPlanSelection,
    startedAt: now,
    updatedAt: now
  };
}

function snapshot(db, userId) {
  return {
    savedPlans: db.prepare('SELECT COUNT(*) count FROM saved_build_plan_states WHERE user_id = ?').get(userId).count,
    runs: db.prepare('SELECT COUNT(*) count FROM production_runs WHERE user_id = ?').get(userId).count,
    jobs: db.prepare(`SELECT COUNT(*) count FROM production_jobs
      WHERE production_run_id IN (SELECT id FROM production_runs WHERE user_id = ?)`).get(userId).count,
    generations: db.prepare('SELECT COUNT(*) count FROM generations WHERE user_id = ?').get(userId).count,
    generationRequests: db.prepare('SELECT COUNT(*) count FROM generation_requests WHERE user_id = ?').get(userId).count,
    usageEvents: db.prepare('SELECT COUNT(*) count FROM usage_events WHERE user_id = ?').get(userId).count,
    usageUnits: db.prepare('SELECT COALESCE(SUM(units), 0) value FROM usage_events WHERE user_id = ?').get(userId).value,
    memorySubjects: db.prepare('SELECT COUNT(*) count FROM business_memory_subjects WHERE user_id = ?').get(userId).count,
    memoryRecords: activeMemory(db, { userId, includePending: true }).length
  };
}

function deterministicProvider(calls) {
  return {
    provider: 'story-3-264-deterministic',
    model: 'fixture-v1',
    generateCopy(input) {
      calls.push(input);
      return [{ text: 'Deterministic compatibility output; the registered contract supplies the structured result.', tone: 'professional' }];
    }
  };
}

async function drainProduction(db, userId, productionRunId, generatorApi) {
  for (let remaining = 100; remaining > 0; remaining -= 1) {
    const result = await executeNextProductionJob({ db, userId, productionRunId, generatorApi });
    if (result.outcome === 'no_runnable_job') return result.runStatus;
    assert.strictEqual(result.outcome, 'completed', `Production job failed with ${result.outcome}`);
    if (result.runStatus === 'completed') return result.runStatus;
  }
  assert.fail('Production did not complete within the bounded job limit.');
}

(async function run() {
  initDb();
  const db = getDb();
  const fixtures = objectiveAcceptanceFixtures();
  const objectives = objectiveUniverse.filter(item => item.available).map(item => item.id);
  assert.deepStrictEqual(Object.keys(fixtures), objectives);

  for (const [index, objective] of objectives.entries()) {
    const owner = createOwner(db, objective, index + 1);
    const outsider = createOwner(db, `${objective}-outsider`, index + 101);
    const workflow = buildWorkflow(objective, fixtures[objective]);
    const before = snapshot(db, owner.id);

    assert.strictEqual(validateWorkflowState(workflow, workflow.buildPlanFingerprint), true,
      `${objective} must have a canonical saved-plan shape`);
    const saved = saveBuildPlan(db, { userId: owner.id, discoverySession: workflow, now: new Date(workflow.updatedAt) });
    assert(saved, `${objective} must save`);
    assert.strictEqual(saved.objective, objective);
    assert.strictEqual(getSavedPlanReadOnly(db, { userId: owner.id, objective }).status, 'valid');
    assert.strictEqual(getSavedPlanReadOnly(db, { userId: outsider.id, objective }).status, 'missing');
    const resumed = resumeSavedPlan(db, { userId: owner.id, objective });
    assert.strictEqual(resumed.valid, true, `${objective} must resume`);
    assert.deepStrictEqual(resumed.discoverySession.buildPlanSelection.selectedDeliverableIds,
      workflow.buildPlanSelection.selectedDeliverableIds);

    const approval = createApprovedProductionSet({
      plan: workflow.buildPlan,
      selection: workflow.buildPlanSelection,
      strategyResult: workflow.strategyResult,
      confirmedUnderstanding: workflow.confirmedUnderstanding
    });
    assert.strictEqual(approval.valid, true, `${objective} approval must be valid`);
    workflow.buildPlanSelection.approvedAt = approval.approvedAt;
    workflow.approvedProductionSet = approval.productionSet;
    const expectedUnits = approval.productionSet.selectedDeliverables.reduce((sum, item) => sum + Number(item.billingUnits || 0), 0);

    if (expectedUnits === 0) {
      const afterPlanning = snapshot(db, owner.id);
      assert.deepStrictEqual(afterPlanning, {
        ...before,
        savedPlans: 1
      }, `${objective} planning-only save must not create Production or usage side effects`);
      continue;
    }

    const initialized = initializeProduction({ db, user: owner, discoverySession: workflow });
    assert.strictEqual(initialized.valid, true, `${objective} Production must initialize`);
    const duplicate = initializeProduction({ db, user: db.prepare('SELECT * FROM users WHERE id = ?').get(owner.id), discoverySession: workflow });
    assert.strictEqual(duplicate.valid, true);
    assert.strictEqual(duplicate.duplicate, true, `${objective} Production start must be idempotent`);
    assert.strictEqual(duplicate.productionRunId, initialized.productionRunId);
    assert.strictEqual(getProductionRun(db, outsider.id, initialized.productionRunId), null,
      `${objective} Production must remain owner-scoped`);

    const providerCalls = [];
    const status = await drainProduction(db, owner.id, initialized.productionRunId, deterministicProvider(providerCalls));
    assert.strictEqual(status, 'completed', `${objective} Production must complete`);
    const production = getProductionRun(db, owner.id, initialized.productionRunId);
    assert(production);
    assert(production.jobs.length > 0);
    assert(production.jobs.every(job => job.status === 'completed'));
    assert(providerCalls.length > 0 && providerCalls.length <= production.jobs.length,
      `${objective} must use only the injected deterministic provider where a provider call is required`);

    const generations = db.prepare(`
      SELECT generations.* FROM generations
      JOIN production_jobs ON production_jobs.id = generations.production_job_id
      WHERE generations.user_id = ? AND production_jobs.production_run_id = ?
      ORDER BY generations.id
    `).all(owner.id, initialized.productionRunId);
    assert.strictEqual(generations.length, production.jobs.length);
    for (const generation of generations) {
      const contract = createObjectiveRuntime(objective).production.contract(generation.deliverable_id);
      const output = JSON.parse(generation.structured_result);
      assert.strictEqual(contract.validateOutput(output), true, `${objective}:${generation.deliverable_id} must validate`);
      const sections = contract.presentationSections(output);
      assert(sections.length > 0, `${objective}:${generation.deliverable_id} must render public sections`);
      assert.doesNotMatch(JSON.stringify(sections), /system prompt|dependencyOutputs|confirmed_fact|internal id/i);
    }

    const after = snapshot(db, owner.id);
    assert.strictEqual(after.savedPlans, 1);
    assert.strictEqual(after.runs, 1);
    assert.strictEqual(after.jobs, production.jobs.length);
    assert.strictEqual(after.generations, production.jobs.length);
    assert.strictEqual(after.generationRequests, 0);
    assert.strictEqual(after.usageEvents, 1);
    assert.strictEqual(after.usageUnits, expectedUnits);
    assert.strictEqual(after.memorySubjects, 0);
    assert.strictEqual(after.memoryRecords, 0);
  }

  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM generation_requests').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM business_memory_records').get().count, 0);
  console.log('Story 3.264 seven-objective end-to-end acceptance passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
