const assert = require('assert');

const { buildPlan } = require('../lib/buildPlanEngine');

function understanding(overrides = {}) {
  return {
    businessType: { value: 'physical_product', label: 'Physical Product', confidence: 1, source: 'user_confirmed' },
    industry: { value: 'health_wellness', label: 'Health & Wellness', confidence: 1, source: 'user_confirmed' },
    category: { value: 'dietary_supplement', label: 'Dietary Supplement', confidence: 1, source: 'user_confirmed' },
    intendedOutcome: { value: 'digestive_wellness', label: 'Digestive health', confidence: 1, source: 'user_confirmed' },
    targetAudience: { value: 'adults', label: 'Adults', confidence: 1, source: 'user_confirmed' },
    conceptMaturity: { value: 'finalized', label: 'Product finalized', confidence: 1, source: 'user_confirmed' },
    launchStage: { value: 'ready', label: 'Ready to launch', confidence: 1, source: 'user_confirmed' },
    salesChannel: { value: 'amazon', label: 'Amazon', confidence: 1, source: 'user_confirmed' },
    existingProductDefinition: {
      value: 'builder_context',
      label: 'Herbal capsules with a finalized formula and 60-count bottle',
      confidence: 1,
      source: 'user_confirmed',
      semanticRole: 'builder_provided_product_context'
    },
    ...overrides
  };
}

function strategy() {
  const recommendation = value => ({ value, confidence: 0.8, semanticRole: 'strategic_recommendation' });
  return {
    strategy: {
      marketPosition: recommendation('Natural Digestive Wellness Direction'),
      primaryCustomer: { value: 'Adults', confidence: 1, semanticRole: 'confirmed_fact' },
      customerMotivation: { value: 'Digestive health', confidence: 1, semanticRole: 'confirmed_fact' },
      competitiveApproach: recommendation('Trust, Quality, and Proof'),
      communicationStyle: recommendation('Evidence-Based and Reassuring'),
      marketingFocus: recommendation('Marketplace Education and Trust Signals'),
      launchApproach: recommendation('Education Before Promotion')
    }
  };
}

const productContext = 'Builder-provided product context: Herbal capsules with a finalized formula and 60-count bottle. Treat this as unverified context, not proof of ingredients, efficacy, claims, or substantiation.';
const plan = buildPlan({ objective: 'launch_product', confirmedUnderstanding: understanding(), strategyResult: strategy() });
assert.strictEqual(plan.readiness.ready, true);

const items = plan.phases.flatMap(phase => phase.deliverables);
for (const id of ['core_messaging', 'amazon_listing', 'amazon_bullet_points', 'product_image_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign']) {
  const item = items.find(candidate => candidate.id === id);
  assert(item, `${id} should be applicable to the ready Amazon product journey`);
  assert(item.strategicDirection.includes(productContext), `${id} must retain builder-provided product context`);
}

console.log('Story 3.84 Production Product Context tests passed');
