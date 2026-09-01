const assert = require('assert');
const { generateCopy } = require('../lib/generator');

const inventedState = /\b(?:schedule a demo|contact sales|get the whitepaper|start .* trial|request a quote|download .* guide|register .* webinar|try .* for free|discount|welcome aboard|thank you for choosing|you joined|you decided to try|how(?:'s| is) .* working for you|we made .* updates|new feature|already love|having you as .* user|your future .* starts today|unlimited possibilities)\b/i;

for (const contentType of ['cta', 'email_campaign']) {
  for (const tone of ['professional', 'casual', 'humorous', 'inspirational']) {
    const results = generateCopy({
      productDescription: 'Example Product',
      targetAudience: 'Independent retailers',
      contentType,
      tone
    });
    assert.strictEqual(results.length, 5);
    for (const result of results) {
      assert.doesNotMatch(result.text, inventedState, `${contentType}/${tone} must not invent offers or customer lifecycle state`);
    }
  }
}

console.log('Story 3.109 Offer and Lifecycle Claim Discipline tests passed');
