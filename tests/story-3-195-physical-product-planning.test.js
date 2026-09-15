const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createApprovedProductionSet, createDefaultSelection, updateSelection } = require('../lib/buildPlanApproval');
const { getProductionContract } = require('../lib/productionContracts');
const { buildProductionSynthesis } = require('../lib/productionSynthesis');
const { buildStrategy } = require('../lib/strategyEngine');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function physicalFacts() {
  return {
    businessType: confirmed('physical_product', 'Physical Product'),
    targetAudience: { value: 'busy parents', label: 'Busy parents', confidence: 0.85, source: 'inference' },
    customerMotivation: confirmed('convenience', 'It makes something easier or faster'),
    salesChannel: { value: 'own_website', label: 'Shopify / my own website', confidence: 0.95, source: 'inference' },
    conceptMaturity: confirmed('idea_only', 'I only have the product idea'),
    competitiveDifferentiation: confirmed('unsure', "I'm not sure yet"),
    launchStage: { value: 'idea', label: 'Idea or early concept', confidence: 0.85, source: 'inference' }
  };
}

function context(title) {
  return {
    objective: 'launch_product',
    title,
    strategySnapshot: {
      primaryCustomer: { value: 'Busy parents', semanticRole: 'inferred_fact' },
      customerMotivation: { value: 'Save Time and Reduce Effort', semanticRole: 'confirmed_fact' },
      primarySalesChannel: { value: 'Shopify / my own website', semanticRole: 'inferred_fact' }
    },
    strategicDirection: 'Inferred primary customer: Busy parents · Builder-provided offer description: I want to launch a reusable insulated lunch container for busy parents through Shopify. Treat this as unverified context, not proof of performance, demand, differentiation, claims, or substantiation.',
    dependencyOutputs: []
  };
}

async function run() {
  const description = 'I want to launch a reusable insulated lunch container for busy parents through Shopify.';
  const facts = physicalFacts();
  const strategy = buildStrategy({
    objective: 'launch_product', understanding: facts, confirmedUnderstanding: facts,
    answers: { initial_description: description }
  });
  assert.strictEqual(strategy.strategy.primaryCustomer.value, 'Busy parents');
  assert.strictEqual(strategy.strategy.primarySalesChannel.value, 'Shopify / my own website');
  assert.match(JSON.stringify(strategy.strategy.risks.value), /specifications|supplier feasibility|packaging/i);
  assert.doesNotMatch(JSON.stringify(strategy), /supplement|Amazon/i);

  const plan = buildPlan({
    objective: 'launch_product', confirmedUnderstanding: facts, strategyResult: strategy,
    answers: { initial_description: description }
  });
  assert.strictEqual(plan.readiness.ready, true);
  assert.deepStrictEqual(plan.phases.map(phase => phase.title), [
    'Define & Validate', 'Establish Feasibility', 'Prepare Operations'
  ]);
  const items = plan.phases.flatMap(phase => phase.deliverables);
  const ids = items.map(item => item.id);
  assert.deepStrictEqual(ids, [
    'customer_profile', 'product_concept_brief', 'product_specification_brief',
    'product_positioning', 'value_proposition', 'validation_plan',
    'prototype_sample_validation_plan', 'sourcing_manufacturer_brief',
    'compliance_evidence_checklist', 'unit_economics_pricing_model',
    'packaging_shipping_requirements', 'inventory_fulfillment_plan'
  ]);
  assert(!ids.some(id => id.startsWith('amazon_')));
  assert(!ids.includes('ecommerce_product_page'));
  assert.match(plan.summary.whyThisPlan, /physical product|feasibility|economics|operations/i);
  assert.deepStrictEqual(items.find(item => item.id === 'inventory_fulfillment_plan').dependencies, [
    'sourcing_manufacturer_brief', 'unit_economics_pricing_model', 'packaging_shipping_requirements'
  ]);
  const selection = createDefaultSelection(plan);
  assert.strictEqual(selection.selectedDeliverableIds.length, 10);
  assert(!selection.selectedDeliverableIds.includes('packaging_shipping_requirements'));
  assert(!selection.selectedDeliverableIds.includes('inventory_fulfillment_plan'));
  const approved = createApprovedProductionSet({ plan, selection, strategyResult: strategy });
  assert.strictEqual(approved.valid, true);
  assert.deepStrictEqual(approved.productionSet.productionOrder, ids.slice(0, 10));
  assert(approved.productionSet.selectedDeliverables.every(item =>
    item.dependencies.every(dependency => selection.selectedDeliverableIds.includes(dependency))
  ));
  const optionalSelection = updateSelection({
    plan,
    currentSelection: selection,
    requestedDeliverableIds: [...selection.selectedDeliverableIds, 'inventory_fulfillment_plan']
  });
  assert.strictEqual(optionalSelection.valid, true);
  assert(optionalSelection.selection.selectedDeliverableIds.includes('packaging_shipping_requirements'));
  assert(optionalSelection.selection.selectedDeliverableIds.includes('inventory_fulfillment_plan'));

  const deliverableIds = [
    'product_specification_brief', 'prototype_sample_validation_plan',
    'sourcing_manufacturer_brief', 'compliance_evidence_checklist',
    'unit_economics_pricing_model', 'packaging_shipping_requirements',
    'inventory_fulfillment_plan'
  ];
  const outputs = new Map();
  for (const id of deliverableIds) {
    const contract = getProductionContract(id);
    assert(contract, `${id} contract must exist`);
    const output = contract.generateOutput(context(items.find(item => item.id === id).title));
    assert.strictEqual(contract.validateOutput(output), true, `${id} output must satisfy its contract`);
    const text = JSON.stringify(output);
    assert.doesNotMatch(text, /Amazon|supplement|search volume|certified manufacturer/i);
    assert.doesNotMatch(text, /\$\d|\bMOQ (?:is|of) \d|\d+ units/i);
    outputs.set(id, output);
  }
  assert.match(JSON.stringify(outputs.get('product_specification_brief')), /capacity|dimensions|materials|insulation|leak resistance|cleaning|durability|food-contact/i);
  assert.match(JSON.stringify(outputs.get('sourcing_manufacturer_brief')), /RFQ|quotations|supplier/i);
  assert.match(JSON.stringify(outputs.get('unit_economics_pricing_model')), /manufacturing|packaging|freight|fulfillment|returns|contribution margin/i);
  assert.match(JSON.stringify(outputs.get('compliance_evidence_checklist')), /qualified|food-contact|legal advice/i);
  assert.match(JSON.stringify(outputs.get('packaging_shipping_requirements')), /packed dimensions|shipping/i);
  assert.match(JSON.stringify(outputs.get('inventory_fulfillment_plan')), /reorder|returns|fulfillment/i);

  const concept = getProductionContract('product_concept_brief').generateOutput(context('Product Concept Brief'));
  const validation = getProductionContract('validation_plan').generateOutput(context('Market Validation Plan'));
  const synthesis = buildProductionSynthesis([
    { deliverableId: 'product_concept_brief', output: concept },
    { deliverableId: 'product_specification_brief', output: outputs.get('product_specification_brief') },
    { deliverableId: 'validation_plan', output: validation },
    { deliverableId: 'sourcing_manufacturer_brief', output: outputs.get('sourcing_manufacturer_brief') },
    { deliverableId: 'compliance_evidence_checklist', output: outputs.get('compliance_evidence_checklist') },
    { deliverableId: 'unit_economics_pricing_model', output: outputs.get('unit_economics_pricing_model') }
  ]);
  assert.match(synthesis.unlockTitle, /product pages, imagery, and launch campaigns/i);
  assert.match(JSON.stringify(synthesis.unlockConditions), /specification|supplier|economics|margin/i);

  const root = path.join(__dirname, '..');
  const studioTemplate = fs.readFileSync(path.join(root, 'views', 'production-studio.ejs'), 'utf8');
  assert.doesNotMatch(studioTemplate, /job\.strategic_direction/);
  const studio = await ejs.renderFile(path.join(root, 'views', 'production-studio.ejs'), {
    production: { id: 7, status: 'completed', production_cost_units: 1, started_at: 'now', jobs: [{}] },
    phases: [{ id: 'define_validate', title: 'Define & Validate', jobs: [{
      sequence_order: 0, title: 'Historical Product Positioning', display_description: 'Frames a provisional position to validate.',
      status: 'completed', dependencies: [], generation_id: 24,
      strategic_direction: 'Recommended market direction: Internal historical context'
    }] }],
    completedCount: 1, executionNotice: null, hasExpiredLease: false,
    synthesis, csrfToken: 'test'
  });
  assert.match(studio, /Frames a provisional position to validate/);
  assert.doesNotMatch(studio, /Recommended market direction|Inferred primary customer|Builder-provided offer description/);
  assert.match(studio, /Before product pages, imagery, and launch campaigns unlock/);

  console.log('Story 3.195 Physical-Product Planning Architecture tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
