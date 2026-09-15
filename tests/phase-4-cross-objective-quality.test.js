const assert = require('assert');
const { createObjectiveRuntime } = require('../lib/objectiveRuntime');
const { objectiveUniverse } = require('../lib/objectiveFramework');

const fact = (value, label = value) => ({ value, label, confidence: 1, source: 'user_confirmed', semanticRole: 'confirmed_fact' });
const base = initial_description => ({ answers: { initial_description }, understanding: {} });
function field(fixture, key, value, label = value) { fixture.understanding[key] = fact(value, label); return fixture; }
function answer(fixture, key, value) { fixture.answers[key] = typeof value === 'string' ? value : { value }; return fixture; }

function fixtures() {
  const launch = base('A desk organizer for remote illustrators');
  [['businessType','physical_product','Physical Product'],['targetAudience','remote illustrators','Remote illustrators'],['customerMotivation','convenience','Convenience'],['launchStage','idea','Idea or early concept'],['salesChannel','unsure',"I'm not sure yet"]].forEach(x => field(launch,...x));
  Object.assign(launch.answers,{business_type:'physical_product',target_audience:{value:'remote illustrators'},customer_motivation:'convenience',launch_stage:'idea',sales_channel:'unsure'});
  const acquisition = base('A bookkeeping service seeking qualified studio owners');
  [['businessType','service','Service'],['acquisitionGoal','qualified_leads','More qualified leads'],['targetAudience','studio owners','Studio owners'],['currentAcquisitionChannel','referrals','Referrals'],['acquisitionStage','inconsistent_traction','Inconsistent traction'],['salesProcess','booked_call','Booked call'],['capacityReadiness','capacity_ready','Capacity ready']].forEach(x=>field(acquisition,...x));
  Object.assign(acquisition.answers,{business_type:'service',acquisition_goal:'qualified_leads',acquisition_target:{value:'studio owners'},acquisition_channel:'referrals',acquisition_stage:'inconsistent_traction',sales_process:'booked_call',capacity_readiness:'capacity_ready'});
  const conversion=base('A scheduling page for architecture practices');
  [['currentOffer','A scheduling software trial'],['targetAudience','architecture practice managers'],['trafficSource','paid_ads','Paid advertising'],['funnelType','trial_signup','Trial signup'],['pageExperience','A pricing page with features and limited setup detail'],['primaryCta','Start a trial'],['conversionEvidence','unsure',"I'm not sure yet"],['conversionFriction','Prospects ask about importing calendars']].forEach(x=>field(conversion,...x));
  Object.assign(conversion.answers,{conversion_offer:{value:'A scheduling software trial'},conversion_audience:{value:'architecture practice managers'},conversion_traffic:'paid_ads',conversion_funnel:'trial_signup',conversion_page:{value:'A pricing page with features and limited setup detail'},conversion_cta:{value:'Start a trial'},conversion_evidence:'unsure',conversion_friction:{value:'Prospects ask about importing calendars'}});
  const search=base('A bicycle repair website serving Portland commuters');
  [['websiteContext','A bicycle repair shop website with service pages'],['targetAudience','Portland bicycle commuters'],['searchGoal','local_visibility','Improve local discovery'],['existingContent','Four service pages documented by the owner'],['geographicMarket','Portland, Oregon'],['suppliedKeywords','unsure',"I'm not sure yet"],['searchEvidence','unsure',"I'm not sure yet"],['technicalLimitations','One article per month']].forEach(x=>field(search,...x));
  Object.assign(search.answers,{search_site:{value:'A bicycle repair shop website with service pages'},search_audience:{value:'Portland bicycle commuters'},search_goal:'local_visibility',search_content:{value:'Four service pages documented by the owner'},search_market:{value:'Portland, Oregon'},search_keywords:'unsure',search_evidence:'unsure',search_constraints:{value:'One article per month'}});
  const brand=base('Build a brand for a ceramics studio');
  [['brandBusiness','A ceramics studio'],['targetAudience','design-conscious apartment renters'],['existingBrand','The name Clay North is established'],['brandDifferentiation','Small-batch functional forms'],['brandValues','care, utility, restraint'],['brandVoice','warm and precise'],['brandProof','unsure',"I'm not sure yet"],['brandConstraints','Keep the Clay North name']].forEach(x=>field(brand,...x));
  Object.assign(brand.answers,{brand_business:{value:'A ceramics studio'},brand_audience:{value:'design-conscious apartment renters'},brand_state:{value:'The name Clay North is established'},brand_difference:{value:'Small-batch functional forms'},brand_values:{value:'care, utility, restraint'},brand_voice:{value:'warm and precise'},brand_proof:'unsure',brand_constraints:{value:'Keep the Clay North name'}});
  const service=base('Promote a remote operations advisory service');
  [['serviceDefinition','Monthly operations advisory'],['targetAudience','independent clinic owners'],['clientProblem','Operational decisions are scattered'],['serviceExpertise','Founder biography supplied by the builder'],['serviceDifferentiation','A weekly decision cadence'],['serviceOffer','Monthly engagement'],['serviceMarket','Remote United States'],['serviceChannel','outbound','Outbound'],['serviceConstraints','No published case studies']].forEach(x=>field(service,...x));
  Object.assign(service.answers,{service_definition:{value:'Monthly operations advisory'},service_client:{value:'independent clinic owners'},service_problem:{value:'Operational decisions are scattered'},service_expertise:{value:'Founder biography supplied by the builder'},service_difference:{value:'A weekly decision cadence'},service_offer:{value:'Monthly engagement'},service_market:{value:'Remote United States'},service_channel:'outbound',service_constraints:{value:'No published case studies'}});
  const idea=base('Validate a shared inventory reminder idea');
  [['ideaDefinition','A shared inventory reminder'],['ideaMaturity','idea_only','Idea only'],['targetAudience','small theatre production managers'],['problemHypothesis','Supply checks are missed'],['solutionHypothesis','Shared reminders may coordinate checks'],['demandAssumptions','Managers may pay to reduce missed checks'],['knownAlternatives','Spreadsheets and chat reminders'],['validationEvidence','unsure',"I'm not sure yet"],['validationResources','Access to eight managers']].forEach(x=>field(idea,...x));
  Object.assign(idea.answers,{idea_definition:{value:'A shared inventory reminder'},idea_maturity:'idea_only',idea_customer:{value:'small theatre production managers'},idea_problem:{value:'Supply checks are missed'},idea_solution:{value:'Shared reminders may coordinate checks'},idea_demand:{value:'Managers may pay to reduce missed checks'},idea_alternatives:{value:'Spreadsheets and chat reminders'},idea_evidence:'unsure',idea_resources:{value:'Access to eight managers'}});
  return { launch_product:launch, get_more_customers:acquisition, increase_conversion_rates:conversion, improve_search_rankings:search, build_brand:brand, promote_service:service, validate_idea:idea };
}

(async function run(){
  const all=fixtures(); const supported=objectiveUniverse.filter(x=>x.available).map(x=>x.id);
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
      assert.strictEqual(runtime.validation.validate(generated.structuredOutput,contract).valid,true,`${objective}:${item.id}`);
      assert(runtime.presentation.sections(generated.structuredOutput,contract).length,`${objective}:${item.id} renders`);
      const visible=JSON.stringify(generated.structuredOutput); assert.doesNotMatch(visible,/production contract|output schema|system prompt|orchestration|dependencyOutputs|confirmed_fact|strategic_recommendation|internal id/i);
      if(objective==='improve_search_rankings') assert.doesNotMatch(visible,/search volume:\s*\d|monthly searches:\s*\d|domain authority:\s*\d|backlinks?:\s*\d|ranks? #?\d/i);
      if(objective==='promote_service') assert.doesNotMatch(visible,/trusted by \d|helped \d|certified by|increased .* by \d+%/i);
      completed.set(item.id,generated.structuredOutput); if(!firstOutputs.has(objective)) firstOutputs.set(objective,visible);
    }
  }
  for(const [objective,visible] of firstOutputs){ for(const [other,fixture] of Object.entries(all)){ if(other!==objective) assert(!visible.includes(fixture.understanding.targetAudience.label),`${objective} leaked ${other} context`); } }
  console.log('Phase 4 cross-objective quality matrix passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
