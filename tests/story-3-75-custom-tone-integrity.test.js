const assert = require('assert');
const { generateCopy, resolveTone } = require('../lib/generator');
const { brandVoices } = require('../lib/generatorModes');

function run() {
  assert.deepStrictEqual(brandVoices, [
    'Professional', 'Casual', 'Urgent', 'Humorous', 'Inspirational'
  ], 'dashboard generation must advertise only distinct tones the engine supports');

  const resolution = resolveTone('Warm, trustworthy, educational, and science-forward');
  assert.strictEqual(resolution.templateTone, 'professional');
  assert.strictEqual(resolution.customGuidance, 'Warm, trustworthy, educational, and science-forward');
  assert.throws(() => generateCopy({
    productDescription: 'Example product',
    targetAudience: 'Adults',
    contentType: 'sales_message',
    tone: resolution.templateTone,
    customToneGuidance: resolution.customGuidance
  }), error => error.code === 'CUSTOM_TONE_UNSUPPORTED');

  const supported = generateCopy({
    productDescription: 'Example product',
    targetAudience: 'Adults',
    contentType: 'sales_message',
    tone: 'Friendly'
  });
  assert.strictEqual(supported.length, 5);
  assert(supported.every(item => item.tone === 'casual'));

  console.log('Story 3.75 custom tone integrity tests passed');
}

run();
