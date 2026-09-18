const assert = require('assert');

const { getProductionArtifactPolicy } = require('../lib/productionArtifactPolicy');
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
assert.strictEqual(organic.version, 'organic_content_campaign:v4');
assert.deepStrictEqual(organic.publicFieldKeys, ['pillarTitle', 'introduction', 'callToAction', 'distributionPosts']);
assert.deepStrictEqual(organic.internalFieldKeys, ['campaignOverview', 'searchIntent', 'outline', 'publishingChecklist']);

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

const prompt = organic.buildPrompt(context);
assert.match(prompt, /Public-copy fields: pillarTitle, introduction, callToAction, distributionPosts/i);
assert.match(prompt, /Internal-guidance fields: campaignOverview, searchIntent, outline, publishingChecklist/i);
assert.match(prompt, /complete pillar article draft, not merely an introduction/i);
assert.match(prompt, /at least 700 words/i);

const shortArticle = { ...valid, introduction: 'A brief introduction that is not a complete pillar article.' };
assert.deepStrictEqual(validateCustomerReadyOutput(shortArticle, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_REQUIRED_CONTENT_MISSING'
});

const editorialLeak = {
  ...valid,
  introduction: `${valid.introduction}\n\nBecause the available evidence is still incomplete, this content should avoid claims that are not yet validated.`
};
assert.deepStrictEqual(validateCustomerReadyOutput(editorialLeak, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS'
});

const behaviorLeak = {
  ...valid,
  introduction: valid.introduction.replace('If you are one of', 'Business owners often need help. If you are one of')
};
assert.deepStrictEqual(validateCustomerReadyOutput(behaviorLeak, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_INVENTED_AUDIENCE_BEHAVIOR'
});

const publicationLeak = {
  ...valid,
  distributionPosts: ['We published a new guide for Toronto business owners.', ...valid.distributionPosts]
};
assert.deepStrictEqual(validateCustomerReadyOutput(publicationLeak, organic, context), {
  valid: false,
  code: 'PRODUCTION_QUALITY_UNCONFIRMED_PUBLICATION_STATUS'
});

const internalEditorialGuidance = {
  ...valid,
  campaignOverview: 'Because the available evidence is still incomplete, this content should avoid claims that are not yet validated.'
};
assert.strictEqual(validateCustomerReadyOutput(internalEditorialGuidance, organic, context).valid, true,
  'editorial guidance belongs in an explicitly internal field');

console.log('Story 3.228 Production Contract Field Roles tests passed');
