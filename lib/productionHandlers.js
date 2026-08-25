const HANDLER_CONTENT_TYPES = {
  customer_profile: 'sales_message',
  product_positioning: 'sales_message',
  value_proposition: 'sales_message',
  core_messaging: 'sales_message',
  amazon_listing: 'product_description',
  amazon_bullet_points: 'product_description',
  amazon_keyword_guidance: 'blog_intro',
  amazon_a_plus: 'product_description',
  ecommerce_product_page: 'product_description',
  ecommerce_trust_faq: 'blog_intro',
  ecommerce_conversion_copy: 'cta',
  abandoned_cart_email: 'email_campaign',
  google_business_profile: 'sales_message',
  service_page: 'sales_message',
  product_image_guidance: 'sales_message',
  software_product_demo: 'sales_message',
  saas_trial_emails: 'email_campaign',
  launch_announcement: 'email_campaign',
  social_launch_campaign: 'social_post',
  educational_content: 'blog_intro'
};

const handlers = Object.fromEntries(Object.entries(HANDLER_CONTENT_TYPES).map(function(entry) {
  const [deliverableId, contentType] = entry;
  return [deliverableId, Object.freeze({ deliverableId, contentType })];
}));

function getProductionHandler(deliverableId) {
  return handlers[deliverableId] || null;
}

function isExecutableDeliverable(deliverableId) {
  return Boolean(getProductionHandler(deliverableId));
}

function getExecutableDeliverableIds() {
  return Object.keys(handlers);
}

module.exports = {
  getExecutableDeliverableIds,
  getProductionHandler,
  isExecutableDeliverable
};
