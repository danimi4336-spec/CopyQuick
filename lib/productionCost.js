const { isExecutableDeliverable } = require('./productionHandlers');
const { getProductionArtifactPolicy } = require('./productionArtifactPolicy');

function calculateProductionCost({ approvedProductionSet, usageSnapshot }) {
  const deliverables = approvedProductionSet?.selectedDeliverables;
  if (!Array.isArray(deliverables) || deliverables.length === 0) {
    return {
      valid: false,
      blockingReason: 'An approved production set with at least one deliverable is required.'
    };
  }

  const ids = deliverables.map(function(item) { return item?.id; });
  if (ids.some(function(id) { return !id || !isExecutableDeliverable(id); })) {
    return {
      valid: false,
      blockingReason: 'This plan contains a deliverable without an authoritative production cost.'
    };
  }
  if (new Set(ids).size !== ids.length) {
    return { valid: false, blockingReason: 'This plan contains duplicate production deliverables.' };
  }

  const policies = ids.map(getProductionArtifactPolicy);
  if (policies.some(function(policy) { return !policy; })) {
    return {
      valid: false,
      blockingReason: 'This plan contains a deliverable without an authoritative production cost.'
    };
  }
  const productionUnitCount = policies.reduce(function(total, policy) {
    return total + policy.billingUnits;
  }, 0);
  const planningFoundationCount = policies.filter(function(policy) {
    return policy.role === 'planning_foundation';
  }).length;
  const readyToUseAssetCount = policies.filter(function(policy) {
    return policy.role === 'ready_to_use_asset';
  }).length;
  const currentUsage = Number(usageSnapshot?.used || 0);
  const monthlyAllowance = Number(usageSnapshot?.monthlyLimit || 0);
  const remainingAllowance = Number(usageSnapshot?.remaining || 0);
  const canAfford = remainingAllowance >= productionUnitCount;
  return {
    valid: true,
    productionUnitCount,
    planningFoundationCount,
    readyToUseAssetCount,
    currentUsage,
    monthlyAllowance,
    remainingAllowance,
    canAfford,
    blockingReason: canAfford
      ? null
      : `This plan requires ${productionUnitCount} production credits, but only ${remainingAllowance} remain in the current allowance.`,
    costingModel: 'ready_to_use_asset_unit'
  };
}

module.exports = {
  calculateProductionCost
};
