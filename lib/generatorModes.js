/**
 * Marketing Bundle asset definitions for CopyQuick.
 * Each asset is a content type that can be selected in Bundle mode.
 */
const bundleAssets = [
  { id: 'email_campaign',   label: 'Email Drafts',                  icon: '✉️', default: true },
  { id: 'social_post',      label: 'Facebook Post Variations',      icon: '📘', default: true },
  { id: 'ad_headline',      label: 'Facebook Ad Headlines',         icon: '📢', default: true },
  { id: 'social_post',      label: 'Google Search Ad Headlines',    icon: '🔍', default: true },
  { id: 'product_description', label: 'Product Description Variations', icon: '🛒', default: true },
  { id: 'subject_line',     label: 'Amazon Product Description',    icon: '📦', default: false },
  { id: 'blog_intro',       label: 'SEO Article Introductions',     icon: '🔗', default: false },
  { id: 'blog_intro',       label: 'Blog Introductions',             icon: '📝', default: false },
  { id: 'cta',              label: 'Landing Page CTAs',              icon: '🌐', default: false },
  { id: 'sales_message',    label: 'Video Sales Messages',           icon: '🎬', default: false },
];

/**
 * Campaign mode sections with detailed deliverables
 */
const campaignSections = [
  {
    id: 'email',
    label: 'Email Marketing',
    icon: '✉️',
    deliverables: [
      'Welcome Email',
      'Product Launch Email',
      'Promotional Email',
      'Follow-up Email',
      'Abandoned Cart Email',
      'Subject Lines',
      'Preview Text',
      'Calls-to-Action'
    ]
  },
  {
    id: 'social',
    label: 'Social Media',
    icon: '📱',
    deliverables: [
      'Facebook Posts',
      'Instagram Captions',
      'LinkedIn Posts',
      'X Posts',
      'Pinterest Descriptions',
      'Hashtags',
      'Caption Variations'
    ]
  },
  {
    id: 'ads',
    label: 'Advertising',
    icon: '📢',
    deliverables: [
      'Facebook Ads',
      'Instagram Ads',
      'Google Search Ads',
      'Retargeting Ads',
      'Ad Headlines',
      'Ad Descriptions',
      'Calls-to-Action'
    ]
  },
  {
    id: 'ecommerce',
    label: 'Ecommerce',
    icon: '🛒',
    deliverables: [
      'Product Description',
      'Shopify Description',
      'Amazon Listing',
      'Product Benefits',
      'Product Features',
      'FAQ',
      'Product Summary'
    ]
  },
  {
    id: 'seo',
    label: 'SEO & Content',
    icon: '🔍',
    deliverables: [
      'SEO Title',
      'Meta Description',
      'Blog Outline',
      'Primary Keywords',
      'Secondary Keywords',
      'FAQ Content',
      'Suggested Article Angles'
    ]
  },
  {
    id: 'landing',
    label: 'Landing Pages',
    icon: '🌐',
    deliverables: [
      'Hero Headline',
      'Subheadline',
      'Benefits',
      'Problem / Solution',
      'CTA Section',
      'FAQ Section',
      'Trust-Building Copy'
    ]
  }
];

/**
 * Shared options
 */
const brandVoices = [
  'Professional', 'Casual', 'Urgent', 'Humorous', 'Inspirational'
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
