const PLANNING_FOUNDATION_IDS = new Set([
  'acquisition_snapshot',
  'acquisition_channel_strategy',
  'campaign_brief',
  'conversion_path_brief',
  'acquisition_measurement_plan',
  'acquisition_experiment_backlog',
  'conversion_diagnostic_brief',
  'consultation_conversion_brief',
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
  'consultation_conversion_page_copy',
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

const CUSTOMER_READABLE_PLANNING_DOCUMENT_IDS = new Set([
  'conversion_diagnostic_brief',
  'consultation_conversion_brief',
  'conversion_measurement_plan',
  'product_image_guidance'
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

const CUSTOMER_PURPOSES = Object.freeze({
  conversion_diagnostic_brief: 'Summarizes what is known, what remains uncertain, and what should be checked before changing the conversion experience.',
  consultation_conversion_brief: 'Defines the service-fit, page-structure, trust, and consultation-action decisions used to create the finished page copy.',
  conversion_measurement_plan: 'Defines how consultation conversion should be measured and which baseline information is still needed.',
  consultation_conversion_page_copy: 'Ready-for-review website copy that helps qualified service prospects understand fit and take the consultation booking action.',
  priority_search_article: 'Search-focused article with evidence-backed claims where research was required.',
  research_evidence_pack: 'Sources and evidence CopyQuick reviewed for claims that required research.',
  search_strategy: 'Search priorities and direction used to guide the finished content.',
  priority_content_brief: 'The audience, question, angle, and scope used to shape the finished article.',
  search_evidence_snapshot: 'Known search evidence and limitations used to ground the strategy.',
  search_measurement_plan: 'A practical plan for evaluating search progress after publication.',
  outreach_sequence: 'Ready-for-review email copy for this objective.',
  paid_ad_copy_set: 'Ready-for-review advertising copy for this objective.',
  social_lead_campaign: 'Ready-for-review social content for attracting prospective customers.',
  lead_capture_page: 'Ready-for-review page copy for converting interested visitors.',
  launch_announcement: 'Ready-for-review announcement copy for the launch.',
  educational_content: 'Ready-for-review educational content for your audience.'
});

const CUSTOMER_LABELS = Object.freeze({
  READY_FOR_REVIEW: 'Ready for review', AVAILABLE: 'Available', NEEDS_INFORMATION: 'Needs information',
  NEEDS_SAFE_REVIEW: 'Needs safe review', COULD_NOT_COMPLETE: 'Could not complete', CREATING: 'Creating',
  NOT_CREATED: 'Not created'
});

function customerReadiness({ deliverableId, status, valid = true, essentialEvidenceMissing = false } = {}) {
  if (status === 'recovery_required') return 'NEEDS_SAFE_REVIEW';
  if (status === 'failed') return 'COULD_NOT_COMPLETE';
  if (status === 'skipped') return 'NOT_CREATED';
  if (essentialEvidenceMissing || status === 'completed' && !valid) return 'NEEDS_INFORMATION';
  if (status === 'completed') return isReadyToUseAsset(deliverableId) ? 'READY_FOR_REVIEW' : 'AVAILABLE';
  return 'CREATING';
}

function customerStatusLabel(readiness, status) {
  if (status === 'waiting_dependency') return 'Waiting for earlier work';
  if (status === 'queued') return 'Ready to start';
  return CUSTOMER_LABELS[readiness] || CUSTOMER_LABELS.CREATING;
}

function customerPurpose(deliverableId, title = 'deliverable') {
  return CUSTOMER_PURPOSES[deliverableId]
    || (isReadyToUseAsset(deliverableId)
      ? `Ready-for-review ${String(title).toLowerCase()} for this objective.`
      : `Supporting decisions and guidance used to create the finished work.`);
}

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

function isCustomerReadablePlanningDocument(deliverableOrId) {
  const id = typeof deliverableOrId === 'string' ? deliverableOrId : deliverableOrId?.id;
  return CUSTOMER_READABLE_PLANNING_DOCUMENT_IDS.has(id);
}

function isReadyToUseAsset(deliverableOrId) {
  const id = typeof deliverableOrId === 'string' ? deliverableOrId : deliverableOrId?.id;
  return getProductionArtifactPolicy(id)?.role === 'ready_to_use_asset';
}

module.exports = {
  CUSTOMER_LABELS,
  customerPurpose,
  customerReadiness,
  customerStatusLabel,
  getProductionArtifactPolicy,
  isCustomerReadablePlanningDocument,
  isPlanningFoundation,
  isReadyToUseAsset,
  productionBillingUnits
};
