const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.DATABASE_URL = path.join('/tmp', `copyquick-story-3-253-${process.pid}.sqlite`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DATABASE_URL + suffix); } catch (_) { /* disposable database absent */ }
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { buildBusinessReflection } = require('../lib/businessReflection');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createApprovedProductionSet, createDefaultSelection, planFingerprint } = require('../lib/buildPlanApproval');
const { initializeProduction, getProductionRun } = require('../lib/productionInitialization');
const { executeNextProductionJob } = require('../lib/productionExecution');
const { generateDeliverable } = require('../lib/generationService');

function confirmed(value, label = value, semanticRole) {
  return { value, label, confidence: 1, source: 'user_confirmed', ...(semanticRole ? { semanticRole } : {}) };
}

const description = 'We are launching a premium organic Ceylon cinnamon supplement for adults interested in supporting healthy metabolism and everyday wellness. We plan to sell it online through our website and Amazon. We need help positioning the product and preparing the marketing for launch.';
const details = 'True Ceylon cinnamon (Cinnamomum verum), liposomal formulation, and 120 softgels';

function state() {
  const understanding = {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    intendedOutcome: confirmed('metabolic_wellness', 'Metabolic health & wellness'),
    conceptMaturity: confirmed('finalized', 'Product already finalized'),
    existingProductDefinition: confirmed('Premium Ceylon cinnamon supplement', 'Premium Ceylon cinnamon supplement', 'builder_provided_product_context'),
    targetAudience: confirmed('adults interested in supporting healthy metabolism and everyday wellness'),
    launchStage: confirmed('ready', 'Ready to launch'),
    salesChannel: confirmed('multiple', 'Our website and Amazon'),
    competitiveDifferentiation: confirmed('clear', 'It has clear, meaningful differences'),
    competitiveDifferentiationDetails: confirmed(details)
  };
  const answers = {
    initial_description: description,
    competitive_differentiation: 'clear',
    competitive_differentiation_details: details
  };
  const intelligence = analyzeDiscovery({ objective: 'launch_product', understanding, answers });
  const reflection = buildBusinessReflection({ objective: 'launch_product', answers, understanding, planningReadiness: intelligence.planningReadiness });
  assert.match(JSON.stringify(reflection), /Cinnamomum verum/);
  const strategyResult = buildStrategy({ objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers });
  const plan = buildPlan({ objective: 'launch_product', confirmedUnderstanding: understanding, strategyResult, answers });
  const selection = createDefaultSelection(plan);
  const approval = createApprovedProductionSet({ plan, selection, strategyResult, confirmedUnderstanding: understanding });
  assert.strictEqual(approval.valid, true);
  selection.approvedAt = approval.approvedAt;
  const now = new Date().toISOString();
  return {
    objective: 'launch_product', answers, understanding, confirmedUnderstanding: understanding,
    planningReadiness: intelligence.planningReadiness, planningConfirmedAt: now,
    strategyResult, strategyUpdatedAt: now, buildPlan: plan,
    buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
    buildPlanFingerprint: planFingerprint(plan), buildPlanSelection: selection,
    approvedProductionSet: approval.productionSet
  };
}

async function run() {
  initDb();
  const db = getDb();
  const userId = Number(db.prepare("INSERT INTO users (email,name,plan_tier,monthly_limit,generations_used) VALUES (?,'Story 3.253','pro',100,0)").run(`story-3-253-${Date.now()}@example.com`).lastInsertRowid);
  const discoverySession = state();
  const initialized = initializeProduction({ db, user: db.prepare('SELECT * FROM users WHERE id=?').get(userId), discoverySession });
  assert.strictEqual(initialized.valid, true, initialized.reason);
  let guard = 0;
  while (guard < 100) {
    guard += 1;
    const result = await executeNextProductionJob({ db, userId, productionRunId: initialized.productionRunId });
    if (result.outcome === 'no_runnable_job') break;
    assert.strictEqual(result.outcome, 'completed', JSON.stringify(result));
  }
  assert(guard < 100, 'production loop must remain bounded');
  const production = getProductionRun(db, userId, initialized.productionRunId);
  const failed = production.jobs.filter(job => job.status !== 'completed');
  assert.deepStrictEqual(failed.map(job => [job.deliverable_id, job.status, job.last_error_code]), []);
  for (const id of ['product_image_guidance', 'ecommerce_product_page', 'ecommerce_trust_faq', 'ecommerce_conversion_copy', 'amazon_listing', 'amazon_bullet_points', 'amazon_keyword_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign']) {
    assert.strictEqual(production.jobs.find(job => job.deliverable_id === id)?.status, 'completed', id);
  }
  const publicResults = db.prepare('SELECT structured_result FROM generations WHERE user_id=? AND production_job_id IS NOT NULL').all(userId).map(row => row.structured_result).join('\n');
  assert.match(publicResults, /Ceylon cinnamon|Cinnamomum verum/);
  assert.doesNotMatch(publicResults, /clinically proven|superior absorption|FDA approved|certified organic|guaranteed results/i);
  assert.strictEqual(db.prepare('SELECT COALESCE(SUM(units),0) AS units FROM usage_events WHERE user_id=?').get(userId).units, 8);

  const unsafeHandler = {
    id: 'synthetic_builder_fact_quality_failure', version: 'synthetic:v1', contentType: 'product_description', readyToUse: true,
    requiredContext: [], requiredDependencies: [], publicFieldKeys: ['content'], internalFieldKeys: [], outputSchema: { content: 'array' },
    acceptsVersion: () => true,
    buildPrompt: () => 'synthetic',
    generateOutput: () => ({ content: ['Clinically proven guaranteed results for every customer.'] }),
    normalizeOutput: results => results[0].structuredOutput,
    validateOutput: output => Array.isArray(output?.content),
    presentOutput: output => [{ text: output.content.join('\n'), tone: 'professional' }]
  };
  await assert.rejects(() => generateDeliverable({
    job: { title: 'Synthetic', deliverable_id: unsafeHandler.id, contract_version: unsafeHandler.version, strategic_direction: '', strategySnapshot: {} },
    productionRun: { objective: 'launch_product', user_id: userId, strategySnapshot: {} },
    handler: unsafeHandler
  }), error => error.code === 'PRODUCTION_QUALITY_UNSUPPORTED_CLAIM' && error.permanent === true);

  console.log(`Story 3.253 Production Acceptance tests passed (${production.jobs.length} jobs)`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
