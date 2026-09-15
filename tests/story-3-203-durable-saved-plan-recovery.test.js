const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createDefaultSelection, planFingerprint } = require('../lib/buildPlanApproval');
const { buildStrategy } = require('../lib/strategyEngine');
const {
  getSavedPlan, resumeSavedPlan, saveBuildPlan, syncSavedPlanLifecycle
} = require('../lib/savedBuildPlans');
const { pricingReturn } = require('../lib/pricingReturn');
const { objectiveUniverse } = require('../lib/businessJourneys');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function workflow() {
  const description = 'I want to launch a reusable insulated lunch container for busy parents through Shopify.';
  const understanding = {
    businessType: confirmed('physical_product', 'Physical Product'),
    targetAudience: confirmed('busy parents', 'Busy parents'),
    customerMotivation: confirmed('convenience', 'It makes something easier or faster'),
    salesChannel: confirmed('own_website', 'Shopify / my own website'),
    conceptMaturity: confirmed('idea_only', 'I only have the product idea'),
    competitiveDifferentiation: confirmed('unsure', "I'm not sure yet"),
    launchStage: confirmed('idea', 'Idea or early concept')
  };
  const answers = { initial_description: description };
  const strategyResult = buildStrategy({ objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers });
  const plan = buildPlan({ objective: 'launch_product', confirmedUnderstanding: understanding, strategyResult, answers });
  const fingerprint = planFingerprint(plan);
  return {
    objective: 'launch_product', answers, understanding, confirmedUnderstanding: understanding,
    unknowns: [], completedQuestions: [], completion: {}, knowledgeDomains: {}, remainingKnowledgeGaps: [],
    planningReadiness: { ready: true }, discoveryCompleteForNow: true, discoveryPolicyVersion: 'test',
    planningConfirmedAt: new Date().toISOString(), strategyResult, strategyUpdatedAt: new Date().toISOString(),
    buildPlan: plan, buildPlanUpdatedAt: new Date().toISOString(), buildPlanSource: 'strategy',
    buildPlanFingerprint: fingerprint, buildPlanSelection: createDefaultSelection(plan)
  };
}

function run() {
  const db = new Database(':memory:');
  runMigrationEngine(db, { logger: () => {} });
  const first = db.prepare('INSERT INTO users(email, name) VALUES (?, ?)').run('owner@example.com', 'Owner').lastInsertRowid;
  const second = db.prepare('INSERT INTO users(email, name) VALUES (?, ?)').run('other@example.com', 'Other').lastInsertRowid;
  const state = workflow();

  assert.strictEqual(getSavedPlan(db, { userId: first }), null);
  const saved = saveBuildPlan(db, { userId: first, discoverySession: state, now: new Date('2026-09-04T12:00:00Z') });
  assert.strictEqual(saved.description, state.answers.initial_description);
  assert.strictEqual(saved.status, 'saved');
  assert.strictEqual(getSavedPlan(db, { userId: second }), null, 'plans must remain private to their owner');

  state.buildPlanSelection.updatedAt = new Date('2026-09-04T13:00:00Z').toISOString();
  saveBuildPlan(db, { userId: first, discoverySession: state, now: new Date('2026-09-04T13:00:00Z') });
  assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM saved_build_plan_states WHERE user_id = ?').get(first).count, 1);
  const resumed = resumeSavedPlan(db, { userId: first });
  assert.strictEqual(resumed.valid, true);
  assert.deepStrictEqual(resumed.discoverySession.buildPlanSelection.selectedDeliverableIds, state.buildPlanSelection.selectedDeliverableIds);
  assert.strictEqual(getSavedPlan(db, { userId: first }).status, 'active');

  const lifecycle = syncSavedPlanLifecycle(db, { userId: first, planFingerprint: state.buildPlanFingerprint });
  assert.deepStrictEqual(lifecycle, { status: 'active', completedCount: 0, totalCount: state.buildPlanSelection.selectedDeliverableIds.length });

  db.prepare('UPDATE saved_build_plan_states SET workflow_state = ? WHERE user_id = ?').run('{bad json', first);
  assert.strictEqual(getSavedPlan(db, { userId: first }), null);
  assert.strictEqual(db.prepare('SELECT status FROM saved_build_plan_states WHERE user_id = ?').get(first).status, 'invalidated');

  assert.deepStrictEqual(pricingReturn('/discovery/build-plan'), { path: '/discovery/build-plan', label: 'Back to Build Plan' });
  assert.deepStrictEqual(pricingReturn('/production/review'), { path: '/production/review', label: 'Back to Production Review' });
  assert.strictEqual(pricingReturn('https://attacker.example'), null);
  assert.strictEqual(pricingReturn('//attacker.example'), null);
  assert.strictEqual(pricingReturn('/dashboard'), null);

  const welcomeTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'welcome.ejs'), 'utf8');
  const welcomeData = { error: null, objectives: objectiveUniverse, selectedGoal: '', csrfToken: 'test' };
  const withoutSavedPlan = ejs.render(welcomeTemplate, { ...welcomeData, savedPlan: null });
  assert.doesNotMatch(withoutSavedPlan, /Resume Saved Plan/);
  const withSavedPlan = ejs.render(welcomeTemplate, { ...welcomeData, savedPlan: saved });
  assert.match(withSavedPlan, /Resume Saved Plan/);
  assert.match(withSavedPlan, /action="\/saved-plan\/resume"/);

  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_saved_build_plan_states_user_status_updated'").get());
  db.close();

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-saved-plan-'));
  const databasePath = path.join(directory, 'saved-plan.db');
  let durableDb = new Database(databasePath);
  runMigrationEngine(durableDb, { logger: () => {} });
  const durableOwner = durableDb.prepare('INSERT INTO users(email, name) VALUES (?, ?)').run('restart@example.com', 'Restart').lastInsertRowid;
  saveBuildPlan(durableDb, { userId: durableOwner, discoverySession: workflow() });
  durableDb.close();
  durableDb = new Database(databasePath);
  assert.strictEqual(getSavedPlan(durableDb, { userId: durableOwner }).description, workflow().answers.initial_description);
  durableDb.close();
  fs.rmSync(directory, { recursive: true, force: true });
  console.log('Story 3.203 Durable Saved-Plan Recovery tests passed');
}

run();
