const assert = require('assert');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { evaluateRequirements } = require('../lib/discoveryRequirements');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { buildApprovalView, createDefaultSelection } = require('../lib/buildPlanApproval');
const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const { calculateProductionCost } = require('../lib/productionCost');
const { generateDeliverable } = require('../lib/generationService');

(async function run() {
  const objective = 'get_more_customers';
  const description = 'A bookkeeping service that wants more qualified small-business leads';
  const result = await understandBusiness({ objective, answer: description });
  const understanding = { ...result.understanding };
  const values = {
    businessType: ['service', 'Service Business'], acquisitionGoal: ['qualified_leads', 'More qualified leads'],
    targetAudience: ['small businesses', 'Small businesses'], currentAcquisitionChannel: ['referrals', 'Referrals'],
    acquisitionStage: ['inconsistent_traction', 'Some traction, but inconsistent'], salesProcess: ['booked_call', 'Booked call or appointment'],
    capacityReadiness: ['capacity_ready', 'Ready to serve more customers now']
  };
  Object.entries(values).forEach(([key, [value, label]]) => { understanding[key] = { value, label, confidence: 1, source: 'user_confirmed' }; });
  const answers = {
    initial_description: description, business_type: 'service', acquisition_goal: 'qualified_leads',
    acquisition_target: { value: 'small businesses' }, acquisition_channel: 'referrals',
    acquisition_stage: 'inconsistent_traction', sales_process: 'booked_call', capacity_readiness: 'capacity_ready'
  };
  assert.strictEqual(evaluateRequirements({ objective, understanding, answers }).ready, true);
  const strategyResult = buildStrategy({ objective, understanding, confirmedUnderstanding: understanding, answers });
  assert.match(strategyResult.status, /Strategy Ready/);
  assert.match(strategyResult.strategy.launchApproach.value, /Evaluate acquisition channels/);
  assert.strictEqual(strategyResult.strategy.customerMotivation.value, 'Unknown');
  const plan = buildPlan({ objective, confirmedUnderstanding: understanding, strategyResult, answers });
  assert.strictEqual(plan.readiness.ready, true);
  assert.deepStrictEqual(plan.phases.map(phase => phase.title), ['Diagnose & Focus', 'Build the Acquisition System', 'Measure & Improve']);
  const deliverables = plan.phases.flatMap(phase => phase.deliverables);
  getProductionContractIds().forEach(id => assert(getProductionArtifactPolicy(id), `${id} must have an explicit artifact and billing policy`));
  assert.strictEqual(deliverables.length, 6);
  assert.deepStrictEqual(
    deliverables.filter(item => getProductionArtifactPolicy(item.id)?.readyToUse).map(item => item.id),
    []
  );
  const defaultSelection = createDefaultSelection(plan);
  const approvalView = buildApprovalView(plan, defaultSelection);
  assert.deepStrictEqual(
    defaultSelection.selectedDeliverableIds.filter(id => getProductionArtifactPolicy(id)?.readyToUse),
    [],
    'a current referral source must not silently become the recommended execution channel'
  );
  assert.strictEqual(approvalView.counts.planningFoundation, 5);
  assert.strictEqual(approvalView.counts.readyToUseAssets, 0);
  assert.strictEqual(approvalView.counts.productionUnits, 0);
  deliverables.forEach(item => {
    const contract = getProductionContract(item.id);
    assert(contract, `production contract exists for ${item.id}`);
    assert.deepStrictEqual(contract.requiredDependencies, item.dependencies);
    assert.strictEqual(
      contract.artifactRole,
      'planning_foundation',
      `${item.id} must have an explicit user-facing artifact role`
    );
  });
  const productionCost = calculateProductionCost({
    approvedProductionSet: { selectedDeliverables: deliverables },
    usageSnapshot: { used: 0, monthlyLimit: 10, remaining: 10 }
  });
  assert.strictEqual(productionCost.valid, true);
  assert.strictEqual(productionCost.productionUnitCount, 0);
  assert.strictEqual(productionCost.planningFoundationCount, 6);
  assert.strictEqual(productionCost.readyToUseAssetCount, 0);
  const freeFoundationCost = calculateProductionCost({
    approvedProductionSet: { selectedDeliverables: deliverables.filter(item => !getProductionArtifactPolicy(item.id)?.readyToUse) },
    usageSnapshot: { used: 10, monthlyLimit: 10, remaining: 0 }
  });
  assert.strictEqual(freeFoundationCost.productionUnitCount, 0);
  assert.strictEqual(freeFoundationCost.canAfford, true, 'free planning foundation remains available with no production credits left');

  const expectedAssetsByChannel = Object.fromEntries(['referrals','organic_search','social','paid_ads','outbound','mixed_channels','no_reliable_channel'].map(channel => [channel, []]));
  Object.entries(expectedAssetsByChannel).forEach(([channel, expectedIds]) => {
    const channelUnderstanding = {
      ...understanding,
      currentAcquisitionChannel: { value: channel, label: channel, confidence: 1, source: 'user_confirmed' }
    };
    const channelAnswers = { ...answers, acquisition_channel: channel };
    const channelStrategy = buildStrategy({ objective, understanding: channelUnderstanding, confirmedUnderstanding: channelUnderstanding, answers: channelAnswers });
    const channelPlan = buildPlan({ objective, confirmedUnderstanding: channelUnderstanding, strategyResult: channelStrategy, answers: channelAnswers });
    const channelAssets = channelPlan.phases.flatMap(phase => phase.deliverables)
      .filter(item => getProductionArtifactPolicy(item.id)?.readyToUse)
      .map(item => item.id);
    assert.deepStrictEqual(channelAssets, expectedIds, `${channel} must receive its channel-appropriate ready-to-use assets`);
  });

  const completedOutputs = new Map();
  for (const item of deliverables) {
    const contract = getProductionContract(item.id);
    const dependencyOutputs = item.dependencies.map(id => ({
      deliverableId: id,
      title: deliverables.find(candidate => candidate.id === id).title,
      contractVersion: getProductionContract(id).version,
      output: completedOutputs.get(id),
      result: []
    }));
    const generated = await generateDeliverable({
      job: {
        deliverable_id: item.id,
        title: item.title,
        strategic_direction: item.strategicDirection,
        strategySnapshot: strategyResult.strategy
      },
      productionRun: { objective, strategySnapshot: strategyResult.strategy },
      dependencyOutputs,
      handler: contract
    });
    assert.strictEqual(contract.validateOutput(generated.structuredOutput), true, `${item.id} must execute through its production contract`);
    assert.doesNotMatch(JSON.stringify(generated.structuredOutput), /To be confirmed/i, `${item.id} must not fall back to placeholder content`);
    assert.doesNotMatch(JSON.stringify(generated.structuredOutput), /\.\.(?:\s|"|$)/, `${item.id} must normalize sentence-ending punctuation from user input`);
    completedOutputs.set(item.id, generated.structuredOutput);
  }
  console.log('Story 3.204 get-more-customers workflow tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
