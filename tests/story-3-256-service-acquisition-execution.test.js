const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.DATABASE_URL = path.join('/tmp', `copyquick-story-3-256-${process.pid}.sqlite`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DATABASE_URL + suffix); } catch (_) { /* disposable database absent */ }
}
const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const {
  buildApprovalView, createApprovedProductionSet, createDefaultSelection,
  createProductionStrategySnapshot, updateSelection, validateSelection
} = require('../lib/buildPlanApproval');
const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const { getProductionContract } = require('../lib/productionContracts');
const { minimumProductionDependencies } = require('../lib/productionDependencyPolicy');
const { calculateProductionCost } = require('../lib/productionCost');
const { generateDeliverable } = require('../lib/generationService');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { getProductionRun, initializeProduction, validateApprovedProductionSession } = require('../lib/productionInitialization');
const { executeNextProductionJob } = require('../lib/productionExecution');

const objective = 'get_more_customers';
const description = 'We are a residential remodeling company serving homeowners who want to improve or renovate their homes. We specialize in kitchen and bathroom remodeling, interior renovations, and other home improvement projects. Most of our customers currently find us through referrals, but we want to attract more qualified local homeowners and turn more inquiries into booked consultations.';
const confirmed = (value, label = value) => ({ value, label, confidence: 1, source: 'user_confirmed' });

function fixture(overrides = {}) {
  const understanding = {
    businessType: confirmed('service', 'Service Business'),
    industry: confirmed('home_services', 'Home Services'),
    category: confirmed('residential_remodeling', 'Residential Remodeling'),
    acquisitionGoal: confirmed('appointments', 'More booked appointments'),
    targetAudience: confirmed('homeowners who want to improve or renovate their homes', 'Homeowners who want to improve or renovate their homes'),
    currentAcquisitionChannel: confirmed('referrals', 'Referrals'),
    acquisitionStage: confirmed('inconsistent_traction', 'Some traction, but inconsistent'),
    salesProcess: confirmed('booked_call', 'They book a call or appointment'),
    capacityReadiness: confirmed('capacity_ready', 'Yes, we are ready for more customers'),
    ...overrides
  };
  const answers = {
    initial_description: description,
    business_type: understanding.businessType.value,
    acquisition_goal: understanding.acquisitionGoal.value,
    acquisition_target: { value: understanding.targetAudience.value },
    acquisition_channel: understanding.currentAcquisitionChannel.value,
    acquisition_stage: understanding.acquisitionStage.value,
    sales_process: understanding.salesProcess.value,
    capacity_readiness: understanding.capacityReadiness.value
  };
  const strategyResult = buildStrategy({ objective, understanding, confirmedUnderstanding: understanding, answers });
  const plan = buildPlan({ objective, confirmedUnderstanding: understanding, strategyResult, answers });
  return { understanding, answers, strategyResult, plan };
}

(async function run() {
  const positive = fixture();
  assert.strictEqual(positive.strategyResult.strategy.customerMotivation.value, 'Unknown');
  assert.strictEqual(positive.strategyResult.strategy.pricingPosition.value, 'Unknown');
  assert.match(positive.strategyResult.strategy.primarySalesChannel.explanation, /not a recommended future channel/i);
  assert.match(positive.strategyResult.strategy.launchApproach.value, /prepare consultation conversion now/i);
  assert.match(positive.strategyResult.strategy.launchApproach.value, /evaluate acquisition channels separately/i);
  assert.match(positive.plan.summary.whyThisPlan, /channel-neutral/i);

  const items = positive.plan.phases.flatMap(phase => phase.deliverables);
  assert.deepStrictEqual(items.map(item => item.id), [
    'conversion_diagnostic_brief', 'consultation_conversion_brief',
    'consultation_conversion_page_copy', 'conversion_measurement_plan'
  ]);
  assert.deepStrictEqual(items.filter(item => getProductionArtifactPolicy(item.id).readyToUse).map(item => item.id), ['consultation_conversion_page_copy']);
  items.forEach(item => assert.deepStrictEqual(item.dependencies, minimumProductionDependencies(item.id)));
  assert(!items.some(item => /referral|paid_ad|social|organic|outreach|amazon|product_page/.test(item.id)));

  const selection = createDefaultSelection(positive.plan);
  const view = buildApprovalView(positive.plan, selection);
  assert.deepStrictEqual(view.counts, { total: 4, essential: 2, recommended: 2, optional: 0, planningFoundation: 3, readyToUseAssets: 1, productionUnits: 1 });
  const approval = createApprovedProductionSet({ plan: positive.plan, selection, strategyResult: positive.strategyResult, confirmedUnderstanding: positive.understanding });
  assert.strictEqual(approval.valid, true);
  assert.deepStrictEqual(approval.productionSet.productionOrder, items.map(item => item.id));
  const cost = calculateProductionCost({ approvedProductionSet: approval.productionSet, usageSnapshot: { used: 0, monthlyLimit: 10, remaining: 10 } });
  assert.strictEqual(cost.productionUnitCount, 1);
  assert.strictEqual(cost.planningFoundationCount, 3);
  assert.strictEqual(cost.remainingAllowance, 10);

  const withoutReady = updateSelection({ plan: positive.plan, currentSelection: selection, requestedDeliverableIds: ['conversion_diagnostic_brief', 'consultation_conversion_brief', 'conversion_measurement_plan'] });
  assert.strictEqual(withoutReady.valid, true);
  assert.strictEqual(validateSelection(positive.plan, withoutReady.selection).valid, false);
  assert.match(validateSelection(positive.plan, withoutReady.selection).error, /ready-for-review asset/i);

  const now = new Date().toISOString();
  const forgedPlanningOnlyApproval = {
    ...approval.productionSet,
    selectedDeliverables: approval.productionSet.selectedDeliverables.filter(item => !item.readyToUse),
    productionOrder: approval.productionSet.selectedDeliverables.filter(item => !item.readyToUse).map(item => item.id)
  };
  const forgedSession = {
    objective, answers: positive.answers, understanding: positive.understanding,
    confirmedUnderstanding: positive.understanding, planningReadiness: { ready: true },
    planningConfirmedAt: now, strategyResult: positive.strategyResult, strategyUpdatedAt: now,
    buildPlan: positive.plan, buildPlanSource: { planningConfirmedAt: now, strategyUpdatedAt: now },
    buildPlanFingerprint: selection.planFingerprint,
    buildPlanSelection: { ...withoutReady.selection, approvedAt: forgedPlanningOnlyApproval.approvedAt },
    approvedProductionSet: forgedPlanningOnlyApproval
  };
  const initializationGate = validateApprovedProductionSession(forgedSession);
  assert.strictEqual(initializationGate.valid, false);
  assert.match(initializationGate.reason, /ready-for-review asset/i);

  const strategySnapshot = createProductionStrategySnapshot({ objective, strategyResult: positive.strategyResult, confirmedUnderstanding: positive.understanding });
  assert.strictEqual(strategySnapshot.confirmedOffer.value, 'Residential Remodeling');
  assert.strictEqual(strategySnapshot.confirmedPrimaryCta.value, 'Book a consultation');
  assert.strictEqual(strategySnapshot.confirmedConversionAction.value, 'They book a call or appointment');
  const completed = new Map();
  for (const item of items) {
    const contract = getProductionContract(item.id);
    const dependencyOutputs = item.dependencies.map(id => ({ deliverableId: id, title: items.find(candidate => candidate.id === id).title, contractVersion: getProductionContract(id).version, output: completed.get(id), result: [] }));
    const generated = await generateDeliverable({
      job: { deliverable_id: item.id, title: item.title, strategic_direction: item.strategicDirection, strategySnapshot, contract_version: contract.version },
      productionRun: { objective, strategySnapshot }, dependencyOutputs, handler: contract
    });
    assert.strictEqual(contract.validateOutput(generated.structuredOutput, { strategySnapshot, dependencyOutputs }), true, `${item.id} validates`);
    completed.set(item.id, generated.structuredOutput);
  }
  const pageContract = getProductionContract('consultation_conversion_page_copy');
  const page = completed.get('consultation_conversion_page_copy');
  const pageContext = { strategySnapshot, dependencyOutputs: [{ deliverableId: 'consultation_conversion_brief', output: completed.get('consultation_conversion_brief') }] };
  assert.strictEqual(validateCustomerReadyOutput(page, pageContract, pageContext).valid, true);
  assert.match(page.heroHeadline, /remodeling/i);
  assert.match(page.heroSupportingCopy, /homeowners/i);
  assert.strictEqual(page.primaryCallToAction, 'Book a consultation');
  assert.strictEqual(page.finalCallToAction, 'Book a consultation');
  const { editorialReviewNotes: _internalReview, ...publicPage } = page;
  assert.doesNotMatch(JSON.stringify(publicPage), /free consultation|free estimate|licensed|insured|award-winning|financing|guarantee|years in business|referral campaign|google|meta|seo/i);
  const unsafePage = { ...page, trustSection: 'Our licensed and insured team guarantees every project.' };
  assert.strictEqual(validateCustomerReadyOutput(unsafePage, pageContract, pageContext).valid, false);
  [
    'Trusted by 500 homeowners across 200 completed projects.',
    'Our five-star reviews show why customers say we are the best in town.',
    'We are an award-winning certified contractor with a lifetime warranty.',
    'Financing is available, with projects starting at $5,000.',
    'Book a free consultation or free estimate today.',
    'We are available immediately and can start next week.',
    'We complete projects within 30 days and guarantee increased home value.'
  ].forEach(claim => {
    assert.strictEqual(validateCustomerReadyOutput({ ...page, trustSection: claim }, pageContract, pageContext).valid, false, claim);
  });

  initDb({ logger: () => {} });
  const db = getDb();
  const userId = Number(db.prepare("INSERT INTO users (email,name,plan_tier,monthly_limit,generations_used) VALUES (?,'Story 3.256','pro',10,0)").run(`story-3-256-${Date.now()}@example.com`).lastInsertRowid);
  const productionSelection = createDefaultSelection(positive.plan);
  const productionApproval = createApprovedProductionSet({ plan: positive.plan, selection: productionSelection, strategyResult: positive.strategyResult, confirmedUnderstanding: positive.understanding });
  productionSelection.approvedAt = productionApproval.approvedAt;
  const productionNow = new Date().toISOString();
  const productionSession = {
    objective, answers: positive.answers, understanding: positive.understanding,
    confirmedUnderstanding: positive.understanding, planningReadiness: { ready: true },
    planningConfirmedAt: productionNow, strategyResult: positive.strategyResult, strategyUpdatedAt: productionNow,
    buildPlan: positive.plan, buildPlanSource: { planningConfirmedAt: productionNow, strategyUpdatedAt: productionNow },
    buildPlanFingerprint: productionSelection.planFingerprint, buildPlanSelection: productionSelection,
    approvedProductionSet: productionApproval.productionSet
  };
  const initialized = initializeProduction({ db, user: db.prepare('SELECT * FROM users WHERE id=?').get(userId), discoverySession: productionSession });
  assert.strictEqual(initialized.valid, true, initialized.reason);
  let executionCount = 0;
  while (executionCount < 10) {
    const result = await executeNextProductionJob({ db, userId, productionRunId: initialized.productionRunId });
    if (result.outcome === 'no_runnable_job') break;
    assert.strictEqual(result.outcome, 'completed', JSON.stringify(result));
    executionCount += 1;
  }
  assert.strictEqual(executionCount, 4);
  const production = getProductionRun(db, userId, initialized.productionRunId);
  assert.strictEqual(production.status, 'completed');
  assert.deepStrictEqual(production.jobs.map(job => [job.deliverable_id, job.status]), items.map(item => [item.id, 'completed']));
  assert.strictEqual(db.prepare('SELECT COALESCE(SUM(units),0) AS units FROM usage_events WHERE user_id=?').get(userId).units, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id=? AND production_job_id IS NOT NULL').get(userId).count, 4);

  const capacityLimited = fixture({ capacityReadiness: confirmed('capacity_limited', 'Capacity needs attention first') });
  assert.deepStrictEqual(capacityLimited.plan.phases.flatMap(phase => phase.deliverables).filter(item => getProductionArtifactPolicy(item.id).readyToUse), []);
  assert.strictEqual(validateSelection(capacityLimited.plan, createDefaultSelection(capacityLimited.plan)).valid, false);
  const unresolvedAudience = fixture({ targetAudience: confirmed('unsure', "I'm not sure yet") });
  assert.deepStrictEqual(unresolvedAudience.plan.phases.flatMap(phase => phase.deliverables).filter(item => getProductionArtifactPolicy(item.id).readyToUse), []);
  const unresolvedService = fixture({ category: confirmed('unsure', "I'm not sure yet"), industry: confirmed('unsure', "I'm not sure yet") });
  assert.deepStrictEqual(unresolvedService.plan.phases.flatMap(phase => phase.deliverables).filter(item => getProductionArtifactPolicy(item.id).readyToUse), []);
  const product = fixture({ businessType: confirmed('physical_product', 'Physical Product') });
  assert.deepStrictEqual(product.plan.phases.flatMap(phase => phase.deliverables).filter(item => getProductionArtifactPolicy(item.id).readyToUse), []);
  const software = fixture({ businessType: confirmed('software', 'Software'), category: confirmed('accounting_software', 'Accounting Software') });
  assert.deepStrictEqual(software.plan.phases.flatMap(phase => phase.deliverables).filter(item => getProductionArtifactPolicy(item.id).readyToUse), []);
  const unknownPath = fixture({ salesProcess: confirmed('unsure', "I'm not sure yet") });
  assert.strictEqual(unknownPath.plan.readiness.ready, false);

  const directSales = fixture({
    category: confirmed('operations_consulting', 'Operations Consulting'),
    industry: confirmed('professional_services', 'Professional Services'),
    targetAudience: confirmed('growing operations teams', 'Growing operations teams'),
    salesProcess: confirmed('sales_conversation', 'They speak with sales directly')
  });
  const directItems = directSales.plan.phases.flatMap(phase => phase.deliverables);
  assert.deepStrictEqual(directItems.filter(item => getProductionArtifactPolicy(item.id).readyToUse).map(item => item.id), ['consultation_conversion_page_copy']);
  assert.strictEqual(directItems.find(item => item.id === 'consultation_conversion_page_copy').title, 'Service Conversation Page Copy');
  const directSnapshot = createProductionStrategySnapshot({ objective, strategyResult: directSales.strategyResult, confirmedUnderstanding: directSales.understanding });
  assert.strictEqual(directSnapshot.confirmedPrimaryCta.value, 'Speak with sales');
  const directCompleted = new Map();
  for (const item of directItems) {
    const contract = getProductionContract(item.id);
    const dependencyOutputs = item.dependencies.map(id => ({ deliverableId: id, title: directItems.find(candidate => candidate.id === id).title, contractVersion: getProductionContract(id).version, output: directCompleted.get(id), result: [] }));
    const generated = await generateDeliverable({ job: { deliverable_id: item.id, title: item.title, strategic_direction: item.strategicDirection, strategySnapshot: directSnapshot, contract_version: contract.version }, productionRun: { objective, strategySnapshot: directSnapshot }, dependencyOutputs, handler: contract });
    directCompleted.set(item.id, generated.structuredOutput);
  }
  const directPage = directCompleted.get('consultation_conversion_page_copy');
  assert.strictEqual(directPage.primaryCallToAction, 'Speak with sales');
  assert.strictEqual(directPage.finalCallToAction, 'Speak with sales');
  assert.match(directPage.heroSupportingCopy, /sales conversation/i);
  assert.doesNotMatch(JSON.stringify(directPage), /book (?:a |an )?(?:call|appointment|consultation)/i);

  const nonRemodelingAppointment = fixture({
    category: confirmed('dental_practice', 'Dental Practice'),
    industry: confirmed('professional_services', 'Professional Services'),
    targetAudience: confirmed('adults considering routine dental care', 'Adults considering routine dental care')
  });
  assert.deepStrictEqual(nonRemodelingAppointment.plan.phases.flatMap(phase => phase.deliverables).filter(item => getProductionArtifactPolicy(item.id).readyToUse).map(item => item.id), ['consultation_conversion_page_copy']);

  const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'build-plan.ejs'), 'utf8');
  assert.match(template, /This plan currently supports planning only/);
  assert.match(template, /No Production work is selected/);
  assert.match(template, /outputPlanItems\.length && approval\.counts\.readyToUseAssets > 0/);
  assert.match(template, /production credit.*selected/);

  console.log('Story 3.256 service acquisition execution tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
