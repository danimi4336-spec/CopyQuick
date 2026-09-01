const assert = require('assert');
const {
  GENERATION_METADATA_LIMITS,
  boundedQueryText,
  validateOptionalText
} = require('../lib/generationMetadata');

assert.deepStrictEqual(validateOptionalText('', GENERATION_METADATA_LIMITS.title), { valid: true, value: '' });
assert.deepStrictEqual(validateOptionalText('Customer-ready title', GENERATION_METADATA_LIMITS.title), {
  valid: true,
  value: 'Customer-ready title'
});
assert.strictEqual(validateOptionalText('x'.repeat(GENERATION_METADATA_LIMITS.title + 1), GENERATION_METADATA_LIMITS.title).valid, false);
assert.strictEqual(validateOptionalText({ unsafe: true }, GENERATION_METADATA_LIMITS.tags).valid, false);
assert.strictEqual(validateOptionalText('bad\0text', GENERATION_METADATA_LIMITS.tags).valid, false);
assert.strictEqual(boundedQueryText(['not', 'text']), '');
assert.strictEqual(boundedQueryText('x'.repeat(GENERATION_METADATA_LIMITS.search + 1)), '');
assert.strictEqual(boundedQueryText('digestive wellness'), 'digestive wellness');

const routes = require('fs').readFileSync(require.resolve('../routes/generations'), 'utf8');
assert.match(routes, /validateOptionalText\(tags, GENERATION_METADATA_LIMITS\.tags\)/);
assert.match(routes, /validateOptionalText\(title, GENERATION_METADATA_LIMITS\.title\)/);
assert.match(routes, /const q = boundedQueryText\(req\.query\.q\)/);
console.log('Story 3.48 bounded generation metadata tests passed');
