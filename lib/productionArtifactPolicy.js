const PLANNING_FOUNDATION_IDS = new Set([
  'acquisition_snapshot',
  'acquisition_channel_strategy',
  'campaign_brief',
  'conversion_path_brief',
  'acquisition_measurement_plan',
  'acquisition_experiment_backlog',
  'conversion_diagnostic_brief',
  'conversion_page_brief',
  'conversion_measurement_plan',
  'search_evidence_snapshot',
  'search_strategy',
  'priority_content_brief',
  'research_evidence_pack',
  'search_measurement_plan',
  'customer_profile',
  'product_concept_brief',
  'product_specification_brief',
  'product_positioning',
  'value_proposition',
  'validation_plan',
  'prototype_sample_validation_plan',
  'sourcing_manufacturer_brief',
  'compliance_evidence_checklist',
  'unit_economics_pricing_model',
  'packaging_shipping_requirements',
  'inventory_fulfillment_plan',
  'core_messaging',
  'product_image_guidance',
  'amazon_keyword_guidance'
]);

const READY_TO_USE_ASSET_IDS = new Set([
  'outreach_sequence',
  'referral_campaign_kit',
  'paid_ad_copy_set',
  'social_lead_campaign',
  'organic_content_campaign',
  'priority_search_article',
  'lead_capture_page',
  'sales_call_script',
  'multi_channel_campaign_kit',
  'amazon_listing',
  'amazon_bullet_points',
  'amazon_a_plus',
  'ecommerce_product_page',
  'ecommerce_trust_faq',
  'ecommerce_conversion_copy',
  'abandoned_cart_email',
  'google_business_profile',
  'service_page',
  'software_product_demo',
  'saas_trial_emails',
  'launch_announcement',
  'educational_content',
  'social_launch_campaign'
]);

const POLICIES = Object.freeze({
  planning_foundation: Object.freeze({
    role: 'planning_foundation',
    billingUnits: 0,
    readyToUse: false,
    label: 'Planning foundation'
  }),
  ready_to_use_asset: Object.freeze({
    role: 'ready_to_use_asset',
    billingUnits: 1,
    readyToUse: true,
    label: 'Ready-to-use asset'
  })
});

function getProductionArtifactPolicy(deliverableId) {
  if (PLANNING_FOUNDATION_IDS.has(deliverableId)) return POLICIES.planning_foundation;
  if (READY_TO_USE_ASSET_IDS.has(deliverableId)) return POLICIES.ready_to_use_asset;
  return null;
}

function productionBillingUnits(deliverableOrId) {
  const id = typeof deliverableOrId === 'string' ? deliverableOrId : deliverableOrId?.id;
  return getProductionArtifactPolicy(id)?.billingUnits ?? null;
}

function isPlanningFoundation(deliverableOrId) {
  const id = typeof deliverableOrId === 'string' ? deliverableOrId : deliverableOrId?.id;
  return getProductionArtifactPolicy(id)?.role === 'planning_foundation';
}

function isReadyToUseAsset(deliverableOrId) {
  const id = typeof deliverableOrId === 'string' ? deliverableOrId : deliverableOrId?.id;
  return getProductionArtifactPolicy(id)?.role === 'ready_to_use_asset';
}

module.exports = {
  getProductionArtifactPolicy,
  isPlanningFoundation,
  isReadyToUseAsset,
  productionBillingUnits
};
