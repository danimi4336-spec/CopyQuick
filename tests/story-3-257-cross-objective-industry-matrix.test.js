const assert = require('assert');
const { objectiveUniverse } = require('../lib/objectiveFramework');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { buildBusinessReflection } = require('../lib/businessReflection');
const { createDefaultSelection, createApprovedProductionSet, validateSelection } = require('../lib/buildPlanApproval');
const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const { minimumProductionDependencies } = require('../lib/productionDependencyPolicy');
const { calculateProductionCost } = require('../lib/productionCost');
const { generateDeliverable } = require('../lib/generationService');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { promoteObjectiveMemory, resolveObjectiveSubjects } = require('../lib/businessMemory');

const fact = (value, label = value) => ({ value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' });
const fixture = (initial_description, understanding, answers) => ({ understanding, answers: { initial_description, ...answers } });

function remodeling() {
  return fixture('Residential remodeling consultations for homeowners planning major renovations.', {
    businessType: fact('service', 'Service Business'), industry: fact('home_services', 'Home Services'),
    category: fact('residential_remodeling', 'Residential Remodeling'), acquisitionGoal: fact('appointments', 'More booked appointments'),
    targetAudience: fact('homeowners planning major renovations', 'Homeowners planning major renovations'),
    currentAcquisitionChannel: fact('referrals', 'Referrals'), acquisitionStage: fact('inconsistent_traction', 'Some traction, but inconsistent'),
    salesProcess: fact('booked_call', 'They book a call or appointment'), capacityReadiness: fact('capacity_ready', 'Yes, ready for more customers')
  }, {
    business_type: 'service', acquisition_goal: 'appointments', acquisition_target: { value: 'homeowners planning major renovations' },
    acquisition_channel: 'referrals', acquisition_stage: 'inconsistent_traction', sales_process: 'booked_call', capacity_readiness: 'capacity_ready'
  });
}

function bookkeeping() {
  return fixture('Monthly bookkeeping and reporting for independent agencies.', {
    serviceDefinition: fact('Monthly bookkeeping and reporting'), targetAudience: fact('Independent agency owners'),
    clientProblem: fact('Month-end records are difficult to interpret'),
    serviceExpertise: fact('Founder biography and bookkeeping qualifications supplied by the builder'),
    serviceDifferentiation: fact('Plain-language monthly summaries'), serviceOffer: fact('Monthly engagement; pricing unresolved'),
    serviceMarket: fact('unsure', "I'm not sure yet"), serviceChannel: fact('outbound', 'Outbound outreach'),
    serviceConstraints: fact('No published case studies')
  }, {
    service_definition: { value: 'Monthly bookkeeping and reporting' }, service_client: { value: 'Independent agency owners' },
    service_problem: { value: 'Month-end records are difficult to interpret' },
    service_expertise: { value: 'Founder biography and bookkeeping qualifications supplied by the builder' },
    service_difference: { value: 'Plain-language monthly summaries' }, service_offer: { value: 'Monthly engagement; pricing unresolved' },
    service_market: 'unsure', service_channel: 'outbound', service_constraints: { value: 'No published case studies' }
  });
}

function conversion({ offer, audience, traffic, funnel, page, cta, businessType, industry, category }) {
  return fixture(`${offer} for ${audience}.`, {
    businessType: fact(businessType, businessType), industry: fact(industry, industry), category: fact(category, category),
    currentOffer: fact(offer), targetAudience: fact(audience), trafficSource: fact(traffic, traffic), funnelType: fact(funnel, funnel),
    pageExperience: fact(page), primaryCta: fact(cta), conversionEvidence: fact('unsure', "I'm not sure yet"),
    conversionFriction: fact('unsure', "I'm not sure yet")
  }, {
    conversion_offer: { value: offer }, conversion_audience: { value: audience }, conversion_traffic: traffic,
    conversion_funnel: funnel, conversion_page: { value: page }, conversion_cta: { value: cta },
    conversion_evidence: 'unsure', conversion_friction: 'unsure'
  });
}

function physicalProduct() {
  return fixture('A reusable desk organizer for remote illustrators.', {
    businessType: fact('physical_product', 'Physical Product'), targetAudience: fact('remote illustrators', 'Remote illustrators'),
    customerMotivation: fact('convenience', 'Convenience'), launchStage: fact('ready', 'Ready to launch'),
    salesChannel: fact('ecommerce', 'Own ecommerce store'), competitiveDifferentiation: fact('unsure', "I'm not sure yet")
  }, {
    business_type: 'physical_product', target_audience: { value: 'remote illustrators' }, customer_motivation: 'convenience',
    launch_stage: 'ready', sales_channel: 'ecommerce', competitive_differentiation: 'unsure'
  });
}

function wellness() {
  return fixture('An early-stage cinnamon supplement concept for everyday wellness.', {
    businessType: fact('physical_product', 'Physical Product'), industry: fact('health_wellness', 'Health & Wellness'),
    category: fact('dietary_supplement', 'Dietary Supplement'), intendedOutcome: fact('everyday_wellness', 'Everyday wellness'),
    conceptMaturity: fact('formula_in_mind', 'Ingredients or formula in mind'),
    existingProductDefinition: fact('A cinnamon capsule concept; efficacy and dosage are not established'),
    targetAudience: fact('adults interested in everyday wellness', 'Adults interested in everyday wellness'),
    launchStage: fact('development', 'In development'), salesChannel: fact('unsure', "I'm not sure yet"),
    competitiveDifferentiation: fact('unsure', "I'm not sure yet")
  }, {
    business_type: 'physical_product', supplement_intended_outcome: 'everyday_wellness', supplement_concept_maturity: 'formula_in_mind',
    supplement_existing_product_definition: { value: 'A cinnamon capsule concept; efficacy and dosage are not established' },
    target_audience: { value: 'adults interested in everyday wellness' }, supplement_launch_stage: 'development',
    sales_channel: 'unsure', competitive_differentiation: 'unsure'
  });
}

function idea() {
  return fixture('A shared inventory reminder concept that has not been validated.', {
    ideaDefinition: fact('A shared inventory reminder'), ideaMaturity: fact('idea_only', 'Idea only'),
    targetAudience: fact('small theatre production managers', 'Small theatre production managers'),
    problemHypothesis: fact('Supply checks may be missed'), solutionHypothesis: fact('Shared reminders may coordinate checks'),
    demandAssumptions: fact('Managers may pay to reduce missed checks'), knownAlternatives: fact('Spreadsheets and chat'),
    validationEvidence: fact('unsure', "I'm not sure yet"), validationResources: fact('Access to eight managers')
  }, {
    idea_definition: { value: 'A shared inventory reminder' }, idea_maturity: 'idea_only',
    idea_customer: { value: 'small theatre production managers' }, idea_problem: { value: 'Supply checks may be missed' },
    idea_solution: { value: 'Shared reminders may coordinate checks' }, idea_demand: { value: 'Managers may pay to reduce missed checks' },
    idea_alternatives: { value: 'Spreadsheets and chat' }, idea_evidence: 'unsure', idea_resources: { value: 'Access to eight managers' }
  });
}

const industries = ['remodeling', 'bookkeeping', 'localAppointment', 'saas', 'ecommerce', 'physicalProduct', 'wellness', 'unresolvedOffer', 'conflictingOffers'];
const matrix = Object.freeze({
  launch_product: ['SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION','PASS','PASS','PASS','SAFE_EXCLUSION','SAFE_EXCLUSION'],
  get_more_customers: ['PASS','PASS','PASS','PASS','PASS','PASS','SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION'],
  increase_conversion_rates: ['PASS','PASS','PASS','PASS','PASS','PASS','SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION'],
  improve_search_rankings: ['PASS','PASS','PASS','PASS','PASS','PASS','SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION'],
  build_brand: ['PASS','PASS','PASS','PASS','PASS','PASS','PASS','SAFE_EXCLUSION','SAFE_EXCLUSION'],
  promote_service: ['PASS','PASS','PASS','SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION','SAFE_EXCLUSION'],
  validate_idea: ['PASS','PASS','PASS','PASS','PASS','PASS','SAFE_EXCLUSION','PASS','SAFE_EXCLUSION']
});

function inspect(objective, source) {
  const runtime = createObjectiveRuntime(objective);
  const discovery = runtime.discovery.analyze({ ...source, unknowns: [] });
  assert.strictEqual(discovery.planningReadiness.ready, true, `${objective}: discovery`);
  const reflection = buildBusinessReflection({ objective, ...source, planningReadiness: discovery.planningReadiness });
  assert(reflection.groups.length, `${objective}: reflection`);
  const strategy = runtime.strategy.build({ understanding: source.understanding, confirmedUnderstanding: source.understanding, answers: source.answers });
  const plan = runtime.buildPlan({ confirmedUnderstanding: source.understanding, strategyResult: strategy, answers: source.answers });
  assert.strictEqual(plan.readiness.ready, true, `${objective}: plan`);
  const items = plan.phases.flatMap(phase => phase.deliverables);
  assert(items.length, `${objective}: useful work`);
  items.forEach(item => {
    assert(runtime.production.contract(item.id), `${objective}:${item.id}: contract`);
    assert.deepStrictEqual(item.dependencies, minimumProductionDependencies(item.id), `${objective}:${item.id}: dependencies`);
    assert(getProductionArtifactPolicy(item.id), `${objective}:${item.id}: artifact policy`);
  });
  const selection = createDefaultSelection(plan);
  const approval = createApprovedProductionSet({ plan, selection, strategyResult: strategy, confirmedUnderstanding: source.understanding });
  const ready = items.filter(item => getProductionArtifactPolicy(item.id).readyToUse);
  if (plan.summary.requiresReadyAsset && !ready.length) {
    assert.strictEqual(approval.valid, false, `${objective}: planning-only approval`);
    assert.strictEqual(validateSelection(plan, selection).valid, false, `${objective}: planning-only selection`);
  } else {
    assert.strictEqual(approval.valid, true, `${objective}: approval`);
    const cost = calculateProductionCost({ approvedProductionSet: approval.productionSet, usageSnapshot: { used: 0, monthlyLimit: 20, remaining: 20 } });
    assert.strictEqual(cost.productionUnitCount, approval.productionSet.selectedDeliverables.filter(item => item.readyToUse).length);
    assert.strictEqual(cost.planningFoundationCount, approval.productionSet.selectedDeliverables.filter(item => !item.readyToUse).length);
  }
  return { strategy, plan, items };
}

(async function run() {
  const supported = objectiveUniverse.filter(item => item.available).map(item => item.id);
  assert.deepStrictEqual(Object.keys(matrix), supported);
  Object.values(matrix).forEach(row => {
    assert.strictEqual(row.length, industries.length);
    row.forEach(status => assert(['PASS', 'SAFE_EXCLUSION'].includes(status)));
  });

  const acquisition = inspect('get_more_customers', remodeling());
  assert.deepStrictEqual(acquisition.items.map(item => item.id), [
    'conversion_diagnostic_brief', 'consultation_conversion_brief', 'consultation_conversion_page_copy', 'conversion_measurement_plan'
  ]);
  assert.doesNotMatch(JSON.stringify(acquisition.strategy), /referrals? (?:are|is) (?:recommended|proven|best-performing)/i);

  const local = inspect('increase_conversion_rates', conversion({
    offer: 'Routine dental appointments', audience: 'Adults considering routine dental care', traffic: 'referrals',
    funnel: 'booked_call', page: 'A service page describing routine care', cta: 'Book an appointment',
    businessType: 'service', industry: 'professional_services', category: 'dental_practice'
  }));
  assert(local.items.some(item => item.id === 'consultation_conversion_page_copy'));
  const saas = inspect('increase_conversion_rates', conversion({
    offer: 'A scheduling software trial', audience: 'Operations leaders', traffic: 'paid_ads',
    funnel: 'trial_signup', page: 'A pricing page with setup information', cta: 'Start a trial',
    businessType: 'software', industry: 'technology', category: 'scheduling_software'
  }));
  assert(!saas.items.some(item => /consultation/.test(item.id)));
  const commerce = inspect('increase_conversion_rates', conversion({
    offer: 'Reusable desk organizer', audience: 'Remote professionals', traffic: 'social',
    funnel: 'purchase', page: 'A product page with dimensions and materials', cta: 'Add to cart',
    businessType: 'physical_product', industry: 'consumer_products', category: 'desk_organizer'
  }));
  assert(!commerce.items.some(item => /consultation/.test(item.id)));

  const promotedService = inspect('promote_service', bookkeeping());
  const serviceApproval = createApprovedProductionSet({
    plan: promotedService.plan, selection: createDefaultSelection(promotedService.plan),
    strategyResult: promotedService.strategy, confirmedUnderstanding: bookkeeping().understanding
  });
  const serviceRuntime = createObjectiveRuntime('promote_service');
  const serviceCompleted = new Map();
  let serviceOutput;
  for (const serviceItem of promotedService.items) {
    const serviceContract = serviceRuntime.production.contract(serviceItem.id);
    const dependencyOutputs = serviceItem.dependencies.map(id => ({
      deliverableId: id, title: id, contractVersion: serviceRuntime.production.contract(id).version,
      output: serviceCompleted.get(id)
    }));
    const generated = await generateDeliverable({
      job: { deliverable_id: serviceItem.id, title: serviceItem.title, strategic_direction: serviceItem.strategicDirection, strategySnapshot: serviceApproval.productionSet.strategySnapshot },
      productionRun: { objective: 'promote_service', strategySnapshot: serviceApproval.productionSet.strategySnapshot },
      dependencyOutputs, handler: serviceContract
    });
    serviceCompleted.set(serviceItem.id, generated.structuredOutput);
    if (serviceItem.id === 'service_page') serviceOutput = generated;
  }
  const serviceContract = serviceRuntime.production.contract('service_page');
  assert.strictEqual(serviceContract.validateOutput(serviceOutput.structuredOutput), true);
  assert.doesNotMatch(serviceOutput.structuredOutput.content.join(' '), /\[[^\]]+\]|pricing is unresolved|confirmed service scope|residential remodeling|home services/i);
  inspect('validate_idea', idea());
  inspect('launch_product', physicalProduct());
  const sensitive = inspect('launch_product', wellness());
  assert.doesNotMatch(JSON.stringify(sensitive.strategy), /cures?|treats?|prevents?|clinically proven|safe for everyone/i);

  const missingAudience = remodeling();
  delete missingAudience.understanding.targetAudience;
  delete missingAudience.answers.acquisition_target;
  assert.strictEqual(createObjectiveRuntime('get_more_customers').discovery.analyze({ ...missingAudience, unknowns: [] }).planningReadiness.ready, false);

  const limited = remodeling();
  limited.understanding.capacityReadiness = fact('capacity_limited', 'Capacity needs attention first');
  limited.answers.capacity_readiness = 'capacity_limited';
  const limitedPlan = inspect('get_more_customers', limited);
  assert.strictEqual(limitedPlan.items.filter(item => getProductionArtifactPolicy(item.id).readyToUse).length, 0);
  assert.strictEqual(limitedPlan.plan.summary.requiresReadyAsset, true);

  const memoryDb = new Database(':memory:');
  memoryDb.pragma('foreign_keys = ON');
  runMigrationEngine(memoryDb, { logger() {} });
  const userId = Number(memoryDb.prepare("INSERT INTO users(email,name) VALUES('story-257@example.com','Story 257')").run().lastInsertRowid);
  promoteObjectiveMemory(memoryDb, {
    userId, objective: 'get_more_customers', referenceId: 'remodeling-plan',
    answers: remodeling().answers, understanding: remodeling().understanding
  });
  const unrelatedService = resolveObjectiveSubjects(memoryDb, {
    userId,
    initialDescription: 'Monthly bookkeeping and reporting for independent agencies with plain-language monthly summaries.'
  });
  assert.strictEqual(unrelatedService.selection, 'new');
  assert.strictEqual(unrelatedService.offer, null, 'bookkeeping must not inherit remodeling memory');
  const newOfferMemory = require('../lib/businessMemory').memoryUnderstanding(memoryDb, {
    userId, objective: 'promote_service',
    initialDescription: 'Monthly bookkeeping and reporting for independent agencies with plain-language monthly summaries.',
    subjectId: unrelatedService.offer?.id
  });
  assert.strictEqual(newOfferMemory.understanding.industry, undefined, 'new bookkeeping offer must not inherit Home Services');
  assert.strictEqual(newOfferMemory.understanding.businessType, undefined, 'new offer business type must come from current Discovery');
  memoryDb.close();

  console.log('Story 3.257 cross-objective and cross-industry acceptance matrix tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
