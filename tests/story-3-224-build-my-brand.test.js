const assert = require('assert');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { getAvailableObjective } = require('../lib/objectiveFramework');
const { buildBrandBrainProposal, applyApprovedBrandBrainProposal, loadBrandObjectiveProposal } = require('../lib/brandObjectiveIntegration');
const fs = require('fs');
const path = require('path');

function fact(value, label = value) { return { value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' }; }

(async function run() {
  const objective = 'build_brand';
  assert(getAvailableObjective(objective));
  const understanding = {
    brandBusiness: fact('A bookkeeping studio for independent retailers'), targetAudience: fact('Independent retailers with small teams'),
    existingBrand: fact('The name North Ledger and a navy visual identity are established'),
    brandDifferentiation: fact('Plain-language financial guidance from experienced bookkeepers'),
    brandValues: fact('Clarity, steadiness, and respect'), brandVoice: fact('Clear, calm, and practical'),
    brandProof: fact('Founder biographies and qualifications supplied by the builder'), brandConstraints: fact('Keep the North Ledger name and navy identity')
  };
  const answers = { initial_description: 'Strengthen North Ledger without discarding its established identity' };
  const ids = ['brand_business', 'brand_audience', 'brand_state', 'brand_difference', 'brand_values', 'brand_voice', 'brand_proof', 'brand_constraints'];
  ids.forEach(id => { answers[id] = { value: understanding[{ brand_business: 'brandBusiness', brand_audience: 'targetAudience', brand_state: 'existingBrand', brand_difference: 'brandDifferentiation', brand_values: 'brandValues', brand_voice: 'brandVoice', brand_proof: 'brandProof', brand_constraints: 'brandConstraints' }[id]].value }; });
  const runtime = createObjectiveRuntime(objective);
  assert.strictEqual(runtime.discovery.analyze({ understanding, answers, unknowns: [] }).planningReadiness.ready, true);
  const strategy = runtime.strategy.build({ understanding, confirmedUnderstanding: understanding, answers });
  assert.match(strategy.status, /Brand Decisions to Approve/);
  assert.match(JSON.stringify(strategy), /must not silently overwrite established Brand Brain facts/i);
  const plan = runtime.buildPlan({ confirmedUnderstanding: understanding, strategyResult: strategy, answers });
  assert.deepStrictEqual(plan.phases.flatMap(phase => phase.deliverables).map(item => item.id), ['customer_profile', 'product_positioning', 'value_proposition', 'core_messaging']);

  const completed = new Map();
  for (const item of plan.phases.flatMap(phase => phase.deliverables)) {
    const contract = runtime.production.contract(item.id);
    const dependencies = item.dependencies.map(id => ({ deliverableId: id, title: id, contractVersion: runtime.production.contract(id).version, output: completed.get(id) }));
    const generated = await runtime.generation.generate({ job: { deliverable_id: item.id, title: item.title, strategic_direction: item.strategicDirection, strategySnapshot: strategy.strategy }, productionRun: { objective, strategySnapshot: strategy.strategy }, dependencyOutputs: dependencies, handler: contract });
    assert.strictEqual(runtime.validation.validate(generated.structuredOutput, contract).valid, true);
    assert.doesNotMatch(JSON.stringify(generated.structuredOutput), /production contract|output schema|orchestration|internal id/i);
    completed.set(item.id, generated.structuredOutput);
  }

  const existing = { business_name: 'North Ledger', industry: 'Bookkeeping', target_audience: 'Established audience', brand_voice: 'professional', brand_voice_custom: '', unique_value: 'Established value', competitors: '', goals: '', key_messages: '' };
  const proposal = buildBrandBrainProposal({ existing, understanding, outputs: Object.fromEntries(completed) });
  assert.strictEqual(proposal.target_audience.status, 'conflict_requires_approval');
  assert.strictEqual(existing.target_audience, 'Established audience', 'proposal construction must be side-effect free');
  const enriched = applyApprovedBrandBrainProposal({ existing, proposal, approvedFields: ['key_messages'] });
  assert.strictEqual(enriched.target_audience, 'Established audience', 'unapproved established facts remain authoritative');
  assert(enriched.key_messages);

  const persisted = loadBrandObjectiveProposal({
    prepare(sql) {
      if (sql.includes('FROM production_runs')) return { get: (runId, userId) => runId === 42 && userId === 7 ? { id: 42 } : undefined };
      return { all: () => [...completed].map(([deliverable_id, output]) => ({ deliverable_id, structured_result: JSON.stringify(output) })) };
    }
  }, { userId: 7, productionRunId: 42, existing });
  assert.strictEqual(persisted.productionRunId, 42);
  assert(persisted.proposal.key_messages);
  assert.strictEqual(loadBrandObjectiveProposal({ prepare: () => ({ get: () => undefined }) }, { userId: 8, productionRunId: 42, existing }), null, 'another user cannot load the proposal');

  const builderRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'builder.js'), 'utf8');
  const brainView = fs.readFileSync(path.join(__dirname, '..', 'views', 'brand-brain.ejs'), 'utf8');
  const studioView = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');
  assert.match(builderRoute, /brand-brain\/enrich\/\:productionRunId/);
  assert.match(brainView, /Existing Brand Brain details are never replaced without your selection/);
  assert.match(studioView, /Review decisions for Brand Brain/);
  console.log('Story 3.224 Build My Brand tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
