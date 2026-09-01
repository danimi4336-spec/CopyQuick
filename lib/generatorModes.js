/**
 * Marketing Bundle asset definitions for CopyQuick.
 * Each asset is a content type that can be selected in Bundle mode.
 */
const bundleAssets = [
  { id: 'email_drafts', label: 'Email Drafts', contentType: 'email_campaign', icon: '✉️', default: true, legacyId: 'email_campaign' },
  { id: 'facebook_post_variations', label: 'Facebook Post Variations', contentType: 'social_post', icon: '📘', default: true, legacyId: 'social_post' },
  { id: 'facebook_ad_headlines', label: 'Facebook Ad Headlines', contentType: 'ad_headline', icon: '📢', default: true, legacyId: 'ad_headline' },
  { id: 'google_search_ad_headlines', label: 'Google Search Ad Headlines', contentType: 'ad_headline', icon: '🔍', default: true, legacyId: 'social_post' },
  { id: 'product_description_variations', label: 'Product Description Variations', contentType: 'product_description', icon: '🛒', default: true, legacyId: 'product_description' },
  { id: 'amazon_product_description', label: 'Amazon Product Description', contentType: 'product_description', icon: '📦', default: false, legacyId: 'subject_line' },
  { id: 'seo_article_introductions', label: 'SEO Article Introductions', contentType: 'blog_intro', icon: '🔗', default: false, legacyId: 'blog_intro' },
  { id: 'blog_introductions', label: 'Blog Introductions', contentType: 'blog_intro', icon: '📝', default: false, legacyId: 'blog_intro' },
  { id: 'landing_page_ctas', label: 'Landing Page CTAs', contentType: 'cta', icon: '🌐', default: false, legacyId: 'cta' },
  { id: 'video_sales_messages', label: 'Video Sales Messages', contentType: 'sales_message', icon: '🎬', default: false, legacyId: 'sales_message' },
];

const legacyBundleAssets = [
  ['email_campaign', 'Email Campaign', 'email_campaign'],
  ['facebook_ad', 'Facebook Ad', 'ad_headline'],
  ['google_search_ad', 'Google Search Ad', 'ad_headline'],
  ['amazon_listing', 'Amazon Listing', 'product_description'],
  ['product_description', 'Product Description', 'product_description'],
  ['seo_package', 'SEO Package', 'blog_intro'],
  ['blog_article', 'Blog Article', 'blog_intro'],
  ['landing_page', 'Landing Page', 'cta'],
  ['video_package', 'Video Package', 'sales_message'],
  ['social_post', 'Facebook Post', 'social_post']
].map(([id, label, contentType]) => ({ id, label, contentType }));

const bundleAssetByPair = new Map();
for (const asset of bundleAssets) {
  bundleAssetByPair.set(`${asset.id}:${asset.label}`, asset);
  bundleAssetByPair.set(`${asset.legacyId}:${asset.label}`, asset);
}
for (const asset of legacyBundleAssets) bundleAssetByPair.set(`${asset.id}:${asset.label}`, asset);

function resolveBundleAsset(id, label) {
  const asset = bundleAssetByPair.get(`${id}:${label}`);
  if (!asset) return null;
  return { id: asset.id, label: asset.label, contentType: asset.contentType };
}

/**
 * Shared options
 */
const brandVoices = [
  'Professional', 'Casual', 'Urgent', 'Humorous', 'Inspirational'
];

const audiencePresets = [
  'Parents', 'Small Businesses', 'Fitness Enthusiasts',
  'Professionals', 'Students', 'Seniors', 'Custom'
];

module.exports = {
  bundleAssets,
  brandVoices,
  audiencePresets,
  resolveBundleAsset,
};
