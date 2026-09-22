const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { containsUnsupportedClaim, validateCustomerReadyOutput } = require('../lib/productionQuality');
const { buildEvidenceLedger, renderEvidenceLedger } = require('../lib/productionEvidence');
const { evaluateSubstantiveUsefulness } = require('../lib/productionUsefulness');
const { isConditionalGuidance, isGeneralGuidance, reconcileClaimSupport, validateClaimSupport } = require('../lib/productionClaims');
const { compileOrganicBlocks, qualifyAsGuidance, validateBlock } = require('../lib/productionContentBlocks');
const { cleanEditorialText, inspectEditorialOutput, repairEditorialOutput } = require('../lib/productionEditorial');

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
assert(handler.providerOutputSchema.articleBlocks);
assert.strictEqual(handler.providerOutputSchema.introduction, undefined);
assert.strictEqual(handler.providerOutputSchema.claimSupport, undefined);
assert.match(handler.buildPrompt(context), /Evidence-first article blocks/i);
assert.strictEqual(isGeneralGuidance('Bookkeeping organizes financial activity so a business can review its records.'), true,
  'stable domain education may discuss a generic business without being mistaken for a customer or offer claim');
assert.strictEqual(isGeneralGuidance('Your Toronto business receives guaranteed bookkeeping results.'), false,
  'local, specific-entity, and outcome-facing statements are not general guidance');
assert.strictEqual(isGeneralGuidance('Business owners often prefer monthly bookkeeping.'), false,
  'audience behavior remains outside general guidance');
assert.strictEqual(isConditionalGuidance('Restaurant Bookkeeping in Chicago: What Independent Owners Should Review Each Month'), true,
  'decision-guide titles remain qualified guidance even when title style omits a question mark');
assert.strictEqual(isConditionalGuidance('Chicago bookkeeping firms save owners 30 percent each month'), false,
  'factual and performance-oriented titles still require confirmed evidence');

const generalBlock = {
  id: 'records', heading: 'Organize the records', supportType: 'general_guidance', sourceIds: [],
  copy: 'A ledger groups financial entries into categories for later review. Organized records make individual entries easier to locate during a review.'
};
assert.strictEqual(validateBlock(generalBlock, context).valid, true);
const mixedSafeBlock = validateBlock({
  id: 'mixed-safe',
  heading: 'Toronto bookkeeping decisions without a standalone factual claim',
  copy: 'The service includes monthly bookkeeping and financial reporting. Review the records before deciding which follow-up work may be useful.',
  supportType: 'confirmed_fact',
  sourceIds: ['strategy.confirmedOffer']
}, context);
assert.strictEqual(mixedSafeBlock.valid, true, 'a block may combine sourced facts with safely qualified guidance');
assert.strictEqual(mixedSafeBlock.mappings.length, 2);
assert.strictEqual(validateBlock({
  ...generalBlock,
  copy: 'Toronto business owners usually need monthly bookkeeping support.'
}, context).valid, false);
const partiallyUnsupportedBlock = validateBlock({
  ...generalBlock,
  copy: `${generalBlock.copy} Toronto business owners usually need monthly bookkeeping support.`
}, context);
assert.strictEqual(partiallyUnsupportedBlock.valid, true, 'isolated unsupported sentences do not discard an otherwise useful block');
assert(partiallyUnsupportedBlock.sanitizedCopy.includes('Consider whether Toronto business owners usually need monthly bookkeeping support.'),
  'unsupported assertions are preserved only as explicitly qualified guidance');
assert.strictEqual(qualifyAsGuidance('Records are always complete.'), 'Consider whether records are always complete.');
const compiledBlocks = compileOrganicBlocks({
  pillarTitle: 'A practical bookkeeping guide',
  articleBlocks: Array.from({ length: 6 }, (_, index) => ({ ...generalBlock, id: `block-${index + 1}`, heading: `Review area ${index + 1}` }))
}, context);
assert.match(compiledBlocks.introduction, /^## Review area 1/m);
assert(compiledBlocks.claimSupport.length >= 12);

const usefulAudienceStatement = {
  ...handler.generateOutput(context),
  introduction: `${handler.generateOutput(context).introduction}\n\nBusiness owners often need a clean handoff before year-end review.`
};
assert.strictEqual(validateCustomerReadyOutput(usefulAudienceStatement, handler, context).code, 'PRODUCTION_QUALITY_CLAIM_PROVENANCE',
  'evidence-aware contracts reject unsupported additions through the support map rather than phrase-level audience rules');

const valid = handler.generateOutput(context);
assert.strictEqual(cleanEditorialText('Consider whether For owners who need support, bookkeeping works best when records are ready .'),
  'For owners who need support, bookkeeping can work more effectively when records are ready.');
const repairedOperationalClaim = cleanEditorialText('That sequence helps prevent work from getting repeated or overlooked.');
assert.strictEqual(repairedOperationalClaim, 'That sequence provides a checkpoint for identifying repeated or overlooked work.');
assert.strictEqual(containsUnsupportedClaim(repairedOperationalClaim, { productComposition: false }), false);
assert.strictEqual(cleanEditorialText('Consider whether This step is about scope. Consider whether choose a reporting cadence.'),
  'This step is about scope. Choose a reporting cadence.');
assert.strictEqual(cleanEditorialText('Some restaurants need a full monthly close. Others need account reconciliation.'),
  'Depending on the situation, the work may require a full monthly close. Alternatively, the work may require account reconciliation.');
assert.strictEqual(cleanEditorialText('Bookkeeping questions rarely begin with one account alone.'),
  'Bookkeeping questions may involve more than one account.');
assert(inspectEditorialOutput({ ...valid, distributionPosts: ['Some restaurants often need a cleanup.'] }, handler)
  .some(item => item.rule === 'audience_generalization'));
const malformedEditorial = {
  ...valid,
  introduction: `${valid.introduction}\n\nConsider whether For owners who need support, bookkeeping works best when records are ready .`
};
const editorialFailure = validateCustomerReadyOutput(malformedEditorial, handler, context);
assert.strictEqual(editorialFailure.code, 'PRODUCTION_QUALITY_EDITORIAL');
assert(editorialFailure.details.editorialIssues.some(item => item.rule === 'malformed_transition'));
const editorialRepair = repairEditorialOutput(malformedEditorial, handler);
assert.strictEqual(inspectEditorialOutput(editorialRepair, handler).length, 0);
assert.match(editorialRepair.introduction, /For owners who need support, bookkeeping can work more effectively when records are ready\./);
const useful = evaluateSubstantiveUsefulness(valid, handler, context);
assert.strictEqual(useful.valid, true, JSON.stringify(useful));
assert(useful.metrics.developedSectionCount >= 5);
assert(useful.metrics.groundedEvidenceIds.length >= 2);

const suppliedOfferOnlyContext = buildProductionContext({
  productionRun: { objective: 'improve_search_rankings', strategySnapshot: {
    ...strategySnapshot,
    confirmedOffer: undefined,
    customerMotivation: { value: 'Generate qualified leads', semanticRole: 'confirmed_fact' },
    marketingFocus: { value: 'Validate supplied topics: small business bookkeeping; year-end bookkeeping questions', semanticRole: 'strategic_recommendation' },
    confirmedPrimaryCta: { value: 'Book a free consultation', semanticRole: 'confirmed_fact' }
  } },
  job: {
    deliverable_id: handler.id,
    title: handler.title,
    strategic_direction: 'Builder-provided offer description: I run a Toronto bookkeeping firm with service pages and a practical advice blog. Treat this as unverified context, not proof of performance, demand, differentiation, claims, or substantiation.',
    strategySnapshot: {
      ...strategySnapshot,
      confirmedOffer: undefined,
      customerMotivation: { value: 'Generate qualified leads', semanticRole: 'confirmed_fact' },
      marketingFocus: { value: 'Validate supplied topics: small business bookkeeping; year-end bookkeeping questions', semanticRole: 'strategic_recommendation' },
      confirmedPrimaryCta: { value: 'Book a free consultation', semanticRole: 'confirmed_fact' }
    }
  },
  dependencyOutputs
});
const suppliedOfferFallback = handler.generateOutput(suppliedOfferOnlyContext);
assert.strictEqual(validateCustomerReadyOutput(suppliedOfferFallback, handler, suppliedOfferOnlyContext).valid, true,
  'the deterministic fallback remains provenance-safe when the offer is supplied context rather than a confirmed fact');
assert.match(suppliedOfferFallback.pillarTitle, /small business bookkeeping/i);
assert.doesNotMatch(suppliedOfferFallback.introduction, /I run a Toronto bookkeeping firm/i,
  'unverified builder descriptions never leak into deterministic public copy');
assert.strictEqual(suppliedOfferOnlyContext.compositionBrief.primaryTopic, 'small business bookkeeping');
assert.deepStrictEqual(suppliedOfferOnlyContext.compositionBrief.supportingTopics, ['year-end bookkeeping questions']);
assert.strictEqual(suppliedOfferOnlyContext.compositionBrief.domainId, 'bookkeeping_services');
assert.match(handler.buildPrompt(suppliedOfferOnlyContext), /Intermediate composition brief:/);
assert.match(handler.buildPrompt(suppliedOfferOnlyContext), /Primary article topic: small business bookkeeping/);
assert.match(handler.buildPrompt(suppliedOfferOnlyContext), /Supporting topics: year-end bookkeeping questions/);
assert.match(suppliedOfferFallback.pillarTitle, /small business bookkeeping/i);
assert.doesNotMatch(suppliedOfferFallback.pillarTitle, /year-end bookkeeping questions/i,
  'supporting topics are not concatenated into the primary title');

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
const reconciledMap = reconcileClaimSupport(incompleteMap, handler, context);
assert.strictEqual(validateClaimSupport(reconciledMap, handler, context).valid, true,
  'the production boundary deterministically restores omitted audit mappings that the finished copy itself supports');
const reconciledDecisionGuideTitle = reconcileClaimSupport({
  ...valid,
  pillarTitle: 'Restaurant Bookkeeping in Chicago: What Independent Owners Should Review Each Month',
  claimSupport: valid.claimSupport.filter(item => !item.includes(` :: ${valid.pillarTitle}`))
}, handler, context);
assert(reconciledDecisionGuideTitle.claimSupport.includes(
  'conditional_guidance :: Restaurant Bookkeeping in Chicago: What Independent Owners Should Review Each Month'));
assert.strictEqual(validateClaimSupport(reconciledDecisionGuideTitle, handler, context).valid, true,
  'the backend restores provenance for an industry-specific decision-guide title without model-authored audit metadata');
const reconciledDistribution = reconcileClaimSupport({
  ...valid,
  distributionPosts: ['Bookkeeping always makes every Toronto company more profitable.'],
  claimSupport: valid.claimSupport
}, handler, context);
assert.strictEqual(reconciledDistribution.distributionPosts[0],
  'Consider whether bookkeeping always makes every Toronto company more profitable.');
assert(reconciledDistribution.claimSupport.includes(
  'conditional_guidance :: Consider whether bookkeeping always makes every Toronto company more profitable.'));
assert.strictEqual(validateClaimSupport(reconciledDistribution, handler, context).valid, true,
  'unsupported generated distribution prose is safely qualified instead of forcing the entire article onto the deterministic fallback');
const domainEducation = reconcileClaimSupport({
  ...valid,
  introduction: `${valid.introduction}\n\nA ledger groups business entries into categories for later review.`,
  claimSupport: [...valid.claimSupport]
}, handler, context);
assert(domainEducation.claimSupport.some(item => item === 'general_guidance :: A ledger groups business entries into categories for later review.'));
assert.strictEqual(validateClaimSupport(domainEducation, handler, context).valid, true,
  'generic domain education remains usable without being promoted to a sourced claim about this business');

const singleFactContext = buildProductionContext({
  productionRun: {
    objective: 'improve_search_rankings',
    strategySnapshot: {
      confirmedOffer: strategySnapshot.confirmedOffer,
      marketPosition: strategySnapshot.marketPosition,
      suppliedEvidence: strategySnapshot.suppliedEvidence
    }
  },
  job: { deliverable_id: handler.id, title: handler.title, strategic_direction: 'Create useful search education.' },
  dependencyOutputs
});
const singleFactOutput = reconcileClaimSupport({
  ...valid,
  pillarTitle: 'A practical bookkeeping review guide',
  introduction: domainEducation.introduction,
  callToAction: 'Consider reviewing the records before choosing the next step.',
  distributionPosts: ['Review the records before choosing the next step.'],
  claimSupport: []
}, handler, singleFactContext);
assert.strictEqual(validateClaimSupport(singleFactOutput, handler, singleFactContext).valid, true,
  'provenance validates each claim without imposing a separate confirmed-evidence quota');
assert.strictEqual(evaluateSubstantiveUsefulness(singleFactOutput, handler, singleFactContext).valid, true,
  'the usefulness contract remains responsible for evidence depth and substantive value');

const qualifiedGuidance = {
  ...valid,
  introduction: `${valid.introduction}\n\nIf records are incomplete, gather the missing source documents before choosing the next review step.`,
  claimSupport: [...valid.claimSupport, 'conditional_guidance :: If records are incomplete, gather the missing source documents before choosing the next review step.']
};
assert.strictEqual(validateClaimSupport(qualifiedGuidance, handler, context).valid, true,
  'genuinely conditional guidance remains available without pretending it is evidence');

console.log('Story 3.229 Evidence Provenance & Usefulness Contract tests passed');
