/**
 * Marketing Bundle asset definitions for CopyQuick.
 * Each asset is a content type that can be selected in Bundle mode.
 */
const bundleAssets = [
  { id: 'email_campaign',   label: 'Email Campaign',       icon: '✉️',    default: true },
  { id: 'social_post',      label: 'Facebook Post',        icon: '📘',    default: true },
  { id: 'ad_headline',      label: 'Facebook Ad',          icon: '📢',    default: true },
  { id: 'social_post',      label: 'Google Search Ad',     icon: '🔍',    default: true },
  { id: 'product_description', label: 'Product Description', icon: '🛒',  default: true },
  { id: 'subject_line',     label: 'Amazon Listing',       icon: '📦',    default: false },
  { id: 'blog_intro',       label: 'SEO Package',          icon: '🔗',    default: false },
  { id: 'blog_intro',       label: 'Blog Article',         icon: '📝',    default: false },
  { id: 'cta',              label: 'Landing Page',         icon: '🌐',    default: false },
  { id: 'sales_message',    label: 'Video Package',        icon: '🎬',    default: false },
];

/**
 * Campaign mode sections
 */
const campaignSections = [
  { id: 'email',     label: 'Email Marketing',      icon: '✉️' },
  { id: 'social',    label: 'Social Media',          icon: '📱' },
  { id: 'ads',       label: 'Advertising',           icon: '📢' },
  { id: 'ecommerce', label: 'Ecommerce',             icon: '🛒' },
  { id: 'seo',       label: 'SEO & Content',         icon: '🔍' },
  { id: 'landing',   label: 'Landing Pages',         icon: '🌐' },
];

/**
 * Shared options
 */
const brandVoices = [
  'Professional', 'Friendly', 'Luxury', 'Scientific',
  'Christian', 'Inspirational', 'Bold', 'Playful', 'Minimal', 'Custom'
];

const goals = [
  'Increase Sales', 'Generate Leads', 'Launch Product',
  'Build Awareness', 'Seasonal Promotion', 'Email Subscribers',
  'Traffic', 'Custom'
];

const audiencePresets = [
  'Parents', 'Small Businesses', 'Fitness Enthusiasts',
  'Professionals', 'Students', 'Seniors', 'Custom'
];

module.exports = {
  bundleAssets,
  campaignSections,
  brandVoices,
  goals,
  audiencePresets,
};