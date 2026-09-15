const assert = require('assert');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { getAvailableObjective } = require('../lib/objectiveFramework');

function fact(value, label = value) { return { value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' }; }

(async function run() {
  const objective = 'validate_idea';
  assert(getAvailableObjective(objective));
  const understanding = {
    ideaDefinition: fact('A scheduling assistant for independent contractors'), ideaMaturity: fact('idea_only', 'Idea only'),
    targetAudience: fact('Independent contractors coordinating appointments by text'), problemHypothesis: fact('Scheduling changes consume time and create missed appointments'),
    solutionHypothesis: fact('A lightweight assistant could coordinate availability and reminders'), demandAssumptions: fact('Contractors may pay to reduce coordination work'),
    knownAlternatives: fact('Text messages, calendar links, and manual follow-up'), validationEvidence: fact('unsure', "I'm not sure yet"),
    validationResources: fact('Access to ten contractors and two weeks for interviews')
  };
  const answers = { initial_description: 'Validate a scheduling assistant before building software' };
  const mapping = { idea_definition: 'ideaDefinition', idea_maturity: 'ideaMaturity', idea_customer: 'targetAudience', idea_problem: 'problemHypothesis', idea_solution: 'solutionHypothesis', idea_demand: 'demandAssumptions', idea_alternatives: 'knownAlternatives', idea_evidence: 'validationEvidence', idea_resources: 'validationResources' };
  Object.entries(mapping).forEach(([answer, key]) => { answers[answer] = answer === 'idea_maturity' ? 'idea_only' : answer === 'idea_evidence' ? 'unsure' : { value: understanding[key].value }; });
  const runtime = createObjectiveRuntime(objective);
  assert.strictEqual(runtime.discovery.analyze({ understanding, answers, unknowns: [] }).planningReadiness.ready, true);
  const strategy = runtime.strategy.build({ understanding, confirmedUnderstanding: understanding, answers });
  assert.match(strategy.status, /Validation Required/);
  assert.match(JSON.stringify(strategy), /does not declare an idea validated based on AI judgment or plausibility/i);
  assert.doesNotMatch(JSON.stringify(strategy), /idea is validated|proven demand/i);
  const plan = runtime.buildPlan({ confirmedUnderstanding: understanding, strategyResult: strategy, answers });
  assert.strictEqual(plan.planningStage, 'validate');
  const items = plan.phases.flatMap(phase => phase.deliverables);
  assert.deepStrictEqual(items.map(item => item.id), ['customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition', 'validation_plan']);
  const completed = new Map();
  for (const item of items) {
    const contract = runtime.production.contract(item.id);
    const dependencies = item.dependencies.map(id => ({ deliverableId: id, title: id, contractVersion: runtime.production.contract(id).version, output: completed.get(id) }));
    const generated = await runtime.generation.generate({ job: { deliverable_id: item.id, title: item.title, strategic_direction: item.strategicDirection, strategySnapshot: strategy.strategy }, productionRun: { objective, strategySnapshot: strategy.strategy }, dependencyOutputs: dependencies, handler: contract });
    assert.strictEqual(runtime.validation.validate(generated.structuredOutput, contract).valid, true, item.id);
    assert.doesNotMatch(JSON.stringify(generated.structuredOutput), /production contract|output schema|orchestration|internal id|idea is validated/i);
    completed.set(item.id, generated.structuredOutput);
  }
  const validation = completed.get('validation_plan');
  assert(validation.customerQuestions.length && validation.conceptTests.length && validation.decisionCriteria.length && validation.nextActions.length);
  console.log('Story 3.226 Validate My Idea tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
