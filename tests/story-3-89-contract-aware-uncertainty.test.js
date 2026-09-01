const assert = require('assert');

const { getProductionContract } = require('../lib/productionContracts');

function prompt(id) {
  return getProductionContract(id).buildPrompt({
    title: id,
    strategicDirection: 'Create a grounded customer deliverable.',
    strategySnapshot: {}
  });
}

for (const id of [
  'customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition',
  'validation_plan', 'core_messaging', 'amazon_listing', 'amazon_bullet_points',
  'amazon_keyword_guidance', 'amazon_a_plus', 'ecommerce_product_page',
  'ecommerce_trust_faq', 'ecommerce_conversion_copy', 'abandoned_cart_email',
  'google_business_profile', 'service_page', 'software_product_demo', 'saas_trial_emails',
  'product_image_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign'
]) {
  const value = prompt(id);
  assert.match(value, /Do not use placeholder text such as “To be confirmed.”/, id);
  assert.match(value, /requires validation|still requires validation/, id);
  assert.doesNotMatch(value, /Mark genuinely unknown proof or details as “To be confirmed”/, id);
}

console.log('Story 3.89 Contract-Aware Uncertainty tests passed');
