const { DISCOVERY_POLICY_VERSION } = require('./discoveryRequirements');
const { getAvailableObjective } = require('./objectiveFramework');

const MAX_ORIGINAL_DESCRIPTION_LENGTH = 2000;
const MAX_PUBLIC_DETAIL_LENGTH = 2000;
const MAX_PUBLIC_LABEL_LENGTH = 160;

const PRODUCTION_FIELD_LABELS = Object.freeze({
  confirmedOffer: 'Offer',
  primaryCustomer: 'Primary customer',
  confirmedConversionAction: 'Conversion action',
  confirmedPrimaryCta: 'Primary call to action',
  primarySalesChannel: 'Current channel',
  builderDescribedPageExperience: 'Page experience',
  builderProvidedConversionEvidence: 'Conversion evidence',
  observedConversionFriction: 'Customer friction'
});

const PUBLIC_PRODUCTION_ROLES = new Set([
  'confirmed_fact',
  'inferred_fact',
  'builder_provided_context'
]);

const PRODUCTION_BUILD_PLAN_STATUS_LABELS = Object.freeze({
  awaiting_start: 'Approved; not started',
  queued: 'Queued for Production',
  running: 'In Production',
  completed: 'Completed',
  partially_completed: 'Partially completed',
  failed: 'Failed',
  blocked: 'Blocked',
  canceled: 'Canceled'
});

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeText(value, maximum = MAX_PUBLIC_DETAIL_LENGTH) {
  if (typeof value !== 'string' || value.includes('\0')) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : null;
}

function safeTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function understandingConcept(fieldKey, field = {}) {
  return ['trafficSource', 'currentAcquisitionChannel', 'salesChannel'].includes(fieldKey)
    ? 'current_channel' : field.memoryConcept || fieldKey;
}

function buildUnderstandingPresentation(session) {
  const seenConceptValues = new Set();
  const seenOpenConcepts = new Set();
  const understandingSummary = [];
  const unresolvedFields = [];
  const requirements = Array.isArray(session?.planningReadiness?.requirements)
    ? session.planningReadiness.requirements : [];
  const requirementLabels = new Map(requirements.flatMap(function(requirement) {
    const fields = Array.isArray(requirement?.fields) ? requirement.fields : [];
    return fields.map(function(fieldKey) {
      return [fieldKey, requirement.openInputLabel || requirement.domain];
    });
  }));
  const requirementConceptLabels = new Map(Array.from(requirementLabels, function([fieldKey, label]) {
    return [understandingConcept(fieldKey), label];
  }));

  Object.entries(session?.understanding || {}).forEach(function([fieldKey, field]) {
    if (!plainObject(field) || field.source === 'unknown' || field.value === null) return;
    const concept = understandingConcept(fieldKey, field);
    if (field.value === 'unsure') {
      if (seenOpenConcepts.has(concept)) return;
      seenOpenConcepts.add(concept);
      unresolvedFields.push({
        label: requirementLabels.get(fieldKey) || requirementConceptLabels.get(concept) || null
      });
      return;
    }
    if (!field.label) return;
    const value = String(field.label || field.value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const key = `${concept}:${value}`;
    if (seenConceptValues.has(key)) return;
    seenConceptValues.add(key);
    understandingSummary.push(field);
  });

  let fallbackIndex = 0;
  const openInputsSummary = unresolvedFields.map(function(item) {
    const label = safeText(item.label, MAX_PUBLIC_LABEL_LENGTH);
    if (label) return { label, status: 'Not established' };
    fallbackIndex += 1;
    return { label: `Planning input ${fallbackIndex}`, status: 'Not established' };
  });
  return { understandingSummary, openInputsSummary };
}

function objectivePresentation(objectiveId) {
  const objective = getAvailableObjective(objectiveId);
  return objective ? { title: objective.title } : null;
}

function validDiscoveryShape(state) {
  return Boolean(plainObject(state)
    && objectivePresentation(state.objective)
    && plainObject(state.answers)
    && plainObject(state.understanding)
    && plainObject(state.planningReadiness));
}

function validCompletedDiscoveryState(state) {
  return validDiscoveryShape(state) && Boolean(
    state.discoveryCompleteForNow
    || state.planningReadiness.discoveryCompleteForNow
    || state.reflectionStartedAt
  );
}

function originalDescription(state) {
  return safeText(state?.answers?.initial_description, MAX_ORIGINAL_DESCRIPTION_LENGTH);
}

function establishedDetails(state) {
  const presentation = buildUnderstandingPresentation(state);
  return presentation.understandingSummary.map(function(field) {
    return safeText(field.label, MAX_PUBLIC_DETAIL_LENGTH);
  }).filter(Boolean).map(function(label) { return { label }; });
}

function isCurrentPolicy(state) {
  return state.discoveryPolicyVersion === DISCOVERY_POLICY_VERSION
    && state.planningReadiness?.policyVersion === DISCOVERY_POLICY_VERSION;
}

function planningStatus(state, currentPolicy) {
  if (!currentPolicy) return 'Recorded under an earlier Discovery policy';
  if (state.planningReadiness.ready) return 'Ready for planning';
  if (state.discoveryCompleteForNow || state.planningReadiness.discoveryCompleteForNow) {
    return 'Discovery complete; additional input is required';
  }
  return 'Unavailable';
}

function strategyStatus(state) {
  return plainObject(state.strategyResult) && (state.strategyUpdatedAt || state.planningConfirmedAt)
    ? 'Prepared' : 'Not started';
}

function sessionBuildPlanStatus(state) {
  if (plainObject(state.approvedProductionSet)) return 'Approved';
  if (state.buildPlanSavedAt) return 'Saved';
  if (plainObject(state.buildPlan)) return 'Unavailable';
  return 'Not created';
}

function baseLinks(productionRunId = null) {
  const links = [{ href: '/production', label: 'View Production Plans' }];
  if (productionRunId) links.push({ href: `/production/${productionRunId}`, label: 'View this Production plan' });
  return links;
}

function unavailableSummary({ sourceLabel, message, objective = null, historical = false, status = {} }) {
  return {
    available: false,
    sourceLabel,
    objective,
    historical,
    partial: false,
    originalDescription: null,
    establishedDetails: [],
    openInputs: [],
    planningStatus: status.planningStatus || 'Unavailable',
    strategyStatus: status.strategyStatus || 'Unavailable',
    buildPlanStatus: status.buildPlanStatus || 'Unavailable',
    timestamps: status.timestamps || [],
    notices: [message],
    links: baseLinks(status.productionRunId)
  };
}

function projectDiscoveryState(state, options) {
  const sourceLabel = options.sourceLabel;
  if (!validCompletedDiscoveryState(state)) {
    return unavailableSummary({
      sourceLabel,
      message: 'A completed Discovery snapshot is not available for this journey.'
    });
  }

  const currentPolicy = isCurrentPolicy(state);
  const description = originalDescription(state);
  const presentation = buildUnderstandingPresentation(state);
  const timestamps = (options.timestamps || []).filter(item => safeTimestamp(item.value));
  const notices = [];
  if (!currentPolicy) notices.push('This is a historical snapshot. Its recorded readiness may not reflect the current Discovery policy.');
  else if (options.historical) notices.push('This is a saved point-in-time snapshot of the Discovery information recorded with this plan.');
  if (!description) notices.push('The original customer description is not available in a safe displayable form.');
  return {
    available: true,
    sourceLabel,
    objective: objectivePresentation(state.objective),
    historical: !currentPolicy || Boolean(options.historical),
    partial: false,
    asOf: safeTimestamp(options.asOf || state.updatedAt || state.reflectionStartedAt || state.startedAt),
    originalDescription: description,
    establishedDetails: establishedDetails(state),
    openInputs: presentation.openInputsSummary,
    planningStatus: planningStatus(state, currentPolicy),
    strategyStatus: strategyStatus(state),
    buildPlanStatus: options.buildPlanStatus || sessionBuildPlanStatus(state),
    timestamps,
    notices,
    links: baseLinks()
  };
}

function projectCurrentDiscoverySummary(state) {
  return projectDiscoveryState(state, {
    sourceLabel: 'Current Discovery session',
    asOf: state?.updatedAt || state?.reflectionStartedAt || state?.startedAt,
    timestamps: [
      { label: 'Discovery started', value: state?.startedAt },
      { label: 'Planning confirmed', value: state?.planningConfirmedAt },
      { label: 'Build Plan saved', value: state?.buildPlanSavedAt },
      { label: 'Approved for Production', value: state?.approvedProductionSet?.approvedAt }
    ]
  });
}

function projectSavedDiscoverySummary(savedPlan) {
  if (!savedPlan || savedPlan.stateVersion !== 1 || !validCompletedDiscoveryState(savedPlan.state)) {
    return unavailableSummary({
      sourceLabel: 'Saved Build Plan snapshot',
      message: 'This saved Discovery snapshot cannot be displayed safely.'
    });
  }
  const completed = savedPlan.status === 'completed';
  return projectDiscoveryState(savedPlan.state, {
    sourceLabel: 'Saved Build Plan snapshot',
    historical: true,
    asOf: savedPlan.updatedAt || savedPlan.savedAt,
    buildPlanStatus: completed ? 'Completed' : 'Saved',
    timestamps: [
      { label: 'Saved', value: savedPlan.savedAt },
      { label: 'Last updated', value: savedPlan.updatedAt },
      { label: 'Completed', value: savedPlan.completedAt }
    ]
  });
}

function parseSnapshot(value, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return plainObject(parsed) ? parsed : undefined;
  } catch (_) {
    return undefined;
  }
}

function productionEstablishedDetails(strategySnapshot) {
  return Object.entries(PRODUCTION_FIELD_LABELS).flatMap(function([key, label]) {
    const item = strategySnapshot[key];
    if (!plainObject(item) || !PUBLIC_PRODUCTION_ROLES.has(item.semanticRole)) return [];
    const value = safeText(item.label || item.value, MAX_PUBLIC_DETAIL_LENGTH);
    return value ? [{ label: `${label}: ${value}` }] : [];
  });
}

function productionBuildPlanStatus(status) {
  return PRODUCTION_BUILD_PLAN_STATUS_LABELS[status] || 'Unavailable';
}

function projectProductionDiscoverySummary(run) {
  const objective = objectivePresentation(run?.objective);
  const sourceLabel = 'Production snapshot';
  if (!run || !objective) return unavailableSummary({ sourceLabel, message: 'This Production Discovery snapshot is unavailable.' });
  const strategySnapshot = parseSnapshot(run.strategy_snapshot);
  const planSnapshot = parseSnapshot(run.production_plan_snapshot, { nullable: true });
  const timestamps = [
    { label: 'Approved', value: run.approved_at },
    { label: 'Production started', value: run.started_at },
    { label: 'Completed', value: run.completed_at }
  ].filter(item => safeTimestamp(item.value));
  const status = {
    planningStatus: 'Unavailable from this Production snapshot',
    strategyStatus: strategySnapshot && Object.keys(strategySnapshot).length ? 'Prepared' : 'Unavailable',
    buildPlanStatus: productionBuildPlanStatus(run.status),
    timestamps,
    productionRunId: run.id
  };
  if (strategySnapshot === undefined || planSnapshot === undefined) {
    return unavailableSummary({
      sourceLabel,
      objective,
      historical: true,
      message: 'This historical Production snapshot cannot be summarized safely.',
      status
    });
  }
  return {
    available: true,
    sourceLabel,
    objective,
    historical: true,
    partial: true,
    asOf: safeTimestamp(run.completed_at || run.updated_at || run.started_at || run.approved_at || run.created_at),
    originalDescription: null,
    establishedDetails: productionEstablishedDetails(strategySnapshot),
    openInputs: [],
    planningStatus: status.planningStatus,
    strategyStatus: status.strategyStatus,
    buildPlanStatus: status.buildPlanStatus,
    timestamps,
    notices: ['This is a partial historical snapshot. The original description and open Discovery inputs were not stored with this Production run.'],
    links: baseLinks(run.id)
  };
}

module.exports = {
  MAX_ORIGINAL_DESCRIPTION_LENGTH,
  buildUnderstandingPresentation,
  projectCurrentDiscoverySummary,
  projectProductionDiscoverySummary,
  projectSavedDiscoverySummary
};
