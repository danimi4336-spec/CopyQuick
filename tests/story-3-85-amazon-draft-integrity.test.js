const assert = require('assert');

const { getProductionContract } = require('../lib/productionContracts');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const context = {
  title: 'Amazon Listing Draft',
  strategicDirection: 'Recommended market direction: Natural Digestive Wellness Direction · Builder-provided product context: Herbal capsules in a finalized 60-count bottle. Treat this as unverified context, not proof of ingredients, efficacy, claims, or substantiation.',
  strategySnapshot: {
    marketPosition: { value: 'Natural Digestive Wellness Direction', semanticRole: 'strategic_recommendation' },
    primaryCustomer: { value: 'Adults', semanticRole: 'confirmed_fact' },
    customerMotivation: { value: 'Digestive health', semanticRole: 'confirmed_fact' }
  },
  dependencyOutputs: []
};

const listing = getProductionContract('amazon_listing');
const listingOutput = listing.generateOutput(context);
assert.strictEqual(listing.validateOutput(listingOutput), true);
assert.strictEqual(validateCustomerReadyOutput(listingOutput, listing).valid, true);
assert.match(listingOutput.summary, /Working Amazon listing draft/);
assert.match(JSON.stringify(listingOutput), /Herbal capsules in a finalized 60-count bottle/);
assert.match(JSON.stringify(listingOutput), /verify every product fact|verified product attributes/i);
assert.doesNotMatch(JSON.stringify(listingOutput), /search volume|market size|clinically proven|guaranteed results/i);

const bullets = getProductionContract('amazon_bullet_points');
const bulletOutput = bullets.generateOutput({ ...context, title: 'Amazon Bullet Point Drafts' });
assert.strictEqual(bullets.validateOutput(bulletOutput), true);
assert.strictEqual(validateCustomerReadyOutput(bulletOutput, bullets).valid, true);
assert.strictEqual(bulletOutput.content.length, 5);
assert.match(JSON.stringify(bulletOutput), /must be verified before publication/i);
assert.doesNotMatch(JSON.stringify(bulletOutput), /contains digestive enzymes|FDA approved|best-selling/i);

const missingContext = { ...context, strategicDirection: 'Recommended market direction: Natural Digestive Wellness Direction' };
const missingListing = listing.generateOutput(missingContext);
const missingBullets = bullets.generateOutput(missingContext);
assert.strictEqual(listing.validateOutput(missingListing), false);
assert.strictEqual(bullets.validateOutput(missingBullets), false);
assert.strictEqual(validateCustomerReadyOutput(missingListing, listing).valid, false);
assert.strictEqual(validateCustomerReadyOutput(missingBullets, bullets).valid, false);

console.log('Story 3.85 Amazon Draft Integrity tests passed');
