const assert = require('assert');
const {
  OBJECTIVE_DEFINITIONS,
  REQUIRED_OBJECTIVE_CAPABILITIES,
  getAvailableObjective,
  hasCompleteJourney,
  objectiveUniverse
} = require('../lib/objectiveFramework');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' };
}

function launchFixture() {
  const understanding = {
    businessType: confirmed('physical_product', 'Physical Product'),
    industry: confirmed('health_wellness', 'Health & Wellness'),
    category: confirmed('dietary_supplement', 'Dietary Supplement'),
    intendedOutcome: confirmed('digestive_wellness', 'Digestive health'),
    conceptMaturity: confirmed('idea_only', 'I only have the product idea'),
    targetAudience: confirmed('busy adults', 'Busy adults'),
    launchStage: confirmed('idea', 'Idea or early concept'),
    salesChannel: confirmed('amazon', 'Amazon')
  };
  return {
    understanding,
    answers: {
      initial_description: 'A digestive wellness supplement idea for busy adults',
      business_type: 'physical_product', supplement_intended_outcome: 'digestive_wellness',
      supplement_concept_maturity: 'idea_only', target_audience: 'busy adults',
      launch_stage: 'idea', sales_channel: 'amazon'
    }
  };
}

function acquisitionFixture() {
  const understanding = {
    businessType: confirmed('service', 'Service Business'),
    acquisitionGoal: confirmed('qualified_leads', 'More qualified leads'),
    targetAudience: confirmed('small businesses', 'Small businesses'),
    currentAcquisitionChannel: confirmed('referrals', 'Referrals'),
    acquisitionStage: confirmed('inconsistent_traction', 'Some traction, but inconsistent'),
    salesProcess: confirmed('booked_call', 'Booked call or appointment'),
    capacityReadiness: confirmed('capacity_ready', 'Ready to serve more customers')
  };
  return {
    understanding,
    answers: {
      initial_description: 'A bookkeeping service seeking qualified small-business leads',
      business_type: 'service', acquisition_goal: 'qualified_leads',
      acquisition_target: { value: 'small businesses' }, acquisition_channel: 'referrals',
      acquisition_stage: 'inconsistent_traction', sales_process: 'booked_call',
      capacity_readiness: 'capacity_ready'
    }
  };
}

(async function run() {
  assert.deepStrictEqual(
    objectiveUniverse.filter(item => item.available).map(item => item.id),
    ['launch_product', 'get_more_customers', 'increase_conversion_rates', 'improve_search_rankings', 'build_brand', 'promote_service', 'validate_idea']
  );
  for (const definition of OBJECTIVE_DEFINITIONS.filter(item => item.available)) {
    assert.strictEqual(hasCompleteJourney(definition), true);
    REQUIRED_OBJECTIVE_CAPABILITIES.forEach(capability => {
      assert(definition.journey[capability]?.policy, `${definition.id} must declare ${capability}`);
    });
  }
  assert.strictEqual(getAvailableObjective('more_objectives'), null,
    'metadata alone cannot make an incomplete objective executable');
  assert.throws(() => createObjectiveRuntime('more_objectives'), error => error.code === 'OBJECTIVE_JOURNEY_UNAVAILABLE');

  for (const [objective, fixture] of [
    ['launch_product', launchFixture()],
    ['get_more_customers', acquisitionFixture()]
  ]) {
    const runtime = createObjectiveRuntime(objective);
    assert(runtime.discovery.requirements(fixture.understanding).length > 0);
    const discovery = runtime.discovery.analyze({
      understanding: fixture.understanding, answers: fixture.answers, unknowns: []
    });
    assert.strictEqual(discovery.planningReadiness.ready, true, `${objective} Discovery remains ready`);
    const strategy = runtime.strategy.build({
      understanding: fixture.understanding,
      confirmedUnderstanding: fixture.understanding,
      answers: fixture.answers
    });
    assert(strategy.strategy, `${objective} Strategy remains available`);
    const plan = runtime.buildPlan({
      confirmedUnderstanding: fixture.understanding,
      strategyResult: strategy,
      answers: fixture.answers
    });
    assert.strictEqual(plan.readiness.ready, true, `${objective} Build Plan remains ready`);
    const deliverables = plan.phases.flatMap(phase => phase.deliverables || []);
    assert(deliverables.length > 0);
    deliverables.forEach(item => {
      assert(runtime.production.contract(item.id), `${objective}:${item.id} contract`);
      assert(runtime.production.artifactPolicy(item.id), `${objective}:${item.id} policy`);
    });
    const first = deliverables.find(item => !item.dependencies.length);
    const contract = runtime.production.contract(first.id);
    const generated = await runtime.generation.generate({
      job: {
        deliverable_id: first.id, title: first.title,
        strategic_direction: first.strategicDirection, strategySnapshot: strategy.strategy
      },
      productionRun: { objective, strategySnapshot: strategy.strategy },
      dependencyOutputs: [], handler: contract
    });
    assert.strictEqual(runtime.validation.validate(generated.structuredOutput, contract).valid, true);
    assert(runtime.presentation.sections(generated.structuredOutput, contract).length > 0);
    assert.strictEqual(runtime.persistence.policy, 'owned_saved_plan_and_production_history');
    assert.strictEqual(runtime.acceptance.policy, 'deterministic_provider_isolation');
  }

  console.log('Story 3.221 Shared Objective Framework tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
