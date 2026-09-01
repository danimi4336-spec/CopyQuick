const assert = require('assert');
const { bundleAssets, resolveBundleAsset } = require('../lib/generatorModes');

assert.strictEqual(bundleAssets.length, 10);
assert.strictEqual(new Set(bundleAssets.map(asset => asset.id)).size, bundleAssets.length, 'bundle asset IDs must be unique');

for (const asset of bundleAssets) {
  assert(asset.contentType, `${asset.id} must declare its generator content type`);
  assert.deepStrictEqual(resolveBundleAsset(asset.id, asset.label), {
    id: asset.id,
    label: asset.label,
    contentType: asset.contentType
  });
  assert.deepStrictEqual(resolveBundleAsset(asset.legacyId, asset.label), {
    id: asset.id,
    label: asset.label,
    contentType: asset.contentType
  });
}

assert.strictEqual(resolveBundleAsset('email_drafts', 'Amazon Product Description'), null);
assert.strictEqual(resolveBundleAsset('subject_line', 'Email Subject Lines'), null);
assert.strictEqual(resolveBundleAsset('unknown', 'Email Drafts'), null);
assert.deepStrictEqual(resolveBundleAsset('amazon_listing', 'Amazon Listing'), {
  id: 'amazon_listing',
  label: 'Amazon Listing',
  contentType: 'product_description'
});

console.log('Story 3.105 Canonical Bundle Assets tests passed');
