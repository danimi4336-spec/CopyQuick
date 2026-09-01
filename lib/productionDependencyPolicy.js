const MINIMUM_PRODUCTION_DEPENDENCIES = Object.freeze({
  customer_profile: Object.freeze([]),
  product_concept_brief: Object.freeze(['customer_profile']),
  product_positioning: Object.freeze(['customer_profile']),
  value_proposition: Object.freeze(['customer_profile', 'product_positioning']),
  validation_plan: Object.freeze(['customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition']),
  core_messaging: Object.freeze(['customer_profile', 'product_positioning', 'value_proposition']),
  amazon_listing: Object.freeze(['product_positioning', 'core_messaging']),
  amazon_bullet_points: Object.freeze(['amazon_listing']),
  amazon_keyword_guidance: Object.freeze([]),
  amazon_a_plus: Object.freeze(['amazon_listing', 'core_messaging']),
  ecommerce_product_page: Object.freeze(['product_positioning', 'core_messaging']),
  ecommerce_trust_faq: Object.freeze(['ecommerce_product_page']),
  ecommerce_conversion_copy: Object.freeze(['ecommerce_product_page']),
  abandoned_cart_email: Object.freeze(['ecommerce_product_page', 'core_messaging']),
  google_business_profile: Object.freeze(['core_messaging']),
  service_page: Object.freeze(['product_positioning', 'core_messaging']),
  product_image_guidance: Object.freeze(['product_positioning']),
  software_product_demo: Object.freeze(['core_messaging']),
  saas_trial_emails: Object.freeze(['software_product_demo', 'core_messaging']),
  launch_announcement: Object.freeze(['core_messaging']),
  educational_content: Object.freeze(['core_messaging']),
  social_launch_campaign: Object.freeze(['core_messaging', 'launch_announcement'])
});

function minimumProductionDependencies(deliverableId) {
  return [...(MINIMUM_PRODUCTION_DEPENDENCIES[deliverableId] || [])];
}

module.exports = { MINIMUM_PRODUCTION_DEPENDENCIES, minimumProductionDependencies };
