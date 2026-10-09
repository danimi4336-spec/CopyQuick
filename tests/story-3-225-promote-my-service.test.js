const assert = require('assert');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { getAvailableObjective } = require('../lib/objectiveFramework');
const { createApprovedProductionSet, createDefaultSelection } = require('../lib/buildPlanApproval');

function fact(value, label = value) { return { value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' }; }

(async function run() {
  const objective = 'promote_service';
  assert(getAvailableObjective(objective));
  const understanding = {
    serviceDefinition: fact('Monthly bookkeeping and reporting for small agencies'), targetAudience: fact('Agency owners with 5–20 employees'),
    clientProblem: fact('Month-end reporting is late and difficult to interpret'), serviceExpertise: fact('Founder biographies and bookkeeping qualifications supplied by the builder'),
    serviceDifferentiation: fact('Plain-language monthly decision summaries'), serviceOffer: fact('Monthly engagement; price remains to be confirmed'),
    serviceMarket: fact('Remote clients in the United States'), serviceChannel: fact('outbound', 'Outbound outreach'),
    serviceConstraints: fact('Capacity for four new clients; no published case studies')
  };
  const answers = { initial_description: 'Promote a monthly bookkeeping service to small agency owners' };
  const mapping = { service_definition: 'serviceDefinition', service_client: 'targetAudience', service_problem: 'clientProblem', service_expertise: 'serviceExpertise', service_difference: 'serviceDifferentiation', service_offer: 'serviceOffer', service_market: 'serviceMarket', service_channel: 'serviceChannel', service_constraints: 'serviceConstraints' };
  Object.entries(mapping).forEach(([answer, key]) => { answers[answer] = answer === 'service_channel' ? 'outbound' : { value: understanding[key].value }; });
  const runtime = createObjectiveRuntime(objective);
  assert.strictEqual(runtime.discovery.analyze({ understanding, answers, unknowns: [] }).planningReadiness.ready, true);
  const strategy = runtime.strategy.build({ understanding, confirmedUnderstanding: understanding, answers });
  assert.match(strategy.status, /Service Proof Boundaries/);
  assert.match(JSON.stringify(strategy), /No testimonial, credential, certification, case study, client count, or performance result is invented/);
  const plan = runtime.buildPlan({ confirmedUnderstanding: understanding, strategyResult: strategy, answers });
  const items = plan.phases.flatMap(phase => phase.deliverables);
  assert.deepStrictEqual(items.map(item => item.id), ['customer_profile', 'product_positioning', 'value_proposition', 'core_messaging', 'service_page']);
  const approval = createApprovedProductionSet({ plan, selection: createDefaultSelection(plan), strategyResult: strategy, confirmedUnderstanding: understanding });
  assert.strictEqual(approval.valid, true);
  const strategySnapshot = approval.productionSet.strategySnapshot;
  assert.strictEqual(strategySnapshot.confirmedOffer.value, understanding.serviceDefinition.value);
  const completed = new Map();
  for (const item of items) {
    const contract = runtime.production.contract(item.id);
    const dependencies = item.dependencies.map(id => ({ deliverableId: id, title: id, contractVersion: runtime.production.contract(id).version, output: completed.get(id) }));
    const generated = await runtime.generation.generate({ job: { deliverable_id: item.id, title: item.title, strategic_direction: item.strategicDirection, strategySnapshot }, productionRun: { objective, strategySnapshot }, dependencyOutputs: dependencies, handler: contract });
    assert.strictEqual(runtime.validation.validate(generated.structuredOutput, contract).valid, true, item.id);
    const visible = JSON.stringify(generated.structuredOutput);
    assert.doesNotMatch(visible, /production contract|output schema|orchestration|internal id/i);
    assert.doesNotMatch(visible, /testimonial from|certified by|helped \d+|increased .* by \d+%/i);
    completed.set(item.id, generated.structuredOutput);
  }
  const servicePage = completed.get('service_page');
  assert(servicePage.summary && servicePage.content.length);
  assert.match(servicePage.content.join(' '), /monthly bookkeeping and reporting/i);
  assert.doesNotMatch(servicePage.content.join(' '), /\[[^\]]+\]|pricing is unresolved|confirmed service scope|builder-provided/i);
  assert.doesNotMatch(servicePage.content.join(' '), /\bwhen .{1,100} is getting in the way\b/i);
  assert.match(servicePage.content.join(' '), /if this challenge sounds familiar—month-end reporting is late and difficult to interpret—a focused service conversation/i);
  const invalidServicePage = { ...servicePage, content: [...servicePage.content.slice(0, -1), 'Contact [Business Name] at [Contact Link].'] };
  assert.strictEqual(runtime.validation.validate(invalidServicePage, runtime.production.contract('service_page')).valid, false);
  console.log('Story 3.225 Promote My Service tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
