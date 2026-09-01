const assert = require('assert');
const {
  generateCopy,
  getContentTypes,
  getTones,
  isEvidenceSafeTemplate,
  MIN_SAFE_VARIATIONS
} = require('../lib/generator');

function run() {
  const knownUnsafeExamples = [
    'Flash Sale: Example is 50% Off Today!',
    'Use code QUICK for 30% off Example.',
    'Hurry! Only 5 spots left for Example.',
    'The ROI of Example is clear.',
    'The data is clear: customers consistently outperform everyone else.',
    'Example is transforming the industry.',
    'Science says Example works.',
    'Businesses use Example to achieve remarkable results.',
    'We asked customers what they wanted. 3 out of 5 said Example.'
  ];
  knownUnsafeExamples.forEach(example => {
    assert.strictEqual(isEvidenceSafeTemplate(example), false, `must reject unsupported template: ${example}`);
  });
  assert.strictEqual(isEvidenceSafeTemplate(
    'Review Example and confirm the available details before deciding whether it fits your needs.'
  ), true);

  for (const contentType of Object.keys(getContentTypes())) {
    for (const tone of getTones()) {
      for (let runNumber = 0; runNumber < 20; runNumber += 1) {
        const results = generateCopy({
          productDescription: 'An herbal supplement',
          targetAudience: 'Adults',
          contentType,
          tone
        });
        assert.strictEqual(results.length, MIN_SAFE_VARIATIONS, `${contentType}/${tone} must retain five variations`);
        results.forEach(result => {
          assert.strictEqual(isEvidenceSafeTemplate(result.text), true, `${contentType}/${tone} emitted unsafe copy`);
          assert.strictEqual(result.tone, tone);
        });
      }
    }
  }

  assert.throws(() => generateCopy({
    productDescription: 'An herbal supplement',
    targetAudience: 'Adults',
    contentType: 'sales_message',
    tone: 'Warm and careful'
  }), error => error.code === 'CUSTOM_TONE_UNSUPPORTED');

  console.log('Story 3.74 generation evidence safety tests passed');
}

run();
