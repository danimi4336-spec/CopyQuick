const assert = require('assert');
const { generateCopy } = require('../lib/generator');

const metaCopy = /\b(?:this description|product description|the copy|this version|is described|gets copy|present .* with copy|introduce .* with .* description)\b/i;
const unsupported = /\b(?:guaranteed|clinically proven|miracle results|best product|perfect choice|limited stock|discount expires)\b/i;

for (const tone of ['professional', 'casual', 'urgent', 'humorous', 'inspirational']) {
  const results = generateCopy({
    productDescription: 'an herbal dietary supplement',
    targetAudience: 'adults',
    contentType: 'product_description',
    tone
  });
  assert.strictEqual(results.length, 5);
  for (const result of results) {
    assert.match(result.text, /herbal dietary supplement/i);
    assert.doesNotMatch(result.text, metaCopy, `${tone} output must be the deliverable, not commentary about writing it`);
    assert.doesNotMatch(result.text, unsupported);
  }
}

console.log('Story 3.111 Deliverable-First Product Descriptions tests passed');
