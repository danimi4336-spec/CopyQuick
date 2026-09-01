const assert = require('assert');
const { generateCopy } = require('../lib/generator');

const disrespectfulOrUnsupported = /\b(?:your mom called|cold pizza|like magic|win at life|marry it|world hunger|our boss|manual labor|smarter than my cat|excessive productivity|sliced bread|competitors hate|best thing since|secret weapon|potential is limitless|reach new heights|transform how|nothing .* can't achieve|extraordinary things|changed the way I work|free trial)\b/i;

for (const [contentType, tones] of [
  ['subject_line', ['humorous']],
  ['social_post', ['casual', 'humorous']],
  ['ad_headline', ['casual', 'humorous']],
  ['blog_intro', ['inspirational']],
  ['sales_message', ['inspirational']]
]) {
  for (const tone of tones) {
    const results = generateCopy({ productDescription: 'Example Product', targetAudience: 'Independent retailers', contentType, tone });
    assert.strictEqual(results.length, 5);
    for (const result of results) assert.doesNotMatch(result.text, disrespectfulOrUnsupported);
  }
}

console.log('Story 3.110 Customer-Respectful Tone Templates tests passed');
