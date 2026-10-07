const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.DATABASE_URL = path.join('/tmp', `copyquick-story-3-254-${process.pid}.sqlite`);
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
const { getProductionContract } = require('../lib/productionContracts');

const objective = 'We are launching a premium organic Ceylon cinnamon supplement for adults interested in supporting healthy metabolism and everyday wellness. We plan to sell it online through our website and Amazon. We need help positioning the product and preparing the marketing for launch.';
const product = 'A premium liposomal Ceylon cinnamon dietary supplement made with true Ceylon cinnamon (Cinnamomum verum). It comes in softgels and is formulated for adults interested in supporting healthy metabolic function and everyday wellness. The finished product contains 120 softgels per package and is intended to be sold through our website and Amazon.';
const details = 'True Ceylon cinnamon / Cinnamomum verum, liposomal formulation, 120 softgels';

function confirmed(value, label = value, semanticRole) {
  return { value, label, confidence: 1, source: 'user_confirmed', ...(semanticRole ? { semanticRole } : {}) };
}

function discoveryState() {
  const understanding = {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    intendedOutcome: confirmed('metabolic_wellness', 'Metabolic health & wellness'),
    conceptMaturity: confirmed('finalized', 'Product finalized'),
    existingProductDefinition: confirmed(product, product, 'builder_provided_product_context'),
    targetAudience: confirmed('adults interested in supporting healthy metabolism and everyday wellness'),
    launchStage: confirmed('ready', 'Ready to launch'),
    salesChannel: confirmed('multiple', 'Our website and Amazon'),
    competitiveDifferentiation: confirmed('clear', 'It has clear, meaningful differences'),
    competitiveDifferentiationDetails: confirmed(details)
  };
  const answers = { initial_description: objective, competitive_differentiation: 'clear', competitive_differentiation_details: details };
  const intelligence = analyzeDiscovery({ objective: 'launch_product', understanding, answers });
  const reflection = buildBusinessReflection({ objective: 'launch_product', understanding, answers, planningReadiness: intelligence.planningReadiness });
  assert.match(JSON.stringify(reflection), /Cinnamomum verum/);
  const strategyResult = buildStrategy({ objective: 'launch_product', understanding, confirmedUnderstanding: understanding, answers });
  const buildPlan = buildPlanFor({ understanding, answers, strategyResult });
  const selection = createDefaultSelection(buildPlan);
  const approval = createApprovedProductionSet({ plan: buildPlan, selection, strategyResult, confirmedUnderstanding: understanding });
  assert.strictEqual(approval.valid, true);
  selection.approvedAt = approval.approvedAt;
  const now = new Date().toISOString();
  return {
    objective: 'launch_product', answers, understanding, confirmedUnderstanding: understanding,
    planningReadiness: intelligence.planningReadiness, planningConfirmedAt: now, strategyResult,
    strategyUpdatedAt: now, buildPlan, buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
    buildPlanFingerprint: planFingerprint(buildPlan), buildPlanSelection: selection, approvedProductionSet: approval.productionSet
  };
}

function buildPlanFor({ understanding, answers, strategyResult }) {
  return buildPlan({ objective: 'launch_product', confirmedUnderstanding: understanding, strategyResult, answers });
}

function publicText(row) {
  const output = JSON.parse(row.structured_result);
  const contract = getProductionContract(row.deliverable_id);
  return contract.publicFieldKeys.flatMap(key => Array.isArray(output[key]) ? output[key] : [output[key]]).filter(Boolean).join(' ');
}

async function run() {
  initDb();
  const db = getDb();
  const userId = Number(db.prepare("INSERT INTO users (email,name,plan_tier,monthly_limit,generations_used) VALUES (?,'Story 3.254','pro',100,0)").run(`story-3-254-${Date.now()}@example.com`).lastInsertRowid);
  const session = discoveryState();
  const initialized = initializeProduction({ db, user: db.prepare('SELECT * FROM users WHERE id=?').get(userId), discoverySession: session });
  assert.strictEqual(initialized.valid, true, initialized.reason);
  let guard = 0;
  while (guard < 100) {
    guard += 1;
    const result = await executeNextProductionJob({ db, userId, productionRunId: initialized.productionRunId });
    if (result.outcome === 'no_runnable_job') break;
    assert.strictEqual(result.outcome, 'completed', JSON.stringify(result));
  }
  const run = getProductionRun(db, userId, initialized.productionRunId);
  assert.strictEqual(run.status, 'completed');
  assert.strictEqual(run.jobs.length, 14);
  assert.strictEqual(run.jobs.filter(job => job.status === 'completed').length, 14);
  assert.strictEqual(run.jobs.filter(job => ['failed', 'skipped', 'recovery_required'].includes(job.status)).length, 0);
  assert(run.jobs.every(job => job.attempt_count === 1));
  assert.strictEqual(db.prepare('SELECT COALESCE(SUM(units),0) units FROM usage_events WHERE user_id=?').get(userId).units, 8);

  const rows = db.prepare('SELECT deliverable_id, structured_result FROM generations WHERE user_id=? ORDER BY id').all(userId);
  const byId = new Map(rows.map(row => [row.deliverable_id, row]));
  for (const id of ['amazon_listing', 'amazon_bullet_points', 'ecommerce_product_page', 'ecommerce_trust_faq', 'ecommerce_conversion_copy', 'product_image_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign']) {
    assert(byId.has(id), id);
    const text = publicText(byId.get(id));
    assert.match(text, /Ceylon cinnamon|Cinnamomum verum/i, id);
    assert.doesNotMatch(text, /confirmed features|unsupported outcomes|builder-provided|claim substantiation|evidence state/i, id);
    assert.doesNotMatch(text, /clinically proven|superior absorption|enhanced bioavailability|reduces? blood glucose|treats? diabetes|FDA approved|certified organic|third-party tested|customers love|guaranteed results/i, id);
    assert.doesNotMatch(text, new RegExp(`${product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*${details.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), id);
  }
  const ecommerce = JSON.parse(byId.get('ecommerce_product_page').structured_result);
  assert(ecommerce.content.length >= 7 && ecommerce.content.join(' ').length >= 700);
  const social = JSON.parse(byId.get('social_launch_campaign').structured_result);
  assert(social.posts.length >= 3 && new Set(social.posts).size === social.posts.length);
  const launch = JSON.parse(byId.get('launch_announcement').structured_result);
  assert(launch.subjectLine.length < 90 && !launch.subjectLine.includes(';'));
  const memoryCount = db.prepare('SELECT COUNT(*) count FROM business_memory_records WHERE user_id=?').get(userId).count;
  assert.strictEqual(memoryCount, 0, 'Production output must not teach Business Memory');
  console.log(`Story 3.254 Canonical Product Production tests passed (${run.jobs.length} jobs, 8 credits)`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
