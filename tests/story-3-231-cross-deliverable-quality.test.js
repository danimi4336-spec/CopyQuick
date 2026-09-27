const assert = require('assert');

const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { ROLE_POLICY, buildEvidenceLedger } = require('../lib/productionEvidence');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { generateDeliverable } = require('../lib/generationService');

const strategySnapshot = {
  primaryCustomer: { value: 'Careful online shoppers', semanticRole: 'confirmed_fact' },
  customerMotivation: { value: 'Make an informed purchase decision', semanticRole: 'confirmed_fact' },
  confirmedOffer: { value: 'The Everyday Organizer', semanticRole: 'confirmed_fact' },
  marketPosition: { value: 'A practical organization option', semanticRole: 'strategic_recommendation' },
  conceptDirection: { value: 'Explore a compact recycled-material edition', semanticRole: 'exploration_intent' }
};
const context = {
  title: 'Customer Asset',
  strategicDirection: 'Help careful shoppers assess whether The Everyday Organizer fits their needs.',
  strategySnapshot,
  dependencyOutputs: [],
  evidenceLedger: buildEvidenceLedger({ strategySnapshot })
};

const readyContracts = getProductionContractIds().map(getProductionContract).filter(contract => contract.readyToUse);
assert.strictEqual(readyContracts.length, 23);
readyContracts.forEach(contract => {
  assert.strictEqual(contract.validationProfile.policy, 'ready_asset_quality_v1', `${contract.id} needs the shared profile`);
  assert(contract.validationProfile.family, `${contract.id} needs a family profile`);
});
getProductionContractIds().map(getProductionContract).filter(contract => !contract.readyToUse).forEach(contract => {
  assert.strictEqual(contract.validationProfile, null, `${contract.id} is planning guidance, not a ready asset`);
});
assert.deepStrictEqual(ROLE_POLICY.exploration_intent, { provenance: 'builder_exploration', permittedUse: 'context_only' });

function genericOutput(content, summary = 'Internal review guidance stays separate from the finished customer copy.') {
  return { summary, content };
}

function quality(id, output, customContext = context) {
  return validateCustomerReadyOutput(output, getProductionContract(id), customContext);
}

const safeCommerce = genericOutput([
  'Meet The Everyday Organizer, a clear option for careful online shoppers.',
  'Review the confirmed dimensions, materials, care instructions, delivery details, and policies on the product page.',
  'Compare those details with your needs before deciding whether this organizer fits your space.'
]);
assert.strictEqual(quality('amazon_a_plus', safeCommerce).valid, true);

const sharedFailures = [
  genericOutput(['Review production_job_id before publishing this otherwise complete customer-facing product description.']),
  genericOutput(['Review {{unconfirmed_price}} before choosing this otherwise complete customer-facing product option.']),
  genericOutput(['The keyword has 12,000 monthly searches and a high search volume, making this a strong product opportunity.']),
  genericOutput(['```json\n{"deliverable_id":"amazon_a_plus","status":"ready"}\n```']),
  genericOutput(['Lorem ipsum'])
];
sharedFailures.forEach(output => assert.strictEqual(quality('amazon_a_plus', output).valid, false));

const allowedEmailPlaceholder = {
  content: [
    'Subject: A quick reminder about The Everyday Organizer',
    'Hi [First Name], return to [Cart Link] to review the confirmed product details and decide whether they fit your needs.',
    'If you have a question, use the support option shown on the product page.'
  ],
  summary: 'Internal lifecycle review guidance remains separate.'
};
assert.strictEqual(quality('abandoned_cart_email', allowedEmailPlaceholder).valid, true);
assert.strictEqual(quality('abandoned_cart_email', {
  ...allowedEmailPlaceholder,
  content: [...allowedEmailPlaceholder.content, 'Add [Invented Discount] before sending this reminder.']
}).valid, false);

assert.strictEqual(quality('amazon_a_plus', genericOutput([
  'Clinically proven to reduce discomfort for every customer who uses it.',
  'Certified and guaranteed to improve daily wellbeing with the confirmed formulation.',
  'Review the product page for current specifications and policies.'
])).valid, false);
assert.strictEqual(quality('amazon_a_plus', genericOutput([
  'Review the confirmed product details before deciding whether the option fits your needs.',
  'Review the confirmed product details before deciding whether the option fits your needs.',
  'Review the confirmed product details before deciding whether the option fits your needs.'
])).valid, false);

const listingDependencyContext = {
  ...context,
  dependencyOutputs: [{
    deliverableId: 'amazon_listing',
    output: genericOutput(['A practical organizer for careful online shoppers who want to compare confirmed product details before choosing.'])
  }]
};
assert.strictEqual(quality('amazon_bullet_points', genericOutput([
  'A practical organizer for careful online shoppers who want to compare confirmed product details before choosing.',
  'Review dimensions and policies before deciding whether it fits.'
]), listingDependencyContext).code, 'MARKETPLACE_QUALITY_FAILED');

assert.strictEqual(quality('abandoned_cart_email', genericOutput([
  'Your trial is ready, and only 3 units are left—act now to claim 40% off.',
  'Return today before this limited-time opportunity ends.'
])).code, 'LIFECYCLE_QUALITY_FAILED');

const social = getProductionContract('social_launch_campaign');
const safeSocial = {
  campaignTheme: 'A practical way to review the organizer',
  campaignObjective: 'Internal guidance for a careful launch.',
  posts: [
    'Considering a more organized space? Review the confirmed details for The Everyday Organizer and decide whether it fits your needs.',
    'Compare the current dimensions, materials, delivery information, and policies before choosing your next step.'
  ],
  hashtags: ['#EverydayOrganization'],
  visualDirections: ['Show only confirmed product details.'],
  postingSequence: ['Publish after availability is confirmed.']
};
assert.strictEqual(quality('social_launch_campaign', safeSocial).valid, true);
assert.strictEqual(quality('social_launch_campaign', {
  ...safeSocial,
  posts: ['This viral organizer is trending everywhere with thousands of likes.', ...safeSocial.posts]
}).code, 'PAID_SOCIAL_QUALITY_FAILED');

const planning = getProductionContract('validation_plan');
const planningOutput = planning.generateOutput(context);
assert.strictEqual(validateCustomerReadyOutput(planningOutput, planning, context).valid, true);

async function verifyBoundedRepair() {
  const base = getProductionContract('amazon_a_plus');
  const handler = Object.freeze({ ...base, requiredDependencies: [] });
  const prompts = [];
  let invocation = 0;
  const generated = await generateDeliverable({
    job: {
      deliverable_id: handler.id,
      title: 'Amazon A+ Content',
      strategic_direction: 'Create useful commerce copy.',
      strategySnapshot
    },
    productionRun: { objective: 'launch_product', user_id: 41, strategySnapshot },
    handler,
    providerRuntime: { run: async ({ invoke }) => invoke({}) },
    generatorApi: {
      async generateStructuredDeliverable(input) {
        prompts.push(input.prompt);
        invocation += 1;
        return invocation === 1
          ? genericOutput(['This product has 50,000 monthly searches and a high search volume, so every careful shopper should choose it as the leading option for daily organization.'])
          : safeCommerce;
      }
    }
  });
  assert.strictEqual(invocation, 2);
  assert.strictEqual(generated.fallbackUsed, false);
  assert.strictEqual(validateCustomerReadyOutput(generated.structuredOutput, handler, context).valid, true);
  assert.match(prompts[1], /complete replacement/i);
  assert.doesNotMatch(prompts[1], /Rejection code|strategy\.primaryCustomer|dependency\.|sourceFields|semanticRole|contract_version/);
  assert.doesNotMatch(prompts[1], /Approved source context|Evidence and provenance ledger/);
}

verifyBoundedRepair().then(() => {
  console.log('Story 3.231 Cross-Deliverable Evidence & Presentation Quality tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
