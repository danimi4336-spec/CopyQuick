const assert = require('assert');
const { BRAND_BRAIN_LIMITS, validateBrandBrain } = require('../lib/brandBrainValidation');

const valid = validateBrandBrain({
  business_name: '  CopyQuick Labs  ',
  industry: 'Software',
  target_audience: 'Small business owners',
  brand_voice: 'custom',
  brand_voice_custom: 'Clear and practical',
  unique_value: 'Fast, grounded marketing support',
  competitors: '', goals: '', key_messages: ''
});
assert.strictEqual(valid.valid, true);
assert.strictEqual(valid.values.business_name, 'CopyQuick Labs');
assert.strictEqual(valid.values.brand_voice_custom, 'Clear and practical');

for (const voice of ['professional', 'friendly', 'luxury', 'playful', 'bold', 'inspirational']) {
  const result = validateBrandBrain({ brand_voice: voice, brand_voice_custom: 'must not persist' });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.values.brand_voice_custom, '');
}

assert.strictEqual(validateBrandBrain({ brand_voice: 'admin' }).valid, false);
assert.strictEqual(validateBrandBrain({ brand_voice: ['professional'] }).valid, false);
assert.strictEqual(validateBrandBrain({ brand_voice: 'professional', goals: { malformed: true } }).valid, false);
assert.strictEqual(validateBrandBrain({
  brand_voice: 'professional',
  key_messages: 'x'.repeat(BRAND_BRAIN_LIMITS.key_messages + 1)
}).valid, false);
assert.strictEqual(validateBrandBrain({ brand_voice: 'professional', industry: 'bad\0value' }).valid, false);

const view = require('fs').readFileSync(require.resolve('../views/brand-brain.ejs'), 'utf8');
assert.match(view, /maxlength="120"/);
assert.match(view, /role="alert"/);
console.log('Story 3.50 Brand Brain validation tests passed');
