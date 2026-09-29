const assert = require('assert');

const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const repeated = 'This polished-looking sentence repeats without adding any distinct customer value or deliverable substance.';

for (const id of getProductionContractIds()) {
  const contract = getProductionContract(id);
  const output = Object.fromEntries(Object.entries(contract.outputSchema).map(([key, type]) => [
    key,
    type === 'blocks'
      ? Array.from({ length: 5 }, (_, index) => ({ heading: `Section ${index + 1}`, body: repeated }))
      : type === 'article_blocks_v2'
        ? Array.from({ length: 5 }, (_, index) => ({ heading: `Section ${index + 1}`, body: repeated, claims: [{ claimKey: `claim-${index + 1}`, text: repeated, evidenceRequired: false, evidenceKeys: [] }] }))
      : type === 'object_array' ? [{}]
      : type === 'boolean' ? false
      : type === 'array' || type === 'optional_array'
      ? (id === 'outreach_sequence' ? [repeated, repeated, repeated] : [repeated])
      : type === 'optional_string' ? repeated
        : (id === 'outreach_sequence' && /Body$/.test(key)
          ? `Hi [First Name],\n\n${repeated} ${repeated} ${repeated}\n\nBest,\n[Sender Name]`
          : repeated)
  ]));
  if (id === 'organic_content_campaign') {
    output.introduction = Array.from({ length: 8 }, (_, index) => `## Section ${index + 1}\n\n${Array(14).fill(repeated).join(' ')}`).join('\n\n');
    output.outline = Array(5).fill(repeated);
    output.distributionPosts = Array(2).fill(repeated);
  }
  if (id === 'priority_search_article') {
    output.articleBlocks = Array.from({ length: 5 }, (_, index) => ({ heading: `Section ${index + 1}`, body: repeated, claims: [{ claimKey: `claim-${index + 1}`, text: repeated, evidenceRequired: false, evidenceKeys: [] }] }));
    output.sources = [];
  }
  if (id === 'research_evidence_pack') {
    Object.assign(output, { researchSummary: repeated, researchQuestions: [repeated], sourcesUsed: [], supportedFindings: [], unsupportedQuestions: [], conflicts: [], freshnessNotes: [repeated], sources: [], evidenceItems: [], claimMappings: [], rejectedSources: [], researchTrace: [], providerSummary: {}, researchAvailabilityStatus: 'not_required', researchOperations: {}, researchStatus: 'No research needed', questionsChecked: 0, supportedQuestionCount: 0, questionsNeedingEvidence: 0, sourcesUsedCount: 0, lastCheckedAt: '2026-09-29T12:00:00.000Z', limitationNote: '', noExternalEvidenceRequired: true, essentialEvidenceMissing: false });
    assert.strictEqual(contract.validateOutput(output), true, `${id} fixture must satisfy its structural contract`);
    assert.strictEqual(validateCustomerReadyOutput(output, contract).valid, true, `${id} uses evidence-specific validation rather than copy repetition`);
    continue;
  }
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
const editorialLandingPage = {
  ...validLandingPage,
  proofSection: 'This offer is presented as a service description. Testimonials should only be added after they have been verified.'
};
assert.deepStrictEqual(validateCustomerReadyOutput(editorialLandingPage, landingPage), {
  valid: false,
  code: 'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS'
});
const generatedProofLeak = {
  ...validLandingPage,
  proofSection: 'This page is designed to clearly explain the service and the steps involved so you can decide whether it fits your needs. Any claims, examples, testimonials, or performance results should be supported by evidence before they are presented here.'
};
assert.deepStrictEqual(validateCustomerReadyOutput(generatedProofLeak, landingPage), {
  valid: false,
  code: 'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS'
});
const generatedFaqLeak = {
  ...validLandingPage,
  faq: [
    ...validLandingPage.faq,
    'Does this page make performance promises? No. Any performance statement should be supported by evidence before it is used in customer-facing copy.'
  ]
};
assert.deepStrictEqual(validateCustomerReadyOutput(generatedFaqLeak, landingPage), {
  valid: false,
  code: 'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS'
});
const visitorFacingProof = {
  ...validLandingPage,
  proofSection: 'Start with a free consultation to review your bookkeeping needs and confirm the monthly service scope before work begins.'
};
assert.strictEqual(validateCustomerReadyOutput(visitorFacingProof, landingPage).valid, true);

const ctaContext = {
  ...acquisitionContext,
  strategySnapshot: {
    ...acquisitionContext.strategySnapshot,
    confirmedPrimaryCta: { value: 'Book a free consultation', semanticRole: 'confirmed_fact' }
  }
};
const exactCtaLandingPage = landingPage.generateOutput(ctaContext);
assert.strictEqual(exactCtaLandingPage.primaryCallToAction, 'Book a free consultation');
assert.strictEqual(landingPage.validateOutput(exactCtaLandingPage, ctaContext), true);
assert.strictEqual(landingPage.validateOutput({ ...exactCtaLandingPage, primaryCallToAction: 'Book a call' }, ctaContext), false);
const leadCapturePrompt = landingPage.buildPrompt(ctaContext);
assert.match(leadCapturePrompt, /Proof Section must be finished visitor-facing reassurance/i);
assert.match(leadCapturePrompt, /FAQ item must answer a genuine prospective-customer question/i);
assert.match(leadCapturePrompt, /Never ask or answer questions about the page, copy, claims, evidence/i);

console.log('Story 3.91 Production Quality Coverage tests passed');
