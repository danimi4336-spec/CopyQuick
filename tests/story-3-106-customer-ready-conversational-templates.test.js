const assert = require('assert');
const { generateCopy } = require('../lib/generator');

const forbidden = /we asked .* to write|requested a coffee break|you're stuck with us|trust us|our work here is complete|walked into a bar|world peace|exactly what .* need|amazing results|it's awesome|designed specifically for professionals like you|remarkable outcomes/i;

for (const [contentType, tones] of [
  ['blog_intro', ['casual', 'humorous']],
  ['sales_message', ['professional', 'casual', 'humorous']]
]) {
  for (const tone of tones) {
    const results = generateCopy({
      productDescription: 'Example Product',
      targetAudience: 'Independent retailers',
      contentType,
      tone
    });
    assert.strictEqual(results.length, 5);
    for (const result of results) {
      assert.doesNotMatch(result.text, forbidden, `${contentType}/${tone} must be customer-ready`);
      assert.match(result.text, /Example Product/);
    }
  }
}

console.log('Story 3.106 Customer-Ready Conversational Templates tests passed');
