const assert = require('assert');

const { buildPlan } = require('../lib/buildPlanEngine');

function known(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

const understanding = {
  businessType: known('service', 'Service Business'),
  industry: known('professional_services', 'Professional Services'),
  category: known('consulting', 'Consulting'),
  customerMotivation: known('solve_problem', 'Solve a clear problem'),
  targetAudience: known('small_business_owners', 'Small business owners'),
  launchStage: known('ready', 'Ready to launch'),
  salesChannel: known('own_website', 'Shopify / my own website')
};

const strategyResult = {
  strategy: {
    marketPosition: { value: 'Practical Operations Partner', semanticRole: 'strategic_recommendation' },
    primaryCustomer: { value: 'Small business owners', semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Solve a clear problem', semanticRole: 'confirmed_fact' },
    competitiveApproach: { value: 'Clarity and Proof', semanticRole: 'strategic_recommendation' },
    communicationStyle: { value: 'Direct and Practical', semanticRole: 'strategic_recommendation' },
    marketingFocus: { value: 'Education and Trust', semanticRole: 'strategic_recommendation' },
    launchApproach: { value: 'Education Before Promotion', semanticRole: 'strategic_recommendation' }
  }
};

const description = 'A bookkeeping setup service for independent restaurant owners';
const plan = buildPlan({
  objective: 'launch_product',
  confirmedUnderstanding: understanding,
  strategyResult,
  answers: { initial_description: `  ${description}\n` }
});
assert.strictEqual(plan.readiness.ready, true);
const items = plan.phases.flatMap(phase => phase.deliverables);
assert(items.length > 0);
for (const item of items) {
  assert.match(item.strategicDirection, new RegExp(`Builder-provided offer description: ${description}`));
  assert.match(item.strategicDirection, /unverified context, not proof of performance, demand, differentiation, claims, or substantiation/);
}

const noDescription = buildPlan({
  objective: 'launch_product', confirmedUnderstanding: understanding, strategyResult, answers: {}
});
assert.strictEqual(noDescription.readiness.ready, true);
assert(noDescription.phases.flatMap(phase => phase.deliverables).every(item => !item.strategicDirection.includes('Builder-provided offer description:')));

console.log('Story 3.86 Production Offer Context tests passed');
