const COSTABLE_DELIVERABLE_IDS = new Set([
  'customer_profile',
  'product_positioning',
  'value_proposition',
  'core_messaging',
  'amazon_listing',
  'amazon_bullet_points',
  'amazon_keyword_guidance',
  'amazon_a_plus',
  'ecommerce_product_page',
  'ecommerce_trust_faq',
  'ecommerce_conversion_copy',
  'abandoned_cart_email',
  'google_business_profile',
  'service_page',
  'product_image_guidance',
  'software_product_demo',
  'saas_trial_emails',
  'launch_announcement',
  'social_launch_campaign',
  'educational_content'
]);

function calculateProductionCost({ approvedProductionSet, usageSnapshot }) {
  const deliverables = approvedProductionSet?.selectedDeliverables;
  if (!Array.isArray(deliverables) || deliverables.length === 0) {
    return {
      valid: false,
      blockingReason: 'An approved production set with at least one deliverable is required.'
    };
  }

  const ids = deliverables.map(function(item) { return item?.id; });
  if (ids.some(function(id) { return !id || !COSTABLE_DELIVERABLE_IDS.has(id); })) {
    return {
      valid: false,
      blockingReason: 'This plan contains a deliverable without an authoritative production cost.'
    };
  }
  if (new Set(ids).size !== ids.length) {
    return { valid: false, blockingReason: 'This plan contains duplicate production deliverables.' };
  }

  const productionUnitCount = deliverables.length;
  const currentUsage = Number(usageSnapshot?.used || 0);
  const monthlyAllowance = Number(usageSnapshot?.monthlyLimit || 0);
  const remainingAllowance = Number(usageSnapshot?.remaining || 0);
  const canAfford = remainingAllowance >= productionUnitCount;
  return {
    valid: true,
    productionUnitCount,
    currentUsage,
    monthlyAllowance,
    remainingAllowance,
    canAfford,
    blockingReason: canAfford
      ? null
      : `This plan requires ${productionUnitCount} generations, but only ${remainingAllowance} remain in the current allowance.`,
    costingModel: 'existing_generation_unit'
  };
}

module.exports = {
  calculateProductionCost
};
