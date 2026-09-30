const assert = require('assert');
const { understandBusiness, classifyWithRules, audienceFromDescription } = require('../lib/businessUnderstanding');
const { MODES, resolveConversionMode } = require('../lib/conversionMode');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createDefaultSelection, createApprovedProductionSet, planFingerprint } = require('../lib/buildPlanApproval');
const { getProductionContract } = require('../lib/productionContracts');
const { minimumProductionDependencies } = require('../lib/productionDependencyPolicy');
const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { buildSynthesisContext } = require('../lib/productionDependencySynthesis');
const { generateDeliverable } = require('../lib/generationService');

function fact(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' };
}

(async function run() {
  const description = 'I want more website visitors to book a consultation for our residential remodeling business in Virginia.';
  const inferred = await understandBusiness({ objective: 'increase_conversion_rates', answer: description });
  assert.strictEqual(inferred.understanding.businessType.value, 'service');
  assert.strictEqual(inferred.understanding.industry.value, 'home_services');
  assert.strictEqual(inferred.understanding.category.value, 'residential_remodeling');
  assert.strictEqual(inferred.understanding.funnelType.value, 'booked_call');
  assert.match(inferred.understanding.primaryCta.value, /book a consultation/i);
  assert(!inferred.understanding.targetAudience, 'the business object must not become the audience');
  assert.strictEqual(audienceFromDescription(description, 'increase_conversion_rates'), '');
  assert.strictEqual(audienceFromDescription('We serve homeowners planning major renovations.', 'increase_conversion_rates'), 'homeowners planning major renovations');
  assert.notStrictEqual(classifyWithRules('A construction materials ecommerce store').businessType.value, 'service');
  assert.notStrictEqual(classifyWithRules('A home renovation course for new designers').businessType.value, 'service');
  assert.strictEqual(classifyWithRules('A renovation contractor serving homeowners').category.value, 'residential_remodeling');
  assert.strictEqual(classifyWithRules('A kitchen remodeling company').industry.value, 'home_services');
  assert.strictEqual(classifyWithRules('A bathroom renovation service').businessType.value, 'service');

  const understanding = {
    businessType: fact('service', 'Service Business'), industry: fact('home_services', 'Home Services'),
    category: fact('residential_remodeling', 'Residential Remodeling'),
    currentOffer: fact('Residential remodeling consultations'),
    targetAudience: fact('Homeowners planning major renovations'),
    trafficSource: fact('referrals', 'Referrals'), funnelType: fact('booked_call', 'Book a consultation'),
    primaryCta: fact('Book a consultation'),
    pageExperience: fact('A service page introducing residential remodeling work'),
    conversionEvidence: fact('unsure', "I'm not sure yet"), conversionFriction: fact('unsure', "I'm not sure yet")
  };
  assert.strictEqual(resolveConversionMode(understanding), MODES.SERVICE_CONSULTATION);
  assert.strictEqual(resolveConversionMode({ businessType: fact('software'), funnelType: fact('trial_signup') }), MODES.SAAS_TRIAL_SIGNUP);
  assert.strictEqual(resolveConversionMode({ businessType: fact('physical_product'), funnelType: fact('purchase') }), MODES.ECOMMERCE_PURCHASE);
  assert.strictEqual(resolveConversionMode({ businessType: fact('service'), funnelType: fact('contact_form') }), MODES.LEAD_CAPTURE);
  assert.strictEqual(resolveConversionMode({ businessType: fact('service'), funnelType: fact('unsure') }), MODES.UNRESOLVED);

  const strategy = buildStrategy({ objective: 'increase_conversion_rates', understanding, confirmedUnderstanding: understanding, answers: { initial_description: description } });
  assert.strictEqual(strategy.conversionMode, MODES.SERVICE_CONSULTATION);
  assert.match(strategy.strategy.launchApproach.value, /service fit.*consultation process.*booking path/i);
  assert.doesNotMatch(JSON.stringify(strategy), /shopper|shipping|returns|checkout|purchase behavior|product comprehension/i);
  assert.match(JSON.stringify(strategy), /hypotheses|hypothesis/i);

  const plan = buildPlan({ objective: 'increase_conversion_rates', confirmedUnderstanding: understanding, strategyResult: strategy, answers: {} });
  const items = plan.phases.flatMap(phase => phase.deliverables);
  assert.deepStrictEqual(items.map(item => item.id), [
    'conversion_diagnostic_brief', 'consultation_conversion_brief', 'consultation_conversion_page_copy', 'conversion_measurement_plan'
  ]);
  assert.strictEqual(items.find(item => item.id === 'consultation_conversion_page_copy').recommendationLevel, 'recommended');
  assert.strictEqual(items.filter(item => getProductionArtifactPolicy(item.id)?.readyToUse).length, 1);
  assert.strictEqual(plan.summary.requiresReadyAsset, true);
  assert.doesNotMatch(JSON.stringify(plan), /Product-Page|shipping|returns|checkout|shopper/i);
  assert.deepStrictEqual(minimumProductionDependencies('consultation_conversion_brief'), ['conversion_diagnostic_brief']);
  assert.deepStrictEqual(minimumProductionDependencies('consultation_conversion_page_copy'), ['consultation_conversion_brief']);
  assert.strictEqual(getProductionArtifactPolicy('consultation_conversion_brief').billingUnits, 0);
  assert.strictEqual(getProductionArtifactPolicy('consultation_conversion_page_copy').billingUnits, 1);

  const selection = createDefaultSelection(plan);
  assert(selection.selectedDeliverableIds.includes('consultation_conversion_page_copy'));
  assert(selection.selectedDeliverableIds.includes('consultation_conversion_brief'));
  const approval = createApprovedProductionSet({ plan, selection, strategyResult: strategy, confirmedUnderstanding: understanding });
  assert.strictEqual(approval.valid, true);
  assert.strictEqual(approval.productionSet.strategySnapshot.conversionMode, MODES.SERVICE_CONSULTATION);
  assert(approval.productionSet.productionOrder.indexOf('consultation_conversion_brief') < approval.productionSet.productionOrder.indexOf('consultation_conversion_page_copy'));
  const planningOnly = createApprovedProductionSet({
    plan,
    selection: { planFingerprint: planFingerprint(plan), selectedDeliverableIds: ['conversion_diagnostic_brief'], requiredDependencyIds: [] },
    strategyResult: strategy,
    confirmedUnderstanding: understanding
  });
  assert.strictEqual(planningOnly.valid, false);
  assert.match(planningOnly.error, /ready-for-review asset/i);

  const briefContract = getProductionContract('consultation_conversion_brief');
  const articleContract = getProductionContract('consultation_conversion_page_copy');
  assert.strictEqual(briefContract.version, 'consultation_conversion_brief:v1');
  assert.strictEqual(articleContract.version, 'consultation_conversion_page_copy:v1');
  assert.strictEqual(articleContract.title, 'Consultation Conversion Page Copy');
  assert.strictEqual(articleContract.readyToUse, true);
  assert.strictEqual(articleContract.validationProfile.family, 'service_conversion');
  const context = {
    objective: 'increase_conversion_rates', title: articleContract.title,
    strategicDirection: 'Help qualified homeowners book a remodeling consultation.',
    strategySnapshot: approval.productionSet.strategySnapshot,
    semanticInsights: strategy.insights,
    dependencyOutputs: []
  };
  const brief = briefContract.generateOutput({ ...context, title: briefContract.title });
  assert.strictEqual(briefContract.validateOutput(brief), true);
  const diagnostic = getProductionContract('conversion_diagnostic_brief').generateOutput({ ...context, title: 'Conversion Diagnostic Brief' });
  assert.match(JSON.stringify(diagnostic), /consultation interest.*completed booking/i);
  assert.doesNotMatch(JSON.stringify(diagnostic), /add to cart|checkout|purchase completion|shipping|returns/i);
  context.dependencyOutputs = [{ deliverableId: 'consultation_conversion_brief', title: briefContract.title, output: brief }];
  context.synthesis = buildSynthesisContext({ dependentId: articleContract.id, dependencyOutputs: context.dependencyOutputs, strategySnapshot: context.strategySnapshot, semanticInsights: context.semanticInsights, contractVersion: articleContract.version });
  context.synthesisSummary = context.synthesis.summary;
  assert.deepStrictEqual(context.synthesis.missing, []);
  const page = articleContract.generateOutput(context);
  assert.strictEqual(articleContract.validateOutput(page, context), true);
  assert.strictEqual(validateCustomerReadyOutput(page, articleContract, context).valid, true);
  assert.strictEqual(page.primaryCallToAction, 'Book a consultation');
  assert.strictEqual(page.finalCallToAction, 'Book a consultation');
  assert.match(page.heroSupportingCopy, /Residential remodeling consultations.*Homeowners planning major renovations/i);
  assert.doesNotMatch(JSON.stringify(page), /shopper|shipping|returns|checkout|add to cart|product comprehension/i);
  assert.doesNotMatch(JSON.stringify(page), /\d+ years|\d+ projects|award-winning|licensed and insured|guaranteed|financing available/i);
  assert(articleContract.presentationSections(page).some(section => section.key === 'heroHeadline' && !section.internal));
  assert(articleContract.presentationSections(page).some(section => section.key === 'editorialReviewNotes' && section.internal));
  assert(!articleContract.publicFieldKeys.includes('editorialReviewNotes'));
  assert.match(articleContract.buildPrompt(context), /Do not invent years in business/i);

  const generated = await generateDeliverable({
    handler: articleContract,
    productionRun: { objective: 'increase_conversion_rates', strategySnapshot: approval.productionSet.strategySnapshot },
    job: { deliverable_id: articleContract.id, title: articleContract.title, strategic_direction: context.strategicDirection, contract_version: articleContract.version },
    dependencyOutputs: context.dependencyOutputs
  });
  assert.strictEqual(generated.structuredOutput.primaryCallToAction, 'Book a consultation');
  assert.strictEqual(articleContract.validateOutput(generated.structuredOutput), true);

  const unresolvedUnderstanding = { currentOffer: fact('A professional service'), targetAudience: fact('Local businesses'), funnelType: fact('unsure') };
  const unresolvedStrategy = buildStrategy({ objective: 'increase_conversion_rates', understanding: unresolvedUnderstanding, confirmedUnderstanding: unresolvedUnderstanding, answers: {} });
  const unresolvedPlan = buildPlan({ objective: 'increase_conversion_rates', confirmedUnderstanding: unresolvedUnderstanding, strategyResult: unresolvedStrategy, answers: {} });
  assert.deepStrictEqual(unresolvedPlan.phases.flatMap(phase => phase.deliverables).map(item => item.id), ['conversion_diagnostic_brief', 'conversion_measurement_plan']);
  assert.doesNotMatch(JSON.stringify(unresolvedPlan), /product-page|shipping|checkout/i);

  assert.strictEqual(validateCustomerReadyOutput({ ...page, servicesSection: 'Shoppers can proceed to checkout with free returns.' }, articleContract, context).valid, false);
  assert.strictEqual(validateCustomerReadyOutput({ ...page, trustSection: 'Award-winning and trusted for 25 years.' }, articleContract, context).valid, false);
  assert.strictEqual(validateCustomerReadyOutput({ ...page, primaryCallToAction: '' }, articleContract, context).valid, false);

  const measurement = getProductionContract('conversion_measurement_plan').generateOutput({ ...context, title: 'Conversion Measurement Plan' });
  assert.match(JSON.stringify(measurement), /form starts.*booking completions/i);
  assert.doesNotMatch(JSON.stringify(measurement), /add.to.cart|checkout|purchase completion/i);

  console.log('Story 3.242 service-aware conversion execution tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
