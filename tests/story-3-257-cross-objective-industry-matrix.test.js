const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { objectiveUniverse } = require('../lib/objectiveFramework');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { buildBusinessReflection } = require('../lib/businessReflection');
const { createDefaultSelection, createApprovedProductionSet, validateSelection } = require('../lib/buildPlanApproval');
const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const { minimumProductionDependencies } = require('../lib/productionDependencyPolicy');
const { calculateProductionCost } = require('../lib/productionCost');
const { generateDeliverable } = require('../lib/generationService');
const { runMigrationEngine } = require('../db/migrations');
const { memoryUnderstanding, promoteObjectiveMemory, resolveObjectiveSubjects } = require('../lib/businessMemory');

const fact = (value, label = value) => ({ value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' });
const unsure = () => fact('unsure', "I'm not sure yet");
const fixture = (initialDescription, understanding, answers) => ({ understanding, answers: { initial_description: initialDescription, ...answers } });

const INDUSTRIES = Object.freeze({
  remodeling: Object.freeze({ kind: 'service', businessType: 'service', businessLabel: 'Service Business', industry: 'home_services', category: 'residential_remodeling', offer: 'Residential remodeling consultations for kitchen, bathroom, and whole-home projects', audience: 'Homeowners planning major renovations', problem: 'Planning a major renovation involves decisions about scope and priorities', cta: 'Book a consultation', funnel: 'booked_call', channel: 'referrals' }),
  bookkeeping: Object.freeze({ kind: 'service', businessType: 'service', businessLabel: 'Service Business', industry: 'professional_services', category: 'bookkeeping', offer: 'Monthly bookkeeping and reporting with plain-language summaries', audience: 'Independent agency owners', problem: 'Month-end records can be difficult to interpret', cta: 'Book a consultation', funnel: 'booked_call', channel: 'referrals' }),
  localAppointment: Object.freeze({ kind: 'service', businessType: 'service', businessLabel: 'Service Business', industry: 'professional_services', category: 'dental_practice', offer: 'Routine dental appointment consultations', audience: 'Adults considering routine dental care', problem: 'People need clear information before choosing an appointment', cta: 'Book an appointment', funnel: 'booked_call', channel: 'local_search' }),
  saas: Object.freeze({ kind: 'software', businessType: 'software', businessLabel: 'Software or an app', industry: 'technology', category: 'scheduling_software', offer: 'Team scheduling software trial', audience: 'Operations leaders at growing companies', problem: 'Coordinating team schedules takes repeated manual work', cta: 'Start a trial', funnel: 'trial_signup', channel: 'paid_ads' }),
  ecommerce: Object.freeze({ kind: 'product', businessType: 'physical_product', businessLabel: 'Physical Product', industry: 'consumer_products', category: 'desk_accessories', offer: 'Modular desk accessory collection', audience: 'Remote professionals organizing small workspaces', problem: 'Small workspaces need flexible organization', cta: 'Add to cart', funnel: 'purchase', channel: 'social' }),
  physicalProduct: Object.freeze({ kind: 'product', businessType: 'physical_product', businessLabel: 'Physical Product', industry: 'consumer_products', category: 'desk_organizer', offer: 'Reusable desk organizer', audience: 'Remote illustrators', problem: 'Desk tools need a consistent place between projects', cta: 'View product details', funnel: 'purchase', channel: 'email' }),
  wellness: Object.freeze({ kind: 'wellness', businessType: 'physical_product', businessLabel: 'Physical Product', industry: 'health_wellness', category: 'dietary_supplement', offer: 'Cinnamon capsule concept for everyday wellness', audience: 'Adults interested in everyday wellness routines', problem: 'People compare labels and product formats when considering wellness products', cta: 'Review product details', funnel: 'purchase', channel: 'social' }),
  unresolvedOffer: Object.freeze({ kind: 'unresolved', businessType: null, industry: 'early_stage', category: null, offer: null, audience: 'People who may benefit from a future offer', problem: 'The offer and customer need are still being explored', cta: null, funnel: null, channel: 'unsure' }),
  conflictingOffers: Object.freeze({ kind: 'conflict', businessType: null, industry: null, category: null, offer: null, audience: null, problem: null, cta: null, funnel: null, channel: null })
});

const OBJECTIVES = objectiveUniverse.filter(item => item.available).map(item => item.id);
const INDUSTRY_KEYS = Object.keys(INDUSTRIES);
const PRODUCT_LAUNCH_KINDS = new Set(['software', 'product', 'wellness']);

function applicability(objective, industryKey) {
  const profile = INDUSTRIES[industryKey];
  if (profile.kind === 'conflict') return { status: 'SAFE_EXCLUSION', reason: 'conflicting remembered offers require explicit subject selection', mode: 'conflict' };
  if (profile.kind === 'unresolved' && !['build_brand', 'validate_idea'].includes(objective)) return { status: 'SAFE_EXCLUSION', reason: 'essential offer context remains unresolved', mode: 'planning_only' };
  if (objective === 'launch_product' && !PRODUCT_LAUNCH_KINDS.has(profile.kind)) return { status: 'SAFE_EXCLUSION', reason: 'the fixture is an established service rather than a product launch', mode: 'incompatible' };
  if (objective === 'promote_service' && profile.kind !== 'service') return { status: 'SAFE_EXCLUSION', reason: 'the fixture is not a service offer', mode: 'incompatible' };
  return { status: 'PASS', reason: 'applicable workflow exercised', mode: 'applicable' };
}

function launchFixture(profile) {
  const wellness = profile.kind === 'wellness';
  const understanding = {
    businessType: fact(profile.businessType, profile.businessLabel), industry: fact(profile.industry), category: fact(profile.category),
    targetAudience: fact(profile.audience), customerMotivation: fact('convenience', 'Convenience'),
    conceptMaturity: fact(wellness ? 'formula_in_mind' : profile.kind === 'product' ? 'finalized' : 'concept', wellness ? 'Ingredients or formula in mind' : 'Concept described'),
    launchStage: fact('ready', 'Ready to launch'), salesChannel: fact('own_website', 'Own website'), competitiveDifferentiation: unsure(),
    existingProductDefinition: fact(profile.offer)
  };
  if (wellness) understanding.intendedOutcome = fact('everyday_wellness', 'Everyday wellness');
  return fixture(profile.offer, understanding, {
    business_type: profile.businessType, target_audience: { value: profile.audience }, customer_motivation: 'convenience', launch_stage: 'ready',
    sales_channel: 'own_website', competitive_differentiation: 'unsure',
    ...(wellness ? { supplement_intended_outcome: 'everyday_wellness', supplement_concept_maturity: 'formula_in_mind', supplement_existing_product_definition: { value: profile.offer }, supplement_launch_stage: 'ready' } : {})
  });
}

function acquisitionFixture(profile) {
  const service = profile.kind === 'service';
  return fixture(`${profile.offer} for ${profile.audience}.`, {
    businessType: fact(profile.businessType, profile.businessLabel), industry: fact(profile.industry), category: fact(profile.category),
    acquisitionGoal: fact(service ? 'appointments' : 'sales', service ? 'More booked appointments' : 'More sales'), targetAudience: fact(profile.audience),
    currentAcquisitionChannel: fact(profile.channel), acquisitionStage: fact('inconsistent_traction', 'Some traction, but inconsistent'),
    salesProcess: fact(profile.funnel), capacityReadiness: fact('capacity_ready', 'Yes, ready for more customers')
  }, {
    business_type: profile.businessType, acquisition_goal: service ? 'appointments' : 'sales', acquisition_target: { value: profile.audience },
    acquisition_channel: profile.channel, acquisition_stage: 'inconsistent_traction', sales_process: profile.funnel, capacity_readiness: 'capacity_ready'
  });
}

function conversionFixture(profile) {
  return fixture(`${profile.offer} for ${profile.audience}.`, {
    businessType: fact(profile.businessType, profile.businessLabel), industry: fact(profile.industry), category: fact(profile.category),
    currentOffer: fact(profile.offer), targetAudience: fact(profile.audience), trafficSource: fact(profile.channel), funnelType: fact(profile.funnel),
    pageExperience: fact(`A page explaining ${profile.offer}`), primaryCta: fact(profile.cta), conversionEvidence: unsure(), conversionFriction: unsure()
  }, {
    conversion_offer: { value: profile.offer }, conversion_audience: { value: profile.audience }, conversion_traffic: profile.channel,
    conversion_funnel: profile.funnel, conversion_page: { value: `A page explaining ${profile.offer}` }, conversion_cta: { value: profile.cta },
    conversion_evidence: 'unsure', conversion_friction: 'unsure'
  });
}

function searchFixture(profile) {
  return fixture(`${profile.offer} website seeking relevant organic discovery.`, {
    websiteContext: fact(`A website for ${profile.offer}`), targetAudience: fact(profile.audience), searchGoal: fact('qualified_leads', 'Generate qualified leads'),
    primaryCta: fact(profile.cta), existingContent: fact('A main offer page and a small educational resource section'), geographicMarket: unsure(),
    suppliedKeywords: fact(`${profile.category}; practical questions about ${profile.category}`), searchEvidence: unsure(),
    technicalLimitations: fact('The team can publish one carefully reviewed article per month')
  }, {
    search_site: { value: `A website for ${profile.offer}` }, search_audience: { value: profile.audience }, search_goal: 'qualified_leads',
    conversion_cta: { value: profile.cta }, search_content: { value: 'A main offer page and a small educational resource section' }, search_market: 'unsure',
    search_keywords: { value: `${profile.category}; practical questions about ${profile.category}` }, search_evidence: 'unsure',
    search_constraints: { value: 'One carefully reviewed article per month' }
  });
}

function brandFixture(profile) {
  const offer = profile.offer || 'An early-stage business exploring its first offer';
  const audience = profile.audience || 'A customer group still being clarified';
  return fixture(`Build a clear brand for ${offer}.`, {
    brandBusiness: fact(offer), targetAudience: fact(audience), existingBrand: fact('A working name exists; other brand decisions remain open'),
    brandDifferentiation: fact('Clear explanations and a respectful buying experience'), brandValues: fact('Clarity, usefulness, and respect'),
    brandVoice: fact('Clear, calm, and practical'), brandProof: unsure(), brandConstraints: fact('Do not invent proof or capabilities')
  }, {
    brand_business: { value: offer }, brand_audience: { value: audience }, brand_state: { value: 'A working name exists; other brand decisions remain open' },
    brand_difference: { value: 'Clear explanations and a respectful buying experience' }, brand_values: { value: 'Clarity, usefulness, and respect' },
    brand_voice: { value: 'Clear, calm, and practical' }, brand_proof: 'unsure', brand_constraints: { value: 'Do not invent proof or capabilities' }
  });
}

function serviceFixture(profile) {
  return fixture(`${profile.offer} for ${profile.audience}.`, {
    serviceDefinition: fact(profile.offer), targetAudience: fact(profile.audience), clientProblem: fact(profile.problem),
    serviceExpertise: fact('The builder supplied a service description but no public credential claims'), serviceDifferentiation: fact('A clear process and plain-language communication'),
    serviceOffer: unsure(), serviceMarket: unsure(), serviceChannel: fact(profile.channel), serviceConstraints: fact('Pricing, testimonials, performance, and availability are unconfirmed')
  }, {
    service_definition: { value: profile.offer }, service_client: { value: profile.audience }, service_problem: { value: profile.problem },
    service_expertise: { value: 'The builder supplied a service description but no public credential claims' },
    service_difference: { value: 'A clear process and plain-language communication' }, service_offer: 'unsure', service_market: 'unsure',
    service_channel: profile.channel, service_constraints: { value: 'Pricing, testimonials, performance, and availability are unconfirmed' }
  });
}

function ideaFixture(profile) {
  const offer = profile.offer || 'A possible service or product direction';
  const audience = profile.audience || 'A customer group to identify through interviews';
  const problem = profile.problem || 'The customer problem is still a hypothesis';
  return fixture(`Validate ${offer} before making a larger investment.`, {
    ideaDefinition: fact(offer), ideaMaturity: fact('idea_only', 'Idea only'), targetAudience: fact(audience), problemHypothesis: fact(problem),
    solutionHypothesis: fact(`${offer} may provide a clearer next step`), demandAssumptions: fact('The audience may value the proposed approach'),
    knownAlternatives: unsure(), validationEvidence: unsure(), validationResources: fact('Access to a small set of neutral customer interviews')
  }, {
    idea_definition: { value: offer }, idea_maturity: 'idea_only', idea_customer: { value: audience }, idea_problem: { value: problem },
    idea_solution: { value: `${offer} may provide a clearer next step` }, idea_demand: { value: 'The audience may value the proposed approach' },
    idea_alternatives: 'unsure', idea_evidence: 'unsure', idea_resources: { value: 'Access to a small set of neutral customer interviews' }
  });
}

const FIXTURE_BUILDERS = Object.freeze({
  launch_product: launchFixture, get_more_customers: acquisitionFixture, increase_conversion_rates: conversionFixture,
  improve_search_rankings: searchFixture, build_brand: brandFixture, promote_service: serviceFixture, validate_idea: ideaFixture
});

function validatePublicOutput(output, contract, profile) {
  const values = [];
  (function collect(value) {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  })(output);
  const text = values.join(' ');
  assert.doesNotMatch(text, /production_job_id|deliverable_id|contract_version|semanticRole|sourceFields|synthesisTrace|validator/i);
  assert.doesNotMatch(text, /\b(?:we guarantee|guaranteed to|delivers? proven results?|best-performing|industry-leading)\b/i);
  if (profile.kind === 'service') assert.doesNotMatch(text, /\b(?:add to cart|checkout|shipping|start (?:a )?trial)\b/i);
  if (profile.kind === 'software') assert.doesNotMatch(text, /\b(?:add to cart|shipping|book a consultation)\b/i);
  if (['product', 'wellness'].includes(profile.kind)) assert.doesNotMatch(text, /\bbook (?:a )?(?:call|consultation|appointment)\b/i);
  if (profile.kind === 'wellness') assert.doesNotMatch(text, /\b(?:cures?|prevents?|clinically proven|safe for everyone|guarantees? results?|treats? (?:diabetes|disease|illness|symptoms?))\b/i);
  if (['product'].includes(profile.kind)) assert.doesNotMatch(text, /\b(?:formulation|dosage|label directions|warnings|wellness routine)\b/i);
  if (contract.readyToUse) assert.doesNotMatch(text, /pricing is unresolved|confirmed service scope|builder-provided/i);
  if (contract.id === 'priority_search_article') assert.doesNotMatch(text, /within this scope|exclude unsupported search-performance claims/i);
  if (contract.id === 'service_page') assert.doesNotMatch(text, /\[[^\]]+\]/);
}

async function exerciseApplicable(objective, industryKey) {
  const profile = INDUSTRIES[industryKey];
  const source = FIXTURE_BUILDERS[objective](profile);
  const runtime = createObjectiveRuntime(objective);
  const discovery = runtime.discovery.analyze({ ...source, unknowns: [] });
  assert.strictEqual(discovery.planningReadiness.ready, true, `${objective}/${industryKey}: discovery`);
  const reflection = buildBusinessReflection({ objective, ...source, planningReadiness: discovery.planningReadiness });
  assert(reflection.groups.length, `${objective}/${industryKey}: reflection`);
  const strategy = runtime.strategy.build({ understanding: source.understanding, confirmedUnderstanding: source.understanding, answers: source.answers });
  assert.doesNotMatch(JSON.stringify(strategy), /\b(?:proven demand|guaranteed|best-performing channel|conversion rate is \d|search volume: \d)\b/i);
  if (objective === 'increase_conversion_rates' && profile.kind === 'software') {
    assert.doesNotMatch(JSON.stringify(strategy), /\b(?:shipping|returns|checkout friction)\b/i, 'SaaS conversion strategy must not inherit ecommerce diagnostics');
  }
  const plan = runtime.buildPlan({ confirmedUnderstanding: source.understanding, strategyResult: strategy, answers: source.answers });
  assert.strictEqual(plan.readiness.ready, true, `${objective}/${industryKey}: plan`);
  const items = plan.phases.flatMap(phase => phase.deliverables);
  assert(items.length, `${objective}/${industryKey}: useful plan`);
  const itemIds = items.map(item => item.id);
  if (objective === 'launch_product' && profile.kind === 'software') {
    assert(itemIds.includes('software_product_demo'));
    assert(!itemIds.some(id => /^ecommerce_|^abandoned_cart_/.test(id)), 'SaaS launch must not receive ecommerce/cart assets');
  }
  if (objective === 'increase_conversion_rates' && profile.kind === 'software') {
    assert.match(plan.summary.whyThisPlan, /trial-signup/i);
    assert.doesNotMatch(plan.summary.whyThisPlan, /product-page|ecommerce|checkout|shipping/i);
  }
  if (objective === 'launch_product' && ['product', 'wellness'].includes(profile.kind)) {
    assert(!itemIds.some(id => /^software_|^saas_/.test(id)), 'product launch must not receive SaaS assets');
  }
  items.forEach(item => {
    assert(runtime.production.contract(item.id), `${objective}/${industryKey}/${item.id}: contract`);
    assert.deepStrictEqual(item.dependencies, minimumProductionDependencies(item.id), `${objective}/${industryKey}/${item.id}: dependencies`);
  });
  const selection = createDefaultSelection(plan);
  const approval = createApprovedProductionSet({ plan, selection, strategyResult: strategy, confirmedUnderstanding: source.understanding });
  const readyItems = items.filter(item => getProductionArtifactPolicy(item.id).readyToUse);
  if (plan.summary.requiresReadyAsset && !readyItems.length) {
    assert.strictEqual(approval.valid, false, `${objective}/${industryKey}: execution safely unavailable`);
    assert.strictEqual(validateSelection(plan, selection).valid, false);
    return { status: 'PASS', reason: 'planning-only behavior exercised', objective, industryKey };
  }
  assert.strictEqual(approval.valid, true, `${objective}/${industryKey}: approval`);
  const cost = calculateProductionCost({ approvedProductionSet: approval.productionSet, usageSnapshot: { used: 2, monthlyLimit: 20, remaining: 18 } });
  assert.strictEqual(cost.productionUnitCount, approval.productionSet.selectedDeliverables.filter(item => item.readyToUse).length);
  assert.strictEqual(cost.planningFoundationCount, approval.productionSet.selectedDeliverables.filter(item => !item.readyToUse).length);
  const completed = new Map();
  for (const item of approval.productionSet.selectedDeliverables) {
    const contract = runtime.production.contract(item.id);
    const dependencies = item.dependencies.map(id => ({ deliverableId: id, title: items.find(candidate => candidate.id === id)?.title || id, contractVersion: runtime.production.contract(id).version, output: completed.get(id) }));
    let generated;
    try {
      generated = await generateDeliverable({
        job: { deliverable_id: item.id, title: item.title, strategic_direction: item.strategicDirection, strategySnapshot: approval.productionSet.strategySnapshot },
        productionRun: { objective, strategySnapshot: approval.productionSet.strategySnapshot }, dependencyOutputs: dependencies, handler: contract
      });
    } catch (error) {
      error.message = `${objective}/${industryKey}/${item.id}: ${error.message} ${JSON.stringify(error.details || {})}`;
      throw error;
    }
    const validation = item.id === 'priority_search_article'
      ? { valid: contract.validateOutput(generated.structuredOutput) }
      : runtime.validation.validate(generated.structuredOutput, contract);
    assert.strictEqual(validation.valid, true, `${objective}/${industryKey}/${item.id}: output ${JSON.stringify(validation)}`);
    validatePublicOutput(generated.structuredOutput, contract, profile);
    completed.set(item.id, generated.structuredOutput);
  }
  return { status: 'PASS', reason: 'full deterministic path exercised', objective, industryKey };
}

function assertUnresolvedPlanningOnly(objective) {
  const runtime = createObjectiveRuntime(objective);
  const source = fixture('I am still deciding what the business will offer.', {}, {});
  const discovery = runtime.discovery.analyze({ ...source, unknowns: [] });
  assert.strictEqual(discovery.planningReadiness.ready, false, `${objective}/unresolvedOffer must remain blocked before execution`);
}

function conflictFixtureDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrationEngine(db, { logger() {} });
  const userId = Number(db.prepare("INSERT INTO users(email,name) VALUES('story-257-conflict@example.com','Story 257 Conflict')").run().lastInsertRowid);
  const remodel = acquisitionFixture(INDUSTRIES.remodeling);
  const product = launchFixture(INDUSTRIES.physicalProduct);
  promoteObjectiveMemory(db, { userId, objective: 'get_more_customers', referenceId: 'offer-one', understanding: remodel.understanding, answers: remodel.answers });
  promoteObjectiveMemory(db, { userId, objective: 'launch_product', referenceId: 'offer-two', understanding: product.understanding, answers: product.answers });
  return { db, userId };
}

(async function run() {
  assert.deepStrictEqual(OBJECTIVES, ['launch_product', 'get_more_customers', 'increase_conversion_rates', 'improve_search_rankings', 'build_brand', 'promote_service', 'validate_idea']);
  assert.strictEqual(OBJECTIVES.length * INDUSTRY_KEYS.length, 63);
  const conflict = conflictFixtureDb();
  const evidence = [];
  for (const objective of OBJECTIVES) {
    for (const industryKey of INDUSTRY_KEYS) {
      const decision = applicability(objective, industryKey);
      if (decision.mode === 'applicable') evidence.push(await exerciseApplicable(objective, industryKey));
      else if (decision.mode === 'planning_only') {
        assertUnresolvedPlanningOnly(objective);
        evidence.push({ objective, industryKey, status: decision.status, reason: decision.reason });
      } else if (decision.mode === 'conflict') {
        const resolution = resolveObjectiveSubjects(conflict.db, { userId: conflict.userId, initialDescription: 'Help this business with the selected objective.' });
        assert.strictEqual(resolution.requiresSelection, true, `${objective}/${industryKey}: explicit selection`);
        assert.strictEqual(resolution.offer, null);
        evidence.push({ objective, industryKey, status: decision.status, reason: decision.reason });
      } else {
        const kind = INDUSTRIES[industryKey].kind;
        if (objective === 'launch_product') assert(!PRODUCT_LAUNCH_KINDS.has(kind));
        if (objective === 'promote_service') assert.notStrictEqual(kind, 'service');
        evidence.push({ objective, industryKey, status: decision.status, reason: decision.reason });
      }
    }
  }
  conflict.db.close();
  assert.strictEqual(evidence.length, 63);
  assert(evidence.every(cell => ['PASS', 'SAFE_EXCLUSION'].includes(cell.status) && cell.reason));

  const memoryDb = new Database(':memory:');
  memoryDb.pragma('foreign_keys = ON');
  runMigrationEngine(memoryDb, { logger() {} });
  const userId = Number(memoryDb.prepare("INSERT INTO users(email,name) VALUES('story-257@example.com','Story 257')").run().lastInsertRowid);
  const remodel = acquisitionFixture(INDUSTRIES.remodeling);
  promoteObjectiveMemory(memoryDb, { userId, objective: 'get_more_customers', referenceId: 'remodeling-plan', answers: remodel.answers, understanding: remodel.understanding });
  const description = 'Monthly bookkeeping and reporting for independent agencies with plain-language monthly summaries.';
  const unrelatedService = resolveObjectiveSubjects(memoryDb, { userId, initialDescription: description });
  assert.strictEqual(unrelatedService.selection, 'new');
  assert.strictEqual(unrelatedService.offer, null);
  const newOfferMemory = memoryUnderstanding(memoryDb, { userId, objective: 'promote_service', initialDescription: description });
  assert.strictEqual(newOfferMemory.understanding.industry, undefined);
  assert.strictEqual(newOfferMemory.understanding.businessType, undefined);
  memoryDb.close();

  const summary = evidence.reduce((counts, cell) => { counts[cell.status] = (counts[cell.status] || 0) + 1; return counts; }, {});
  assert.strictEqual(summary.PASS + summary.SAFE_EXCLUSION, 63);
  const buildPlanView = fs.readFileSync(path.join(__dirname, '..', 'views', 'build-plan.ejs'), 'utf8');
  assert.match(buildPlanView, /build_brand: 'Save this plan and use the brand foundation/);
  assert.match(buildPlanView, /validate_idea: 'Save this plan and use the validation foundation/);
  assert.match(buildPlanView, /increase_conversion_rates: 'Save this plan and use the diagnostic and measurement foundation/);
  assert.doesNotMatch(buildPlanView, /establish the offer, audience, conversion action, capacity, or channel context needed/);
  console.log(`Story 3.257 executable matrix passed: ${summary.PASS} PASS, ${summary.SAFE_EXCLUSION} SAFE_EXCLUSION`);
})().catch(error => { console.error(error); process.exitCode = 1; });
