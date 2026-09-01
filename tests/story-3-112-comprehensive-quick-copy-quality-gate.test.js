const assert = require('assert');
const { generateCopy, getContentTypes, getTones, isEvidenceSafeTemplate } = require('../lib/generator');

const historicalFailures = [
  'The industry standard: Example',
  'Reach new heights with Example',
  'Welcome aboard! Thank you for choosing Example.',
  'Start your free trial of Example',
  'We asked Example to write this message. Trust us.',
  'This product description gives Example better copy.',
  'Your competitors hate Example'
];
for (const value of historicalFailures) assert.strictEqual(isEvidenceSafeTemplate(value), false, value);

for (const contentType of Object.keys(getContentTypes())) {
  for (const tone of getTones()) {
    const results = generateCopy({
      productDescription: 'Example Product',
      targetAudience: 'Independent retailers',
      contentType,
      tone
    });
    assert.strictEqual(results.length, 5);
    for (const result of results) assert.strictEqual(isEvidenceSafeTemplate(result.text), true, `${contentType}/${tone}`);
  }
}

console.log('Story 3.112 Comprehensive Quick Copy Quality Gate tests passed');
