const assert = require('assert');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { getAvailableObjective } = require('../lib/objectiveFramework');
const { buildBusinessReflection } = require('../lib/businessReflection');

function fact(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' };
}

(async function run() {
  const objective = 'improve_search_rankings';
  assert(getAvailableObjective(objective));
  const understanding = {
    websiteContext: fact('A Toronto bookkeeping firm with service pages and a practical advice blog'),
    targetAudience: fact('Owners of Toronto businesses with 5–25 employees'),
    searchGoal: fact('qualified_leads', 'Generate qualified leads'),
    existingContent: fact('Five service pages and twelve articles documented by the builder'),
    geographicMarket: fact('Toronto, Ontario'),
    suppliedKeywords: fact('small business bookkeeping; year-end bookkeeping questions'),
    searchEvidence: fact('unsure', "I'm not sure yet"),
    technicalLimitations: fact('The team can publish two useful articles per month')
  };
  const answers = {
    initial_description: 'A Toronto bookkeeping website seeking more relevant organic discovery',
    search_site: { value: understanding.websiteContext.value }, search_audience: { value: understanding.targetAudience.value },
    search_goal: 'qualified_leads', search_content: { value: understanding.existingContent.value },
    search_market: { value: understanding.geographicMarket.value }, search_keywords: { value: understanding.suppliedKeywords.value },
    search_evidence: 'unsure', search_constraints: { value: understanding.technicalLimitations.value }
  };
  const runtime = createObjectiveRuntime(objective);
  const discovery = runtime.discovery.analyze({ understanding, answers, unknowns: [] });
  assert.strictEqual(discovery.planningReadiness.ready, true);
  const reflection = buildBusinessReflection({ objective, understanding, answers, planningReadiness: discovery.planningReadiness });
  assert(reflection.groups.some(group => group.domain === 'Optional Search Context'));

  const strategy = runtime.strategy.build({ understanding, confirmedUnderstanding: understanding, answers });
  assert.match(strategy.status, /Search Evidence Required/);
  assert.strictEqual(strategy.strategy.primaryCustomer.semanticRole, 'confirmed_fact');
  assert.match(JSON.stringify(strategy), /No keyword volume, ranking, traffic, backlink, competitor, crawl, or SERP metric is assumed/);
  assert.doesNotMatch(JSON.stringify(strategy), /search volume:\s*\d|ranking:\s*\d|domain authority:\s*\d|backlinks?:\s*\d/i);

  const plan = runtime.buildPlan({ confirmedUnderstanding: understanding, strategyResult: strategy, answers });
  assert.strictEqual(plan.readiness.ready, true);
  assert.deepStrictEqual(plan.phases.map(phase => phase.title), ['Establish Search Evidence', 'Build Search Content', 'Measure & Improve']);
  const items = plan.phases.flatMap(phase => phase.deliverables);
  assert.deepStrictEqual(items.map(item => item.id), [
    'acquisition_snapshot', 'acquisition_channel_strategy', 'campaign_brief',
    'conversion_path_brief', 'organic_content_campaign', 'acquisition_measurement_plan',
    'acquisition_experiment_backlog'
  ]);

  const completed = new Map();
  for (const item of items) {
    const contract = runtime.production.contract(item.id);
    const dependencies = item.dependencies.map(id => ({
      deliverableId: id, title: items.find(candidate => candidate.id === id)?.title || id,
      contractVersion: runtime.production.contract(id).version, output: completed.get(id)
    }));
    const generated = await runtime.generation.generate({
      job: { deliverable_id: item.id, title: item.title, strategic_direction: item.strategicDirection, strategySnapshot: strategy.strategy },
      productionRun: { objective, strategySnapshot: strategy.strategy }, dependencyOutputs: dependencies, handler: contract
    });
    assert.strictEqual(runtime.validation.validate(generated.structuredOutput, contract).valid, true, item.id);
    const visible = JSON.stringify(generated.structuredOutput);
    assert.doesNotMatch(visible, /production contract|output schema|system prompt|orchestration|internal id/i);
    assert.doesNotMatch(visible, /search volume:\s*\d|monthly searches|domain authority:\s*\d|backlinks?:\s*\d|currently ranks? #?\d/i);
    completed.set(item.id, generated.structuredOutput);
  }
  const content = completed.get('organic_content_campaign');
  assert(content.pillarTitle && content.outline.length && content.introduction && content.callToAction);
  console.log('Story 3.223 Improve Search Rankings tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
