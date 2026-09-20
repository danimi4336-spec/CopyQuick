const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { buildEvidenceLedger, renderEvidenceLedger } = require('../lib/productionEvidence');
const { evaluateSubstantiveUsefulness } = require('../lib/productionUsefulness');
const { validateClaimSupport } = require('../lib/productionClaims');

const strategySnapshot = {
  confirmedOffer: { value: 'Monthly bookkeeping and financial reporting', semanticRole: 'confirmed_fact', sourceFields: ['search_site'] },
  primaryCustomer: { value: 'Owners of Toronto businesses with 5–25 employees', semanticRole: 'confirmed_fact', sourceFields: ['search_audience'] },
  marketPosition: { value: 'Evidence-grounded search growth', semanticRole: 'strategic_recommendation' },
  suppliedEvidence: { value: 'Unknown', semanticRole: 'unresolved' }
};
const dependencyOutputs = [{
  deliverableId: 'campaign_brief', title: 'Priority Content Brief', contractVersion: 'campaign_brief:v3',
  output: { summary: 'Answer year-end bookkeeping questions.' }
}];
const ledger = buildEvidenceLedger({ strategySnapshot, dependencyOutputs });
assert.strictEqual(ledger.find(item => item.id === 'strategy.confirmedOffer').permittedUse, 'public_claim');
assert.strictEqual(ledger.find(item => item.id === 'strategy.marketPosition').permittedUse, 'direction_only');
assert.strictEqual(ledger.find(item => item.id === 'dependency.campaign_brief.summary').permittedUse, 'direction_only');
assert.match(renderEvidenceLedger(ledger), /CONFIRMED FACTS/);
assert.match(renderEvidenceLedger(ledger), /RECOMMENDATIONS AND GENERATED PLANS/);
assert.match(renderEvidenceLedger(ledger), /id: strategy\.confirmedOffer/,
  'the rendered ledger exposes the exact stable IDs required by the claim-support contract');

const handler = getProductionContract('organic_content_campaign');
const context = buildProductionContext({
  productionRun: { objective: 'improve_search_rankings', strategySnapshot },
  job: { deliverable_id: handler.id, title: handler.title, strategic_direction: 'Create useful search education.', strategySnapshot },
  dependencyOutputs
});
assert(Object.isFrozen(context.evidenceLedger));
assert.match(handler.buildPrompt(context), /Evidence and provenance ledger/);
assert.match(handler.buildPrompt(context), /may be stated in public copy/);
assert.match(handler.buildPrompt(context), /direction only, not facts/);
assert.match(handler.buildPrompt(context), /id: strategy\.primaryCustomer/);

const usefulAudienceStatement = {
  ...handler.generateOutput(context),
  introduction: `${handler.generateOutput(context).introduction}\n\nBusiness owners often need a clean handoff before year-end review.`
};
assert.strictEqual(validateCustomerReadyOutput(usefulAudienceStatement, handler, context).code, 'PRODUCTION_QUALITY_CLAIM_PROVENANCE',
  'evidence-aware contracts reject unsupported additions through the support map rather than phrase-level audience rules');

const valid = handler.generateOutput(context);
const useful = evaluateSubstantiveUsefulness(valid, handler, context);
assert.strictEqual(useful.valid, true, JSON.stringify(useful));
assert(useful.metrics.developedSectionCount >= 5);
assert(useful.metrics.groundedEvidenceIds.length >= 2);

const genericPadding = {
  ...valid,
  introduction: [
    '## General overview',
    Array(35).fill('Clear information supports a useful process.').join(' '),
    '## More context',
    Array(35).fill('A useful process supports clear information.').join(' '),
    '## Another consideration',
    Array(35).fill('Information and process should remain clear.').join(' '),
    '## Closing thought',
    Array(35).fill('Clarity is useful for the process.').join(' ')
  ].join('\n\n')
};
const rejected = validateCustomerReadyOutput(genericPadding, handler, context);
assert.strictEqual(rejected.valid, false);
assert(['PRODUCTION_QUALITY_REPETITIVE_OUTPUT', 'PRODUCTION_QUALITY_INSUFFICIENT_USEFULNESS'].includes(rejected.code));

const superficiallyLong = {
  ...valid,
  introduction: [
    '## Background', Array(30).fill('This topic deserves a careful explanation for readers.').join(' '),
    '## Context', Array(30).fill('The subject has several considerations worth understanding.').join(' '),
    '## Perspective', Array(30).fill('A thoughtful perspective can make the subject easier to understand.').join(' '),
    '## Conclusion', Array(30).fill('Readers can consider the information and decide what matters.').join(' ')
  ].join('\n\n')
};
assert.strictEqual(evaluateSubstantiveUsefulness(superficiallyLong, handler, context).valid, false,
  'long generic prose does not satisfy the substantive-usefulness contract');

const unknownEvidence = { ...valid, claimSupport: [...valid.claimSupport] };
unknownEvidence.claimSupport[0] = unknownEvidence.claimSupport[0].replace(/^[^:]+/, 'unknown.source');
assert.strictEqual(validateClaimSupport(unknownEvidence, handler, context).valid, false,
  'unknown evidence IDs cannot support public claims');

const directionOnlyEvidence = { ...valid, claimSupport: [...valid.claimSupport] };
directionOnlyEvidence.claimSupport[0] = directionOnlyEvidence.claimSupport[0].replace(/^[^:]+/, 'dependency.campaign_brief.summary');
assert.strictEqual(validateClaimSupport(directionOnlyEvidence, handler, context).valid, false,
  'generated planning guidance cannot be promoted into public evidence');

const staleExcerpt = { ...valid, claimSupport: [...valid.claimSupport] };
staleExcerpt.claimSupport[0] = `${staleExcerpt.claimSupport[0]} changed`;
assert.strictEqual(validateClaimSupport(staleExcerpt, handler, context).valid, false,
  'support-map excerpts must exactly match current public copy');

const unsupportedRegulatoryClaim = {
  ...valid,
  introduction: `${valid.introduction}\n\nHST records are required for every Toronto bookkeeping review.`,
  claimSupport: [...valid.claimSupport, 'general_guidance :: HST records are required for every Toronto bookkeeping review.']
};
assert.strictEqual(validateClaimSupport(unsupportedRegulatoryClaim, handler, context).valid, false,
  'local or regulated claims cannot be disguised as general guidance');

const incompleteMap = { ...valid, claimSupport: valid.claimSupport.slice(1) };
assert.strictEqual(validateClaimSupport(incompleteMap, handler, context).valid, false,
  'every substantive public sentence requires provenance');

const qualifiedGuidance = {
  ...valid,
  introduction: `${valid.introduction}\n\nIf records are incomplete, gather the missing source documents before choosing the next review step.`,
  claimSupport: [...valid.claimSupport, 'conditional_guidance :: If records are incomplete, gather the missing source documents before choosing the next review step.']
};
assert.strictEqual(validateClaimSupport(qualifiedGuidance, handler, context).valid, true,
  'genuinely conditional guidance remains available without pretending it is evidence');

console.log('Story 3.229 Evidence Provenance & Usefulness Contract tests passed');
