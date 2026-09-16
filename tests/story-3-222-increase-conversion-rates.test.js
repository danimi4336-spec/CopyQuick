const assert = require('assert');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { getAvailableObjective } = require('../lib/objectiveFramework');
const { buildBusinessReflection } = require('../lib/businessReflection');
const { createApprovedProductionSet, createDefaultSelection } = require('../lib/buildPlanApproval');

function fact(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' };
}

(async function run() {
  const objective = 'increase_conversion_rates';
  assert(getAvailableObjective(objective));
  const understanding = {
    currentOffer: fact('A 14-day team scheduling trial'),
    targetAudience: fact('Operations leaders at growing software companies'),
    trafficSource: fact('paid_ads', 'Paid advertising'),
    funnelType: fact('trial_signup', 'Start a trial or account'),
    pageExperience: fact('A pricing page with a feature list but little explanation of setup or team adoption'),
    primaryCta: fact('Start free trial'),
    conversionEvidence: fact('unsure', "I'm not sure yet"),
    conversionFriction: fact('Prospects ask whether setup requires technical help')
  };
  const answers = {
    initial_description: 'A scheduling SaaS pricing page receiving paid traffic',
    conversion_offer: { value: understanding.currentOffer.value },
    conversion_audience: { value: understanding.targetAudience.value },
    conversion_traffic: 'paid_ads', conversion_funnel: 'trial_signup',
    conversion_page: { value: understanding.pageExperience.value },
    conversion_cta: { value: understanding.primaryCta.value },
    conversion_evidence: 'unsure', conversion_friction: { value: understanding.conversionFriction.value }
  };
  const runtime = createObjectiveRuntime(objective);
  const discovery = runtime.discovery.analyze({ understanding, answers, unknowns: [] });
  assert.strictEqual(discovery.planningReadiness.ready, true);
  const reflection = buildBusinessReflection({ objective, understanding, answers, planningReadiness: discovery.planningReadiness });
  assert(reflection.groups.some(group => group.domain === 'Available Evidence'));
  const strategy = runtime.strategy.build({ understanding, confirmedUnderstanding: understanding, answers });
  assert.match(strategy.status, /Conversion Hypotheses/);
  assert.strictEqual(strategy.strategy.primaryCustomer.semanticRole, 'confirmed_fact');
  assert.match(strategy.strategy.marketingFocus.value, /experiments/i);
  assert.doesNotMatch(JSON.stringify(strategy), /conversion rate (?:is|of) \d|statistically significant/i);

  const plan = runtime.buildPlan({ confirmedUnderstanding: understanding, strategyResult: strategy, answers });
  assert.strictEqual(plan.readiness.ready, true);
  assert.deepStrictEqual(plan.phases.map(phase => phase.title), ['Diagnose Conversion', 'Improve Offer & Page', 'Test & Measure']);
  const items = plan.phases.flatMap(phase => phase.deliverables);
  assert.deepStrictEqual(items.map(item => item.id), [
    'acquisition_snapshot', 'acquisition_channel_strategy', 'campaign_brief',
    'conversion_path_brief', 'lead_capture_page', 'acquisition_measurement_plan',
    'acquisition_experiment_backlog'
  ]);

  const approval = createApprovedProductionSet({
    plan,
    selection: createDefaultSelection(plan),
    strategyResult: strategy,
    confirmedUnderstanding: understanding
  });
  assert.strictEqual(approval.valid, true);
  const productionStrategy = approval.productionSet.strategySnapshot;
  assert.strictEqual(productionStrategy.confirmedOffer.value, understanding.currentOffer.value);
  assert.strictEqual(productionStrategy.confirmedPrimaryCta.value, 'Start free trial');
  assert.strictEqual(productionStrategy.builderDescribedPageExperience.value, understanding.pageExperience.value);
  assert.strictEqual(productionStrategy.observedConversionFriction.value, understanding.conversionFriction.value);

  const completed = new Map();
  for (const item of items) {
    const contract = runtime.production.contract(item.id);
    const dependencies = item.dependencies.map(id => ({
      deliverableId: id, title: items.find(candidate => candidate.id === id)?.title || id,
      contractVersion: runtime.production.contract(id).version, output: completed.get(id)
    }));
    const generated = await runtime.generation.generate({
      job: { deliverable_id: item.id, title: item.title, strategic_direction: item.strategicDirection, strategySnapshot: productionStrategy },
      productionRun: { objective, strategySnapshot: productionStrategy }, dependencyOutputs: dependencies, handler: contract
    });
    assert.strictEqual(runtime.validation.validate(generated.structuredOutput, contract).valid, true, item.id);
    const visible = JSON.stringify(generated.structuredOutput);
    assert.doesNotMatch(visible, /production contract|output schema|system prompt|orchestration|internal id/i);
    assert.doesNotMatch(visible, /conversion rate (?:is|of) \d|\d+% conversion/i);
    completed.set(item.id, generated.structuredOutput);
  }
  const landing = completed.get('lead_capture_page');
  assert(landing.headline && landing.primaryCallToAction && landing.faq.length);
  assert.strictEqual(landing.primaryCallToAction, 'Start free trial');
  const landingContract = runtime.production.contract('lead_capture_page');
  const landingPrompt = landingContract.buildPrompt({
    objective, title: 'Lead Capture Page', strategicDirection: 'Improve the page',
    strategySnapshot: productionStrategy, dependencyOutputs: []
  });
  assert.match(landingPrompt, /primaryCallToAction must be exactly "Start free trial"/);
  assert.match(landingPrompt, /supplied context, not proof of customer behavior/i);
  assert.match(landingPrompt, /public landing-page copy/i);
  const sections = landingContract.presentationSections(landing);
  assert.strictEqual(sections.find(section => section.key === 'publishingChecklist').internal, true);
  assert.strictEqual(sections.find(section => section.key === 'pageGoal').internal, true);
  assert.strictEqual(sections.find(section => section.key === 'headline').internal, false);

  console.log('Story 3.222 Increase Conversion Rates tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
