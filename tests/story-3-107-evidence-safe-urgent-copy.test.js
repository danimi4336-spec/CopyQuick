const assert = require('assert');
const { generateCopy } = require('../lib/generator');

const fabricatedUrgency = /\b(?:sale|discount|\d+% off|expires?|limited (?:time|supply)|only \d+|spots? (?:left|filling)|copies? left|before (?:it is|it's) gone|price goes up|final (?:call|hours?)|ends? at midnight|last chance|deal of the century|use code|early access)\b/i;

for (const contentType of ['subject_line', 'social_post', 'ad_headline', 'cta']) {
  const results = generateCopy({
    productDescription: 'Example Product',
    targetAudience: 'Independent retailers',
    contentType,
    tone: 'urgent'
  });
  assert.strictEqual(results.length, 5);
  for (const result of results) {
    assert.doesNotMatch(result.text, fabricatedUrgency, `${contentType} must not invent urgency facts`);
    assert.match(result.text, /Example Product|Confirm the Details|Choose My Next Step/);
  }
}

console.log('Story 3.107 Evidence-Safe Urgent Copy tests passed');
