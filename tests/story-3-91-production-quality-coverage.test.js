const assert = require('assert');

const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const repeated = 'This polished-looking sentence repeats without adding any distinct customer value or deliverable substance.';

for (const id of getProductionContractIds()) {
  const contract = getProductionContract(id);
  const output = Object.fromEntries(Object.entries(contract.outputSchema).map(([key, type]) => [
    key,
    type === 'array'
      ? (id === 'outreach_sequence' ? [repeated, repeated, repeated] : [repeated])
      : (id === 'outreach_sequence' && /Body$/.test(key)
          ? `Hi [First Name],\n\n${repeated} ${repeated} ${repeated}\n\nBest,\n[Sender Name]`
          : repeated)
  ]));
  assert.strictEqual(contract.validateOutput(output), true, `${id} fixture must satisfy its structural contract`);
  assert.deepStrictEqual(validateCustomerReadyOutput(output, contract), {
    valid: false,
    code: 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT'
  }, `${id} must reject wholly repetitive customer content`);
}

const acquisitionContext = {
  title: 'Paid Ad Copy Set',
  strategicDirection: 'Builder-provided offer description: A local dental practice accepting new patients.',
  strategySnapshot: {
    primaryCustomer: { value: 'Adults and families seeking a local dentist', semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Book a dental appointment', semanticRole: 'confirmed_fact' }
  },
  dependencyOutputs: []
};
const paidAds = getProductionContract('paid_ad_copy_set');
const validPaidAds = paidAds.generateOutput(acquisitionContext);
assert.strictEqual(validateCustomerReadyOutput(validPaidAds, paidAds).valid, true);
const invalidPaidAds = {
  ...validPaidAds,
  ad1PrimaryText: 'Use paid advertising to reach nearby families, then test one message and scale spend after performance is validated.'
};
assert.deepStrictEqual(validateCustomerReadyOutput(invalidPaidAds, paidAds), {
  valid: false,
  code: 'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS'
});
assert.match(paidAds.buildPrompt(acquisitionContext), /marketer, publisher, testing, and compliance instructions only/i);

const landingPage = getProductionContract('lead_capture_page');
const validLandingPage = landingPage.generateOutput({ ...acquisitionContext, title: 'Lead Capture Page' });
assert.strictEqual(validateCustomerReadyOutput(validLandingPage, landingPage).valid, true);
const invalidLandingPage = {
  ...validLandingPage,
  proofSection: 'Use only evidence that can be verified before launch. Remove this section until suitable proof exists.'
};
assert.deepStrictEqual(validateCustomerReadyOutput(invalidLandingPage, landingPage), {
  valid: false,
  code: 'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS'
});

console.log('Story 3.91 Production Quality Coverage tests passed');
