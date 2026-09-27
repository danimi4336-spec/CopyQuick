const assert = require('assert');
const { evaluateRequirements, UNCERTAINTY_POLICIES } = require('../lib/discoveryRequirements');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { buildBusinessReflection } = require('../lib/businessReflection');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { getProductionContract } = require('../lib/productionContracts');
const { validateSemanticCoherence } = require('../lib/productionSemantics');

function fact(value, label = value) {
  return { value, label, confidence: value === 'unsure' ? 0 : 1, source: 'user_confirmed', semanticRole: value === 'unsure' ? 'unresolved_input' : 'confirmed_fact' };
}

function answerMap(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === 'unsure' ? 'unsure' : { value }]));
}

(function run() {
  const conversion = {
    currentOffer: fact('Premium reusable insulated water bottles'),
    targetAudience: fact('Online shoppers'),
    trafficSource: fact('unsure', "I'm not sure yet"),
    funnelType: fact('purchase', 'Purchase online'),
    pageExperience: fact('unsure', "I'm not sure yet"),
    primaryCta: fact('unsure', "I'm not sure yet"),
    conversionEvidence: fact('unsure', "I'm not sure yet"),
    conversionFriction: fact('unsure', "I'm not sure yet")
  };
  const conversionAnswers = answerMap({
    conversion_offer: conversion.currentOffer.value,
    conversion_audience: conversion.targetAudience.value,
    conversion_traffic: 'unsure', conversion_funnel: 'purchase', conversion_page: 'unsure',
    conversion_cta: 'unsure', conversion_evidence: 'unsure', conversion_friction: 'unsure'
  });
  conversionAnswers.initial_description = 'I sell premium reusable insulated water bottles online. We get traffic to the product page, but too many visitors leave without buying.';

  const conversionReadiness = evaluateRequirements({ objective: 'increase_conversion_rates', understanding: conversion, answers: conversionAnswers });
  assert.strictEqual(conversionReadiness.ready, true);
  assert.strictEqual(conversionReadiness.nextQuestion, null, 'explicit unsure answers must not cause an identical-question loop');
  assert(conversionReadiness.diagnosableUnknowns.some(item => item.id === 'traffic'));
  assert(conversionReadiness.diagnosableUnknowns.some(item => item.id === 'cta'));
  assert(conversionReadiness.diagnosableUnknowns.some(item => item.id === 'friction'));
  assert(conversionReadiness.deferrableUnknowns.some(item => item.id === 'evidence'));
  assert.strictEqual(conversionReadiness.requirements.find(item => item.id === 'traffic').uncertaintyPolicy, UNCERTAINTY_POLICIES.DIAGNOSTIC);

  const blocked = evaluateRequirements({
    objective: 'increase_conversion_rates',
    understanding: { ...conversion, currentOffer: fact('unsure') },
    answers: { ...conversionAnswers, conversion_offer: 'unsure' }
  });
  assert.strictEqual(blocked.ready, false, 'an execution-required offer must still block unsafe execution');
  assert(blocked.executionRequiredUnknowns.some(item => item.id === 'offer'));

  const discovery = analyzeDiscovery({ objective: 'increase_conversion_rates', understanding: conversion, answers: conversionAnswers });
  assert.strictEqual(discovery.nextQuestion, null);
  assert.strictEqual(discovery.planningReadiness.ready, true);
  const reflection = buildBusinessReflection({ objective: 'increase_conversion_rates', understanding: conversion, answers: conversionAnswers, planningReadiness: discovery.planningReadiness });
  const reflectedTraffic = reflection.groups.flatMap(group => group.fields).find(field => field.key === 'trafficSource');
  assert.strictEqual(reflectedTraffic.value, 'Not established yet');
  assert.match(reflectedTraffic.confidenceMessage, /help determine this during planning/i);
  assert(reflection.diagnosableUnknowns.some(item => item.domain === 'Traffic Source'));

  const conversionStrategy = buildStrategy({ objective: 'increase_conversion_rates', understanding: conversion, confirmedUnderstanding: conversion, answers: conversionAnswers });
  assert.strictEqual(conversionStrategy.status, 'Strategy Ready — Diagnostic Work Needed');
  assert.match(JSON.stringify(conversionStrategy.recommendations), /value clarity.*trust.*shipping.*CTA clarity.*checkout friction/i);
  assert.doesNotMatch(JSON.stringify(conversionStrategy), /shipping is the problem|trust is the problem/i);
  const conversionPlan = buildPlan({ objective: 'increase_conversion_rates', confirmedUnderstanding: conversion, strategyResult: conversionStrategy, answers: conversionAnswers });
  assert.strictEqual(conversionPlan.readiness.ready, true);
  assert.deepStrictEqual(conversionPlan.phases.flatMap(phase => phase.deliverables).map(item => item.id), [
    'conversion_diagnostic_brief', 'conversion_page_brief', 'conversion_measurement_plan'
  ]);
  assert.strictEqual(conversionPlan.phases.flatMap(phase => phase.deliverables).some(item => item.readyToUse), false);

  const productionContext = { objective: 'increase_conversion_rates', strategySnapshot: conversionStrategy.strategy, strategicDirection: 'Diagnose before prescribing execution copy.', dependencyOutputs: [] };
  const diagnostic = getProductionContract('conversion_diagnostic_brief').generateOutput(productionContext);
  assert.match(JSON.stringify(diagnostic), /Check whether value clarity.*shipping.*CTA clarity.*checkout friction/i);
  assert.match(JSON.stringify(diagnostic), /hypothesis until/i);
  const pageBrief = getProductionContract('conversion_page_brief').generateOutput(productionContext);
  assert.match(JSON.stringify(pageBrief), /CTA or page experience is not established/i);
  assert.match(JSON.stringify(pageBrief), /planning guidance/i);
  const measurement = getProductionContract('conversion_measurement_plan').generateOutput(productionContext);
  assert.match(JSON.stringify(measurement), /product-page sessions.*add-to-cart rate.*purchase completion/i);
  assert.doesNotMatch(JSON.stringify(measurement), /\b\d+(?:\.\d+)?%\b/);

  const acquisition = {
    businessType: fact('service', 'Service business'), acquisitionGoal: fact('qualified_leads', 'More qualified leads'),
    targetAudience: fact('homeowners', 'Homeowners'), currentAcquisitionChannel: fact('referrals', 'Referrals'),
    acquisitionStage: fact('inconsistent_traction', 'Some traction, but inconsistent'), salesProcess: fact('booked_call', 'Booked consultation'),
    capacityReadiness: fact('unsure', "I'm not sure yet")
  };
  const acquisitionAnswers = answerMap({ business_type: 'service', acquisition_goal: 'qualified_leads', acquisition_target: 'homeowners', acquisition_channel: 'referrals', acquisition_stage: 'inconsistent_traction', sales_process: 'booked_call', capacity_readiness: 'unsure' });
  acquisitionAnswers.initial_description = 'I own a residential remodeling company in Virginia. Most work comes from referrals, but I want predictable qualified local leads.';
  const acquisitionReadiness = evaluateRequirements({ objective: 'get_more_customers', understanding: acquisition, answers: acquisitionAnswers });
  assert.strictEqual(acquisitionReadiness.ready, true);
  assert.strictEqual(acquisitionReadiness.nextQuestion, null);
  assert.strictEqual(acquisitionReadiness.requirements.find(item => item.id === 'capacity').uncertaintyPolicy, UNCERTAINTY_POLICIES.DIAGNOSTIC);
  const acquisitionStrategy = buildStrategy({ objective: 'get_more_customers', understanding: acquisition, confirmedUnderstanding: acquisition, answers: acquisitionAnswers });
  assert.strictEqual(acquisitionStrategy.status, 'Strategy Ready — Diagnostic Work Needed');
  assert.match(JSON.stringify(acquisitionStrategy), /Estimate safe acquisition capacity before scaling/i);
  assert.match(JSON.stringify(acquisitionStrategy), /active projects.*project duration.*crew availability.*consultation capacity.*backlog/i);
  assert.doesNotMatch(JSON.stringify(acquisitionStrategy), /\$\d|\b\d+ leads per|\b\d+ consultations per/i);
  assert.strictEqual(acquisitionStrategy.insights.customerMotivation.unresolved, true);
  assert.strictEqual(acquisitionStrategy.insights.currentChannel.value, 'Referrals');
  assert.strictEqual(acquisitionStrategy.insights.recommendedChannel.unresolved, true);
  const acquisitionPlan = buildPlan({ objective: 'get_more_customers', confirmedUnderstanding: acquisition, strategyResult: acquisitionStrategy, answers: acquisitionAnswers });
  assert.strictEqual(acquisitionPlan.readiness.ready, true);
  assert(acquisitionPlan.phases.flatMap(phase => phase.deliverables).some(item => item.id === 'acquisition_snapshot'));
  assert.deepStrictEqual(acquisitionPlan.phases.flatMap(phase => phase.deliverables).filter(item => item.readyToUse).map(item => item.id), []);
  assert.match(JSON.stringify(acquisitionPlan), /estimate safe delivery and consultation capacity/i);

  const publicContract = { id: 'uncertainty_fixture', readyToUse: true, publicFieldKeys: ['body'] };
  assert.strictEqual(validateSemanticCoherence({ body: "CTA: I'm not sure yet" }, publicContract, { semanticInsights: conversionStrategy.insights }).valid, false);
  assert.strictEqual(validateSemanticCoherence({ body: 'Choose the primary CTA after confirming the purchase path.' }, publicContract, { semanticInsights: conversionStrategy.insights }).valid, true);

  console.log('Story 3.233 diagnostic uncertainty path tests passed');
})();
