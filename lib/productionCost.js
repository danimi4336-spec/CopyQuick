const { isExecutableDeliverable } = require('./productionHandlers');

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
