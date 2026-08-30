const assert = require('assert');
const { understandBusiness } = require('../lib/businessUnderstanding');

async function run() {
  const supplement = await understandBusiness({
    objective: 'launch_product',
    answer: 'Organic turmeric supplement'
  });
  assert.strictEqual(supplement.understanding.businessType.value, 'physical_product');
  assert.strictEqual(supplement.understanding.industry.value, 'health_wellness');
  assert.strictEqual(supplement.understanding.category.value, 'dietary_supplement');
  assert.strictEqual(supplement.understanding.category.source, 'inference');
  assert(supplement.understanding.category.confidence >= 0.7);
  assert(supplement.unknowns.includes('salesChannel'));

  const describedSupplement = await understandBusiness({
    objective: 'launch_product',
    answer: 'An herbal dietary supplement for adults that I plan to sell on Amazon.'
  });
  assert.strictEqual(describedSupplement.understanding.businessType.value, 'physical_product');
  assert.strictEqual(describedSupplement.understanding.industry.value, 'health_wellness');
  assert.strictEqual(describedSupplement.understanding.category.value, 'dietary_supplement');
  assert.strictEqual(describedSupplement.understanding.targetAudience.value, 'adults');
  assert.strictEqual(describedSupplement.understanding.targetAudience.label, 'Adults');
  assert.strictEqual(describedSupplement.understanding.salesChannel.value, 'amazon');
  assert.strictEqual(describedSupplement.understanding.salesChannel.label, 'Amazon');

  for (const audience of [
    'adults over 50',
    'busy working parents',
    'recreational runners',
    'women experiencing menopause',
    'women who want better sleep',
    'athletes who use supplements during training',
    'adults that need simpler wellness routines',
    'independent retailers that serve local families'
  ]) {
    const inferredAudience = await understandBusiness({
      objective: 'launch_product',
      answer: `An herbal supplement for ${audience}.`
    });
    assert.strictEqual(inferredAudience.understanding.targetAudience.value, audience);
  }

  for (const example of [
    ['An herbal supplement for adults that I intend to sell on Amazon', 'adults', 'amazon'],
    ['An herbal supplement for adults that I want to sell on Amazon', 'adults', 'amazon'],
    ['An herbal supplement for busy parents sold on Shopify', 'busy parents', 'own_website'],
    ['An herbal supplement for seniors available through retail stores', 'seniors', 'retail'],
    ['An herbal supplement for athletes who will buy it on Amazon', 'athletes', 'amazon']
  ]) {
    const separated = await understandBusiness({ objective: 'launch_product', answer: example[0] });
    assert.strictEqual(separated.understanding.targetAudience.value, example[1]);
    assert.strictEqual(separated.understanding.salesChannel.value, example[2]);
  }

  const service = await understandBusiness({
    objective: 'launch_product',
    answer: 'Mobile car detailing service'
  });
  assert.strictEqual(service.understanding.businessType.value, 'service');
  assert.strictEqual(service.understanding.industry.value, 'automotive');
  assert.strictEqual(service.understanding.category.value, 'auto_detailing');
  assert.notStrictEqual(service.understanding.category.value, 'dietary_supplement');

  const softwareAnswer = 'AI appointment scheduling software for dentists';
  const software = await understandBusiness({
    objective: 'launch_product',
    answer: softwareAnswer
  });
  assert.strictEqual(software.understanding.businessType.value, 'software');
  assert.strictEqual(software.understanding.industry.value, 'technology');
  assert.strictEqual(software.understanding.targetAudience.value, 'dentists');
  assert.strictEqual(software.understanding.targetAudience.source, 'inference');
  assert.strictEqual(softwareAnswer, 'AI appointment scheduling software for dentists');

  const ambiguous = await understandBusiness({
    objective: 'launch_product',
    answer: 'Nova'
  });
  assert.deepStrictEqual(ambiguous.understanding.businessType, {
    value: null,
    label: null,
    confidence: 0,
    source: 'unknown'
  });
  assert.strictEqual(ambiguous.understanding.industry.source, 'unknown');
  assert.strictEqual(ambiguous.understanding.category.source, 'unknown');

  const withKnownChannel = await understandBusiness({
    objective: 'launch_product',
    answer: 'Organic turmeric supplement sold on Amazon',
    existingUnderstanding: {
      salesChannel: { value: 'amazon', label: 'Amazon', confidence: 1, source: 'user_confirmed' }
    }
  });
  assert(!withKnownChannel.unknowns.includes('salesChannel'));
  assert.strictEqual(withKnownChannel.understanding.salesChannel.source, 'user_confirmed');

  const withUnsureChannel = await understandBusiness({
    objective: 'launch_product',
    answer: 'Organic turmeric supplement',
    existingUnderstanding: {
      salesChannel: { value: 'unsure', label: "I'm not sure yet", confidence: 1, source: 'user_confirmed' }
    }
  });
  assert(withUnsureChannel.unknowns.includes('salesChannel'));

  console.log('Story 3.2 Business Understanding Engine tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
