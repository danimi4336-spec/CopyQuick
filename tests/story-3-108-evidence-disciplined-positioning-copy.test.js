const assert = require('assert');
const { generateCopy } = require('../lib/generator');

const unsupportedPositioning = /\b(?:industry standard|professional choice|top industry leaders|data-driven results|expert-level results|reliable performance|transform(?:ing|ative)? (?:the industry|your life|your daily life)|achieve more in less time|go-to tool|maximize (?:your|the)|unparalleled results|ROI .* is clear|potential is limitless|reach new heights|power to achieve|unlocking growth)\b/i;

for (const contentType of ['subject_line', 'social_post', 'ad_headline']) {
  for (const tone of ['professional', 'inspirational']) {
    const results = generateCopy({
      productDescription: 'Example Product',
      targetAudience: 'Independent retailers',
      contentType,
      tone
    });
    assert.strictEqual(results.length, 5);
    for (const result of results) {
      assert.doesNotMatch(result.text, unsupportedPositioning, `${contentType}/${tone} must not invent performance positioning`);
      assert.match(result.text, /Example Product|clear information/i);
    }
  }
}

console.log('Story 3.108 Evidence-Disciplined Positioning Copy tests passed');
