/**
 * Shared content types configuration for CopyQuick.
 * Single source of truth for all generation types across the app.
 * 
 * Key: machine name used in the generator
 * Value: human-readable label
 */
const contentTypes = {
  subject_line: 'Email Subject Lines',
  social_post: 'Social Media Posts',
  ad_headline: 'Ad Headlines & Copy',
  product_description: 'Product Descriptions',
  cta: 'Call-to-Actions',
  email_campaign: 'Email Campaigns',
  blog_intro: 'Blog Post Introductions',
  sales_message: 'Sales Messages',
};

/**
 * Get all content types as { key, label } array (useful for template iteration)
 */
function getContentTypeList() {
  return Object.entries(contentTypes).map(([key, label]) => ({ key, label }));
}

/**
 * Get human-readable label for a content type key
 */
function getContentTypeLabel(key) {
  return contentTypes[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get all content type keys
 */
function getContentTypeKeys() {
  return Object.keys(contentTypes);
}

/**
 * Check if a content type is valid
 */
function isValidContentType(key) {
  return key in contentTypes;
}

module.exports = {
  contentTypes,
  getContentTypeList,
  getContentTypeLabel,
  getContentTypeKeys,
  isValidContentType,
};