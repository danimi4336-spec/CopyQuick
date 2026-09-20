const assert = require('assert');

const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
const { createProductionStrategySnapshot } = require('../lib/buildPlanApproval');
const { getProductionContract, getProductionContractIds } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

for (const id of getProductionContractIds()) {
  const contract = getProductionContract(id);
  const schemaKeys = Object.keys(contract.outputSchema).sort();
  const roleKeys = Object.keys(contract.sectionRoles).sort();
  assert.deepStrictEqual(roleKeys, schemaKeys, `${id} must assign one role to every field`);
  assert(schemaKeys.every(key => ['public_copy', 'internal_guidance'].includes(contract.sectionRoles[key])), `${id} uses only supported roles`);
  assert.deepStrictEqual(
    [...contract.publicFieldKeys, ...contract.internalFieldKeys].sort(),
    schemaKeys,
    `${id} public and internal fields must be exhaustive`
  );
  assert.strictEqual(new Set([...contract.publicFieldKeys, ...contract.internalFieldKeys]).size, schemaKeys.length, `${id} roles must not overlap`);
  if (getProductionArtifactPolicy(id).readyToUse) assert(contract.publicFieldKeys.length > 0, `${id} must expose public copy`);
  else assert.strictEqual(contract.publicFieldKeys.length, 0, `${id} planning foundation must remain internal`);
}

const organic = getProductionContract('organic_content_campaign');
assert.strictEqual(organic.version, 'organic_content_campaign:v9');
assert.strictEqual(organic.acceptsVersion('organic_content_campaign:v4'), true);
assert.strictEqual(organic.acceptsVersion('organic_content_campaign:v5'), true);
assert.strictEqual(organic.acceptsVersion('organic_content_campaign:v6'), true);
assert.strictEqual(organic.acceptsVersion('organic_content_campaign:v7'), true);
assert.strictEqual(organic.usefulnessContract.policy, 'decision_usefulness_v2');
assert.strictEqual(organic.claimProvenanceContract.policy, 'claim_provenance_v1');
assert.deepStrictEqual(organic.publicFieldKeys, ['pillarTitle', 'introduction', 'callToAction', 'distributionPosts']);
assert.deepStrictEqual(organic.internalFieldKeys, ['campaignOverview', 'searchIntent', 'outline', 'publishingChecklist', 'claimSupport']);

const context = {
  title: 'Search-Led Content Package',
  strategicDirection: 'Create useful search-led education for the confirmed audience.',
  strategySnapshot: {
    confirmedOffer: { value: 'Monthly bookkeeping and financial reporting', semanticRole: 'confirmed_fact' },
    primaryCustomer: { value: 'Owners of Toronto businesses with 5–25 employees', semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Generate qualified leads', semanticRole: 'confirmed_fact' }
  },
  dependencyOutputs: []
};
const valid = organic.generateOutput(context);
assert.strictEqual(organic.validateOutput(valid, context), true, 'fallback organic asset must be a complete article');
assert(String(valid.introduction).split(/\s+/).length >= 550);
assert.strictEqual(validateCustomerReadyOutput(valid, organic, context).valid, true);

const sections = organic.presentationSections(valid);
assert.strictEqual(sections.find(section => section.key === 'campaignOverview').internal, true);
assert.strictEqual(sections.find(section => section.key === 'searchIntent').internal, true);
assert.strictEqual(sections.find(section => section.key === 'outline').internal, true);
assert.strictEqual(sections.find(section => section.key === 'publishingChecklist').internal, true);
assert.strictEqual(sections.find(section => section.key === 'introduction').internal, false);
assert.strictEqual(sections.find(section => section.key === 'introduction').label, 'Pillar Article Draft');
assert.strictEqual(sections.find(section => section.key === 'introduction').format, 'markdown');
assert.strictEqual(sections.find(section => section.key === 'searchIntent').guidanceLabel, 'Hypothesis');
assert.strictEqual(sections.find(section => section.key === 'outline').guidanceLabel, 'Hypothesis');
assert.strictEqual(sections.find(section => section.key === 'publishingChecklist').guidanceLabel, 'Checklist');

const prompt = organic.buildPrompt(context);
assert.match(prompt, /Public-copy fields: pillarTitle, articleBlocks, callToAction, distributionPosts/i);
assert.match(prompt, /Internal-guidance fields: campaignOverview, searchIntent, outline, publishingChecklist/i);
assert.match(prompt, /articleBlocks collectively form the complete pillar article draft/i);
assert.match(prompt, /800 to 1,600 substantive words/i);

const shortArticle = { ...valid, introduction: 'A brief introduction that is not a complete pillar article.' };
assert.deepStrictEqual(validateCustomerReadyOutput(shortArticle, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_REQUIRED_CONTENT_MISSING'
});

const editorialLeak = {
  ...valid,
  introduction: `${valid.introduction}\n\nBecause the available evidence is still incomplete, this content should avoid claims that are not yet validated.`
};
assert.strictEqual(validateCustomerReadyOutput(editorialLeak, organic, context).code, 'PRODUCTION_QUALITY_CLAIM_PROVENANCE',
  'the evidence-aware contract requires public-copy changes to be reflected in the claim support map');

const behaviorLeak = {
  ...valid,
  introduction: valid.introduction.replace('If you are one of', 'Business owners often need professional help before completing their bookkeeping. If you are one of')
};
assert.strictEqual(validateCustomerReadyOutput(behaviorLeak, organic, context).code, 'PRODUCTION_QUALITY_CLAIM_PROVENANCE',
  'the evidence-aware contract rejects an unsupported audience assertion through claim provenance rather than a phrase blacklist');

const publicationLeak = {
  ...valid,
  distributionPosts: ['We published a new guide for Toronto business owners.', ...valid.distributionPosts]
};
assert.deepStrictEqual(validateCustomerReadyOutput(publicationLeak, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_UNCONFIRMED_PUBLICATION_STATUS'
});

const placeholderLeak = {
  ...valid,
  distributionPosts: ['Read the complete guide at [link].', ...valid.distributionPosts]
};
assert.deepStrictEqual(validateCustomerReadyOutput(placeholderLeak, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_UNRESOLVED_PLACEHOLDER'
});

const broaderBehaviorLeak = {
  ...valid,
  introduction: `${valid.introduction}\n\nOwners often begin with a basic question about their books.`
};
assert.strictEqual(validateCustomerReadyOutput(broaderBehaviorLeak, organic, context).code, 'PRODUCTION_QUALITY_CLAIM_PROVENANCE');

for (const inventedStatement of [
  'Business owners want clear answers before choosing a service.',
  'Year-end questions often come up as businesses prepare to close the books.',
  'Year-end review often includes reconciling bank accounts for every business.',
  'For many businesses, bookkeeping becomes harder as the company grows.',
  'Some businesses keep basic transaction capture inside the company. Others prefer outside support.'
]) {
  const inventedOutput = { ...valid, introduction: `${valid.introduction}\n\n${inventedStatement}` };
  assert.strictEqual(validateCustomerReadyOutput(inventedOutput, organic, context).code, 'PRODUCTION_QUALITY_CLAIM_PROVENANCE', inventedStatement);
}

const legacyOrganic = { ...organic, version: 'organic_content_campaign:v6' };
assert.strictEqual(validateCustomerReadyOutput(editorialLeak, legacyOrganic, context).code,
  'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS');
assert.strictEqual(validateCustomerReadyOutput(behaviorLeak, legacyOrganic, context).code,
  'PRODUCTION_QUALITY_INVENTED_AUDIENCE_BEHAVIOR');

for (const unconfirmedNewness of ['This new guide explains the process.', 'Read our new article about year-end bookkeeping.']) {
  const newnessOutput = { ...valid, distributionPosts: [unconfirmedNewness, ...valid.distributionPosts] };
  assert.deepStrictEqual(validateCustomerReadyOutput(newnessOutput, organic, context), {
    valid: false,
    code: 'PRODUCTION_QUALITY_UNCONFIRMED_PUBLICATION_STATUS'
  }, unconfirmedNewness);
}

const repeatedParagraph = String(valid.introduction).split(/\n\s*\n+/)[1];
const repetitiveOutput = { ...valid, introduction: `${valid.introduction}\n\n## Repeated conclusion\n\n${repeatedParagraph}` };
assert.deepStrictEqual(validateCustomerReadyOutput(repetitiveOutput, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT'
});

const overlongOutput = { ...valid, introduction: Array(3).fill(valid.introduction).join('\n\n') };
assert.deepStrictEqual(validateCustomerReadyOutput(overlongOutput, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_REQUIRED_CONTENT_MISSING'
});

const exactCtaContext = {
  ...context,
  strategySnapshot: {
    ...context.strategySnapshot,
    confirmedPrimaryCta: { value: 'Book a free consultation', semanticRole: 'confirmed_fact' }
  }
};
const exactCtaOutput = organic.generateOutput(exactCtaContext);
assert.strictEqual(exactCtaOutput.callToAction, 'Book a free consultation');
assert.strictEqual(organic.validateOutput(exactCtaOutput, exactCtaContext), true);
assert.strictEqual(organic.validateOutput({ ...exactCtaOutput, callToAction: 'Contact us' }, exactCtaContext), false);

const searchSnapshot = createProductionStrategySnapshot({
  objective: 'improve_search_rankings',
  strategyResult: { strategy: context.strategySnapshot },
  confirmedUnderstanding: {
    primaryCta: { value: 'Book a free consultation', label: 'Book a free consultation', source: 'user_confirmed' }
  }
});
assert.strictEqual(searchSnapshot.confirmedPrimaryCta.value, 'Book a free consultation');
assert.strictEqual(searchSnapshot.confirmedPrimaryCta.semanticRole, 'confirmed_fact');

const internalEditorialGuidance = {
  ...valid,
  campaignOverview: 'Because the available evidence is still incomplete, this content should avoid claims that are not yet validated.'
};
assert.strictEqual(validateCustomerReadyOutput(internalEditorialGuidance, organic, context).valid, true,
  'editorial guidance belongs in an explicitly internal field');

console.log('Story 3.228 Production Contract Field Roles tests passed');
