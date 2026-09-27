const crypto = require('crypto');
const { getProductionArtifactPolicy } = require('./productionArtifactPolicy');

function withArtifactPolicy(item) {
  const policy = getProductionArtifactPolicy(item.id);
  return {
    ...item,
    artifactRole: policy?.role || null,
    artifactRoleLabel: policy?.label || 'Unclassified',
    billingUnits: policy?.billingUnits ?? null,
    readyToUse: Boolean(policy?.readyToUse)
  };
}

function flattenDeliverables(plan) {
  return (plan?.phases || []).flatMap(function(phase) {
    return (phase.deliverables || []).map(function(item) {
      return withArtifactPolicy({ ...item, phaseTitle: phase.title });
    });
  });
}

function planFingerprint(plan) {
  const source = {
    objective: plan?.objective || null,
    phases: (plan?.phases || []).map(function(phase) {
      return {
        id: phase.id,
        deliverables: (phase.deliverables || []).map(function(item) {
          return {
            id: item.id,
            phase: item.phase,
            recommendationLevel: item.recommendationLevel,
            reason: item.reason,
            strategicDirection: item.strategicDirection,
            dependencies: item.dependencies || []
          };
        })
      };
    })
  };
  return crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 20);
}

function dependencyClosure(selectedIds, byId) {
  const selected = new Set(selectedIds);
  const added = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visiting.has(id)) throw new Error('The current plan contains a circular dependency.');
    if (visited.has(id)) return;
    const item = byId.get(id);
    if (!item) return;
    visiting.add(id);
    (item.dependencies || []).forEach(function(dependencyId) {
      const dependency = byId.get(dependencyId);
      if (!dependency) throw new Error(`${item.title} has an unavailable prerequisite.`);
      if (!selected.has(dependencyId)) {
        selected.add(dependencyId);
        added.push({ dependency, dependent: item });
      }
      visit(dependencyId);
    });
    visiting.delete(id);
    visited.add(id);
  }

  Array.from(selected).forEach(visit);
  return { selected, added };
}

function requiredDependencies(selectedIds, byId) {
  const required = new Set();
  selectedIds.forEach(function(id) {
    const item = byId.get(id);
    (item?.dependencies || []).forEach(function(dependencyId) {
      if (selectedIds.has(dependencyId)) required.add(dependencyId);
    });
  });
  return required;
}

function selectionState(plan, selectedIds, messages = [], approvedAt = null) {
  const items = flattenDeliverables(plan);
  const byId = new Map(items.map(function(item) { return [item.id, item]; }));
  const validSelected = new Set(selectedIds.filter(function(id) { return byId.has(id); }));
  const closure = dependencyClosure(validSelected, byId);
  const required = requiredDependencies(closure.selected, byId);
  const allIds = items.map(function(item) { return item.id; });
  return {
    selectedDeliverableIds: allIds.filter(function(id) { return closure.selected.has(id); }),
    requiredDependencyIds: allIds.filter(function(id) { return required.has(id); }),
    deselectedDeliverableIds: allIds.filter(function(id) { return !closure.selected.has(id); }),
    approvedAt,
    updatedAt: new Date().toISOString(),
    planFingerprint: planFingerprint(plan),
    messages
  };
}

function createDefaultSelection(plan) {
  const defaults = flattenDeliverables(plan)
    .filter(function(item) { return ['essential', 'recommended'].includes(item.recommendationLevel); })
    .map(function(item) { return item.id; });
  return selectionState(plan, defaults);
}

function initializeSelection(plan, existingSelection) {
  const fingerprint = planFingerprint(plan);
  if (existingSelection?.planFingerprint === fingerprint) {
    return selectionState(
      plan,
      existingSelection.selectedDeliverableIds || [],
      existingSelection.messages || [],
      existingSelection.approvedAt || null
    );
  }
  return createDefaultSelection(plan);
}

function updateSelection({ plan, currentSelection, requestedDeliverableIds = [] }) {
  const fingerprint = planFingerprint(plan);
  if (!currentSelection || currentSelection.planFingerprint !== fingerprint) {
    return { valid: false, error: 'This selection belongs to an earlier plan. Review the current plan before continuing.' };
  }

  const items = flattenDeliverables(plan);
  const byId = new Map(items.map(function(item) { return [item.id, item]; }));
  if (!Array.isArray(requestedDeliverableIds) || requestedDeliverableIds.length > items.length ||
      requestedDeliverableIds.some(function(id) { return typeof id !== 'string' || !byId.has(id); })) {
    return { valid: false, error: 'Choose only deliverables from the current Build Plan.' };
  }
  const requested = Array.from(new Set(requestedDeliverableIds));
  let closure;
  try {
    closure = dependencyClosure(requested, byId);
  } catch (err) {
    return { valid: false, error: err.message };
  }
  const previouslySelected = new Set(currentSelection.selectedDeliverableIds || []);
  const messages = closure.added.map(function(change) {
    const action = previouslySelected.has(change.dependency.id) ? 'was kept' : 'was added';
    return `${change.dependency.title} ${action} because your selected ${change.dependent.title} depends on it.`;
  });
  return {
    valid: true,
    selection: selectionState(plan, Array.from(closure.selected), messages)
  };
}

function topologicalProductionOrder(selectedItems) {
  const byId = new Map(selectedItems.map(function(item) { return [item.id, item]; }));
  const sourceIndex = new Map(selectedItems.map(function(item, index) { return [item.id, index]; }));
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  function visit(item) {
    if (visiting.has(item.id)) throw new Error('The selected production set contains a circular dependency.');
    if (visited.has(item.id)) return;
    visiting.add(item.id);
    (item.dependencies || []).forEach(function(dependencyId) {
      const dependency = byId.get(dependencyId);
      if (!dependency) throw new Error(`${item.title} requires ${dependencyId}, which is not selected.`);
      visit(dependency);
    });
    visiting.delete(item.id);
    visited.add(item.id);
    ordered.push(item);
  }

  selectedItems
    .slice()
    .sort(function(left, right) { return sourceIndex.get(left.id) - sourceIndex.get(right.id); })
    .forEach(visit);
  return ordered;
}

function validateSelection(plan, selection) {
  if (!selection || selection.planFingerprint !== planFingerprint(plan)) {
    return { valid: false, error: 'This selection no longer matches the current Build Plan.' };
  }
  if (!selection.selectedDeliverableIds?.length) {
    return { valid: false, error: 'Select at least one deliverable before approving production.' };
  }
  const items = flattenDeliverables(plan);
  const selectedIds = new Set(selection.selectedDeliverableIds);
  const selectedItems = items.filter(function(item) { return selectedIds.has(item.id); });
  try {
    const ordered = topologicalProductionOrder(selectedItems);
    return { valid: true, ordered };
  } catch (err) {
    const missingId = String(err.message).match(/requires ([^,]+),/)?.[1];
    const missingTitle = items.find(function(item) { return item.id === missingId; })?.title;
    return {
      valid: false,
      error: missingTitle ? err.message.replace(missingId, missingTitle) : err.message
    };
  }
}

function productionSourceContext(objective, confirmedUnderstanding = {}) {
  if (!['increase_conversion_rates', 'improve_search_rankings'].includes(objective)) return {};
  const source = {};
  const add = function(key, sourceKey, semanticRole = 'confirmed_fact') {
    const item = confirmedUnderstanding[sourceKey];
    if (!item || item.value === null || item.value === undefined || item.value === '') return;
    source[key] = {
      value: item.label || String(item.value),
      confidence: item.source === 'user_confirmed' ? 'High Confidence' : 'Moderate Confidence',
      explanation: item.source === 'user_confirmed'
        ? 'The builder confirmed this discovery input.'
        : 'This discovery input was inferred and has not been confirmed.',
      semanticRole: item.value === 'unsure' || item.source === 'unknown' ? 'unresolved' : semanticRole,
      sourceFields: [sourceKey]
    };
  };
  add('confirmedPrimaryCta', 'primaryCta');
  if (objective === 'increase_conversion_rates') {
    add('confirmedOffer', 'currentOffer');
    add('confirmedConversionAction', 'funnelType');
    add('builderDescribedPageExperience', 'pageExperience', 'builder_provided_context');
    add('builderProvidedConversionEvidence', 'conversionEvidence', 'builder_provided_context');
    add('observedConversionFriction', 'conversionFriction', 'builder_provided_context');
  }
  return source;
}

function createProductionStrategySnapshot({ objective, strategyResult, confirmedUnderstanding }) {
  return {
    ...(strategyResult?.strategy || {}),
    ...productionSourceContext(objective, confirmedUnderstanding),
    semanticInsights: strategyResult?.insights || {}
  };
}

function createApprovedProductionSet({ plan, selection, strategyResult, confirmedUnderstanding, batchMode = 'full' }) {
  const validation = validateSelection(plan, selection);
  if (!validation.valid) return validation;
  const approvedAt = new Date().toISOString();
  const selectedDeliverables = validation.ordered.map(function(item) {
    return {
      id: item.id,
      title: item.title,
      phase: item.phase,
      phaseTitle: item.phaseTitle,
      reason: item.reason,
      strategicDirection: item.strategicDirection,
      dependencies: item.dependencies || [],
      artifactRole: item.artifactRole,
      artifactRoleLabel: item.artifactRoleLabel,
      billingUnits: item.billingUnits,
      readyToUse: item.readyToUse
    };
  });
  return {
    valid: true,
    approvedAt,
    productionSet: {
      objective: plan.objective,
      selectedDeliverables,
      productionOrder: selectedDeliverables.map(function(item) { return item.id; }),
      strategySnapshot: createProductionStrategySnapshot({
        objective: plan.objective,
        strategyResult,
        confirmedUnderstanding
      }),
      planFingerprint: planFingerprint(plan),
      batchMode: batchMode === 'affordable' ? 'affordable' : 'full',
      approvedAt
    }
  };
}

function buildApprovalView(plan, selection) {
  const selected = new Set(selection.selectedDeliverableIds || []);
  const required = new Set(selection.requiredDependencyIds || []);
  const items = flattenDeliverables(plan);
  const byId = new Map(items.map(function(item) { return [item.id, item]; }));
  const selectedItems = items.filter(function(item) { return selected.has(item.id); });
  const counts = {
    total: selectedItems.length,
    essential: 0,
    recommended: 0,
    optional: 0,
    planningFoundation: 0,
    readyToUseAssets: 0,
    productionUnits: 0
  };
  selectedItems.forEach(function(item) {
    counts[item.recommendationLevel] += 1;
    if (item.artifactRole === 'planning_foundation') counts.planningFoundation += 1;
    if (item.artifactRole === 'ready_to_use_asset') counts.readyToUseAssets += 1;
    counts.productionUnits += Number(item.billingUnits || 0);
  });

  return {
    phases: plan.phases.map(function(phase) {
      return {
        ...phase,
        deliverables: phase.deliverables.map(function(item) {
          const classified = withArtifactPolicy(item);
          const dependentTitles = items.filter(function(candidate) {
            return selected.has(candidate.id) && (candidate.dependencies || []).includes(item.id);
          }).map(function(candidate) { return candidate.title; });
          return {
            ...classified,
            selected: selected.has(item.id),
            locked: required.has(item.id),
            dependencyNote: dependentTitles.length
              ? `${item.title} is required by ${dependentTitles.join(', ')}.`
              : (item.dependencies || []).length
                ? `Uses ${item.dependencies.map(function(id) { return byId.get(id)?.title; }).filter(Boolean).join(', ')} as a foundation.`
                : null
          };
        })
      };
    }),
    counts,
    messages: selection.messages || []
  };
}

module.exports = {
  buildApprovalView,
  createApprovedProductionSet,
  createDefaultSelection,
  createProductionStrategySnapshot,
  initializeSelection,
  planFingerprint,
  updateSelection,
  validateSelection
};
