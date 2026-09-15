const FIELD_GROUPS = [
  {
    domain: 'Product',
    required: true,
    fields: [
      { key: 'initial_description', label: 'Product Description', answerField: true },
      { key: 'businessType', label: 'Business Type' },
      { key: 'industry', label: 'Industry' },
      { key: 'category', label: 'Category' }
    ]
  },
  { domain: 'Customer', required: true, fields: [{ key: 'targetAudience', label: 'Target Customer' }] },
  { domain: 'Customer Need / Desired Outcome', required: true, fields: [
    { key: 'intendedOutcome', label: 'Intended Customer Outcome' },
    { key: 'customerMotivation', label: 'Customer Need Signal' }
  ] },
  { domain: 'Product Development', required: true, fields: [{ key: 'conceptMaturity', label: 'Concept / Formulation Stage' }] },
  { domain: 'Existing Product', required: true, fields: [{ key: 'existingProductDefinition', label: 'Builder-Provided Product Context', editable: false }] },
  { domain: 'Product Exploration', required: false, fields: [{ key: 'productExplorationDirections', label: 'Directions to Explore', editable: false }] },
  { domain: 'Sales Channel', required: false, fields: [{ key: 'salesChannel', label: 'Sales Channel' }] },
  { domain: 'Competitive Context', required: false, fields: [{ key: 'competitiveDifferentiation', label: 'Differentiation Status' }] },
  { domain: 'Launch Stage', required: true, fields: [{ key: 'launchStage', label: 'Launch Stage' }] },
  { domain: 'Brand', required: false, fields: [{ key: 'brand', label: 'Brand' }] },
  { domain: 'Budget', required: false, fields: [{ key: 'budget', label: 'Budget' }] },
  { domain: 'Timeline', required: false, fields: [{ key: 'timeline', label: 'Timeline' }] }
];
const ACQUISITION_FIELD_GROUPS = [
  { domain: 'Offer', required: true, fields: [{ key: 'initial_description', label: 'Business and Offer Description', answerField: true }, { key: 'businessType', label: 'Offer Type' }] },
  { domain: 'Priority Customer', required: true, fields: [{ key: 'targetAudience', label: 'Priority Customer' }, { key: 'acquisitionGoal', label: 'Growth Goal' }] },
  { domain: 'Current Acquisition', required: true, fields: [{ key: 'currentAcquisitionChannel', label: 'Current Customer Source' }, { key: 'acquisitionStage', label: 'Acquisition Maturity' }] },
  { domain: 'Conversion Path', required: true, fields: [{ key: 'salesProcess', label: 'Sales Process' }] },
  { domain: 'Delivery Capacity', required: true, fields: [{ key: 'capacityReadiness', label: 'Capacity Readiness' }] }
];
const CONVERSION_FIELD_GROUPS = [
  { domain: 'Offer', required: true, fields: [{ key: 'initial_description', label: 'Business Context', answerField: true }, { key: 'currentOffer', label: 'Current Offer' }] },
  { domain: 'Audience & Traffic', required: true, fields: [{ key: 'targetAudience', label: 'Target Audience' }, { key: 'trafficSource', label: 'Primary Traffic Source' }] },
  { domain: 'Conversion Path', required: true, fields: [{ key: 'funnelType', label: 'Primary Conversion Action' }, { key: 'primaryCta', label: 'Current Call to Action' }] },
  { domain: 'Page Experience', required: true, fields: [{ key: 'pageExperience', label: 'Current Page or Funnel' }] },
  { domain: 'Available Evidence', required: false, fields: [{ key: 'conversionEvidence', label: 'Builder-Provided Measurements' }, { key: 'conversionFriction', label: 'Observed Friction or Objections' }] }
];

const EDITABLE_FIELDS = new Set(FIELD_GROUPS.concat(ACQUISITION_FIELD_GROUPS, CONVERSION_FIELD_GROUPS).flatMap(function(group) {
  return group.fields.filter(function(field) { return field.editable !== false; }).map(function(field) { return field.key; });
}));
const MAX_REFLECTION_EDIT_LENGTH = 2000;

function confidenceMessage(field) {
  if (field.value === 'unsure') return 'This remains unresolved and can be refined later.';
  if (field.source === 'user_confirmed') return 'You confirmed this.';
  if (field.confidence >= 0.9) return 'I’m highly confident in this understanding.';
  if (field.confidence >= 0.7) return 'This appears well understood.';
  return 'This is a working understanding that you can refine.';
}

function buildBusinessReflection({ objective, answers = {}, understanding = {}, planningReadiness }) {
  const fieldGroups = objective === 'get_more_customers' ? ACQUISITION_FIELD_GROUPS
    : objective === 'increase_conversion_rates' ? CONVERSION_FIELD_GROUPS : FIELD_GROUPS;
  const groups = fieldGroups.map(function(group) {
    const fields = group.fields.map(function(definition) {
      if (definition.answerField) {
        const value = answers.initial_description;
        if (!value) return null;
        return {
          key: definition.key,
          label: definition.label,
          value,
          confidenceMessage: 'You provided this description.'
        };
      }

      const field = understanding[definition.key];
      if (!field || field.value === null || field.source === 'unknown') return null;
      return {
        key: definition.key,
        label: definition.label,
        value: field.value === 'unsure' ? "I'm not sure yet" : (field.label || String(field.value)),
        confidenceMessage: confidenceMessage(field),
        editable: definition.editable !== false,
        values: Array.isArray(field.labels) ? field.labels : null,
        additionalDetail: field.additionalDetail || null,
        semanticRole: field.semanticRole || null,
        semanticNote: field.semanticRole === 'exploration_intent'
          ? 'These are directions you chose to explore, not confirmed formulation details or product claims.'
          : field.semanticRole === 'builder_provided_product_context'
            ? 'This describes what you told CopyQuick exists or is planned. It is not independent verification of ingredients, efficacy, claims, or substantiation.'
            : null
      };
    }).filter(Boolean);

    return fields.length ? {
      domain: group.domain,
      required: group.required,
      statusLabel: fields.some(function(field) { return field.semanticRole === 'exploration_intent'; })
        ? 'Guided exploration'
        : (group.required ? 'Planning essential' : 'Optional context'),
      fields
    } : null;
  }).filter(Boolean);

  return {
    groups,
    optionalKnowledgeGaps: planningReadiness?.optionalKnowledgeGaps || [],
    blockingRequirements: planningReadiness?.unresolvedBlockingRequirements || [],
    unaskedEssentialRequirements: planningReadiness?.unaskedEssentialRequirements || []
  };
}

function confirmedUnderstandingOnly(understanding = {}) {
  return Object.fromEntries(Object.entries(understanding).filter(function(entry) {
    return entry[1]?.source === 'user_confirmed';
  }));
}

function applyReflectionEdit({ answers = {}, understanding = {}, field, value }) {
  if (!EDITABLE_FIELDS.has(field)) {
    throw new Error('Unknown reflection field.');
  }

  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  if (!normalizedValue) {
    throw new Error('Enter a value before saving this field.');
  }
  if (normalizedValue.length > MAX_REFLECTION_EDIT_LENGTH || normalizedValue.includes('\0')) {
    throw new Error(`Keep this value under ${MAX_REFLECTION_EDIT_LENGTH} characters.`);
  }

  const updatedAnswers = {
    ...answers,
    reflection_edits: {
      ...(answers.reflection_edits || {}),
      [field]: normalizedValue
    }
  };
  const existingUnderstanding = confirmedUnderstandingOnly(understanding);

  if (field === 'initial_description') {
    updatedAnswers.initial_description = normalizedValue;
  } else {
    existingUnderstanding[field] = {
      value: normalizedValue,
      label: normalizedValue,
      confidence: 1,
      source: 'user_confirmed'
    };
  }

  return { answers: updatedAnswers, existingUnderstanding };
}

module.exports = {
  MAX_REFLECTION_EDIT_LENGTH,
  applyReflectionEdit,
  buildBusinessReflection
};
