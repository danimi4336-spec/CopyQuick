const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { buildEvidenceLedger, renderEvidenceLedger } = require('../lib/productionEvidence');
const { evaluateSubstantiveUsefulness } = require('../lib/productionUsefulness');

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
assert.deepStrictEqual(validateCustomerReadyOutput(superficiallyLong, handler, context).code, 'PRODUCTION_QUALITY_INSUFFICIENT_USEFULNESS');

console.log('Story 3.229 Evidence Provenance & Usefulness Contract tests passed');
