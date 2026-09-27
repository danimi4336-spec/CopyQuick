const assert = require('assert');
const { buildObjectiveInsights, dependencySemanticPayload, isUnresolvedValue, publicEligible } = require('../lib/objectiveInsights');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createProductionStrategySnapshot } = require('../lib/buildPlanApproval');
const { buildProductionContext } = require('../lib/generationService');
const { validateSemanticCoherence } = require('../lib/productionSemantics');

function fact(value, label = value, source = 'user_confirmed') {
  return { value, label, confidence: 1, source, semanticRole: source === 'user_confirmed' ? 'confirmed_fact' : 'inferred_fact' };
}

function publicContract(fields = ['body']) {
  return { id: 'semantic_fixture', readyToUse: true, publicFieldKeys: fields };
}

(function run() {
  const remodelerDescription = 'I own a residential remodeling company in Virginia. We specialize in kitchens, bathrooms, and whole-home renovations. Most of our work comes from referrals, but I want a more predictable way to get qualified local leads.';
  const acquisition = {
    businessType: fact('service', 'Service business'), acquisitionGoal: fact('qualified_leads', 'More qualified leads'),
    targetAudience: fact('homeowners', 'Homeowners'), currentAcquisitionChannel: fact('referrals', 'Referrals'),
    acquisitionStage: fact('inconsistent_traction', 'Some traction, but inconsistent'), salesProcess: fact('booked_call', 'Booked consultation'),
    capacityReadiness: fact('unsure', "I'm not sure yet")
  };
  const acquisitionAnswers = { initial_description: remodelerDescription };
  const acquisitionStrategy = buildStrategy({ objective: 'get_more_customers', understanding: acquisition, confirmedUnderstanding: acquisition, answers: acquisitionAnswers });
  assert.match(acquisitionStrategy.insights.businessObjective.value, /predictable.*qualified local leads/i);
  assert.strictEqual(acquisitionStrategy.insights.customerMotivation.unresolved, true);
  assert.strictEqual(acquisitionStrategy.insights.currentChannel.value, 'Referrals');
  assert.strictEqual(acquisitionStrategy.insights.recommendedChannel.unresolved, true);
  assert.strictEqual(acquisitionStrategy.strategy.customerMotivation.value, 'Unknown');
  assert.doesNotMatch(JSON.stringify(acquisitionStrategy.strategy), /homeowners[^.]{0,80}(?:want|need|focused on)[^.]{0,50}qualified leads/i);
  const acquisitionPlan = buildPlan({ objective: 'get_more_customers', confirmedUnderstanding: acquisition, strategyResult: acquisitionStrategy, answers: acquisitionAnswers });
  assert.deepStrictEqual(acquisitionPlan.phases.flatMap(phase => phase.deliverables).filter(item => item.readyToUse).map(item => item.id), []);
  assert.doesNotMatch(JSON.stringify(acquisitionPlan), /I own a residential remodeling company/);

  const conversion = {
    currentOffer: fact('Premium reusable insulated water bottles'), targetAudience: fact('Online shoppers'),
    trafficSource: fact('organic_search', 'Organic search'), funnelType: fact('purchase', 'Purchase or checkout'),
    pageExperience: fact('Visitors reach the product page but leave without buying'), primaryCta: fact('unsure', "I'm not sure yet"),
    conversionEvidence: fact('unsure', "I'm not sure yet"), conversionFriction: fact('Visitors leave without buying')
  };
  const conversionStrategy = buildStrategy({ objective: 'increase_conversion_rates', understanding: conversion, confirmedUnderstanding: conversion, answers: { initial_description: 'I sell premium reusable insulated water bottles online.' } });
  assert.match(conversionStrategy.insights.businessObjective.value, /conversion/i);
  assert.match(conversionStrategy.insights.conversionAction.value, /purchase/i);
  assert.match(conversionStrategy.insights.observedFriction.value, /leave without buying/i);
  assert.strictEqual(conversionStrategy.insights.customerMotivation.unresolved, true);
  assert.strictEqual(conversionStrategy.insights.customerFacingCta.unresolved, true);
  assert.doesNotMatch(Object.values(conversionStrategy.strategy).map(item => item.value).join(' '), /lead quality|scaling spend|acquisition path/i);
  const conversionPlan = buildPlan({ objective: 'increase_conversion_rates', confirmedUnderstanding: conversion, strategyResult: conversionStrategy, answers: {} });
  assert.deepStrictEqual(conversionPlan.phases.flatMap(phase => phase.deliverables).map(item => item.id), ['conversion_diagnostic_brief', 'conversion_page_brief', 'conversion_measurement_plan']);

  const search = {
    websiteContext: fact('Accounting software for small businesses'), targetAudience: fact('Small-business owners'),
    searchGoal: fact('authority', 'Build organic authority'), suppliedKeywords: fact('bookkeeping; invoicing; cash flow'),
    existingContent: fact('Some articles'), searchEvidence: fact('unsure', "I'm not sure yet"), primaryCta: fact('unsure', "I'm not sure yet")
  };
  const searchStrategy = buildStrategy({ objective: 'improve_search_rankings', understanding: search, confirmedUnderstanding: search, answers: { initial_description: 'I run an online accounting software company for small businesses.' } });
  assert.strictEqual(searchStrategy.insights.searchGoal.value, 'Build organic authority');
  assert.match(searchStrategy.insights.topicTerritory.value, /bookkeeping.*invoicing.*cash flow/i);
  assert.strictEqual(searchStrategy.insights.customerMotivation.unresolved, true);
  const searchPlan = buildPlan({ objective: 'improve_search_rankings', confirmedUnderstanding: search, strategyResult: searchStrategy, answers: {} });
  assert.deepStrictEqual(searchPlan.phases.flatMap(phase => phase.deliverables).map(item => item.id), ['search_evidence_snapshot', 'search_strategy', 'priority_content_brief', 'search_measurement_plan']);
  assert.doesNotMatch(JSON.stringify(searchPlan), /Acquisition Snapshot|Acquisition Channel Strategy/);

  [null, 'unsure', 'unknown', "I'm not sure yet", 'not established', 'needs confirmation'].forEach(value => assert.strictEqual(isUnresolvedValue(value), true));
  assert.strictEqual(publicEligible(conversionStrategy.insights.customerFacingCta), false);
  const safeConditional = validateSemanticCoherence({ body: 'Choose the primary CTA after confirming the purchase path.' }, publicContract(), { semanticInsights: conversionStrategy.insights });
  assert.strictEqual(safeConditional.valid, true);
  assert.strictEqual(validateSemanticCoherence({ body: "CTA: I'm not sure yet" }, publicContract(), { semanticInsights: conversionStrategy.insights }).code, 'PRODUCTION_QUALITY_UNRESOLVED_SEMANTIC_INPUT');
  assert.strictEqual(validateSemanticCoherence({ body: 'Homeowners who want more qualified leads can get started today.' }, publicContract(), { semanticInsights: acquisitionStrategy.insights }).code, 'PRODUCTION_QUALITY_SEMANTIC_ROLE_MISUSE');
  assert.strictEqual(validateSemanticCoherence({ body: 'Why did getting more qualified leads become a priority for you?' }, publicContract(), { semanticInsights: acquisitionStrategy.insights }).code, 'PRODUCTION_QUALITY_SEMANTIC_ROLE_MISUSE');
  assert.strictEqual(validateSemanticCoherence({ body: `Message: ${remodelerDescription}` }, publicContract(), { semanticInsights: acquisitionStrategy.insights }).code, 'PRODUCTION_QUALITY_RAW_DESCRIPTION_LEAK');
  assert.strictEqual(validateSemanticCoherence({ body: 'Our recommended channel is Referrals.' }, publicContract(), { semanticInsights: acquisitionStrategy.insights }).code, 'PRODUCTION_QUALITY_CHANNEL_PROVENANCE');
  assert.strictEqual(validateSemanticCoherence({ body: 'Readers need to build organic authority.' }, publicContract(), { semanticInsights: searchStrategy.insights }).code, 'PRODUCTION_QUALITY_SEARCH_GOAL_AS_CUSTOMER_NEED');
  assert.strictEqual(validateSemanticCoherence({ body: 'Homeowners want a clearer way to compare renovation scope and next steps.' }, publicContract(), { semanticInsights: acquisitionStrategy.insights }).valid, true);

  const snapshot = createProductionStrategySnapshot({ objective: 'get_more_customers', strategyResult: acquisitionStrategy, confirmedUnderstanding: acquisition });
  const context = buildProductionContext({
    productionRun: { objective: 'get_more_customers', strategySnapshot: snapshot },
    job: { deliverable_id: 'acquisition_snapshot', title: 'Snapshot', strategic_direction: 'Diagnose the current system.' },
    dependencyOutputs: [{ deliverableId: 'customer_profile', title: 'Customer Profile', output: { summary: 'Planning guidance' } }]
  });
  assert.match(context.strategyText, /business objective: Create a more predictable source of qualified local leads \(confirmed_fact\)/i);
  assert.match(context.strategyText, /customer motivation: Not established \(unresolved\)/i);
  assert.doesNotMatch(context.strategyText, /I own a residential remodeling company/i);
  assert.strictEqual(context.dependencyOutputs[0].semanticPayload.currentChannel.value, 'Referrals');
  assert.strictEqual(context.dependencyOutputs[0].semanticPayload.recommendedChannel.unresolved, true);
  assert.deepStrictEqual(dependencySemanticPayload(acquisitionStrategy.insights).businessObjective.concept, 'business_objective');

  const supplement = buildObjectiveInsights({ objective: 'launch_product', understanding: {
    productExplorationDirections: { value: ['microbiome', 'comfort', 'enzymes'], label: 'Gut microbiome support; Bloating & digestive comfort; Digestive enzyme support', semanticRole: 'exploration_intent', source: 'user_confirmed' }
  }, answers: {} });
  assert.strictEqual(supplement.explorationIntent.provenance, 'exploration_intent');
  assert.strictEqual(supplement.explorationIntent.permittedUses.includes('public_copy'), false);
  assert.strictEqual(validateSemanticCoherence({ body: 'Our formula contains digestive enzymes and improves digestive comfort.' }, publicContract(), { semanticInsights: supplement }).code, 'PRODUCTION_QUALITY_EXPLORATION_AS_FACT');

  const sameChannel = buildObjectiveInsights({ objective: 'get_more_customers', understanding: {
    currentAcquisitionChannel: fact('referrals', 'Referrals'), recommendedChannel: fact('referrals', 'Referrals')
  }, answers: {} });
  assert.strictEqual(sameChannel.currentChannel.value, 'Referrals');
  assert.strictEqual(sameChannel.recommendedChannel.value, 'Referrals');
  assert.strictEqual(validateSemanticCoherence({ body: 'The recommended channel is Referrals.' }, publicContract(), { semanticInsights: sameChannel }).valid, true);

  console.log('Story 3.232 objective semantic insight tests passed');
})();
