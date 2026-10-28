const assert = require('assert');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { objectiveUniverse } = require('../lib/objectiveFramework');
const { objectiveAcceptanceFixtures } = require('../lib/objectiveAcceptanceFixtures');

(async function run(){
  const all=objectiveAcceptanceFixtures(); const supported=objectiveUniverse.filter(x=>x.available).map(x=>x.id);
  assert.deepStrictEqual(Object.keys(all),supported);
  const firstOutputs=new Map();
  for(const objective of supported){
    const runtime=createObjectiveRuntime(objective), fixture=all[objective];
    const discovery=runtime.discovery.analyze({...fixture,unknowns:[]}); assert.strictEqual(discovery.planningReadiness.ready,true,objective);
    const strategy=runtime.strategy.build({understanding:fixture.understanding,confirmedUnderstanding:fixture.understanding,answers:fixture.answers});
    const plan=runtime.buildPlan({confirmedUnderstanding:fixture.understanding,strategyResult:strategy,answers:fixture.answers}); assert.strictEqual(plan.readiness.ready,true,objective);
    const completed=new Map();
    for(const item of plan.phases.flatMap(p=>p.deliverables)){
      const contract=runtime.production.contract(item.id); assert(contract,item.id); assert.strictEqual(runtime.validation.validate({},contract).valid,false);
      const dependencyOutputs=item.dependencies.map(id=>({deliverableId:id,title:id,contractVersion:runtime.production.contract(id).version,output:completed.get(id)}));
      const generated=await runtime.generation.generate({job:{deliverable_id:item.id,title:item.title,strategic_direction:item.strategicDirection,strategySnapshot:strategy.strategy},productionRun:{objective,strategySnapshot:strategy.strategy},dependencyOutputs,handler:contract});
      const contextDependent = item.id === 'priority_search_article';
      assert.strictEqual(contextDependent ? contract.validateOutput(generated.structuredOutput) : runtime.validation.validate(generated.structuredOutput,contract).valid,true,`${objective}:${item.id}`);
      assert(contextDependent ? contract.presentationSections(generated.structuredOutput).length : runtime.presentation.sections(generated.structuredOutput,contract).length,`${objective}:${item.id} renders`);
      const visible=JSON.stringify(generated.structuredOutput); assert.doesNotMatch(visible,/production contract|output schema|system prompt|orchestration|dependencyOutputs|confirmed_fact|strategic_recommendation|internal id/i);
      if(objective==='improve_search_rankings') assert.doesNotMatch(visible,/search volume:\s*\d|monthly searches:\s*\d|domain authority:\s*\d|backlinks?:\s*\d|ranks? #?\d/i);
      if(objective==='promote_service') assert.doesNotMatch(visible,/trusted by \d|helped \d|certified by|increased .* by \d+%/i);
      completed.set(item.id,generated.structuredOutput); if(!firstOutputs.has(objective)) firstOutputs.set(objective,visible);
    }
  }
  for(const [objective,visible] of firstOutputs){ for(const [other,fixture] of Object.entries(all)){ if(other!==objective) assert(!visible.includes(fixture.understanding.targetAudience.label),`${objective} leaked ${other} context`); } }
  console.log('Phase 4 cross-objective quality matrix passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
