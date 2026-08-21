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
  { domain: 'Value Proposition', required: true, fields: [{ key: 'customerMotivation', label: 'Customer Value' }] },
  { domain: 'Sales Channel', required: true, fields: [{ key: 'salesChannel', label: 'Sales Channel' }] },
  { domain: 'Competitive Positioning', required: true, fields: [{ key: 'competitiveDifferentiation', label: 'Competitive Position' }] },
  { domain: 'Launch Stage', required: true, fields: [{ key: 'launchStage', label: 'Launch Stage' }] },
  { domain: 'Brand', required: false, fields: [{ key: 'brand', label: 'Brand' }] },
  { domain: 'Budget', required: false, fields: [{ key: 'budget', label: 'Budget' }] },
  { domain: 'Timeline', required: false, fields: [{ key: 'timeline', label: 'Timeline' }] }
];

const EDITABLE_FIELDS = new Set(FIELD_GROUPS.flatMap(function(group) {
  return group.fields.map(function(field) { return field.key; });
}));

function confidenceMessage(field) {
  if (field.source === 'user_confirmed') return 'You confirmed this.';
  if (field.confidence >= 0.9) return 'I’m highly confident in this understanding.';
  if (field.confidence >= 0.7) return 'This appears well understood.';
  return 'This is a working understanding that you can refine.';
}

function buildBusinessReflection({ answers = {}, understanding = {}, planningReadiness }) {
  const groups = FIELD_GROUPS.map(function(group) {
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
        value: field.label || String(field.value),
        confidenceMessage: confidenceMessage(field)
      };
    }).filter(Boolean);

    return fields.length ? {
      domain: group.domain,
      required: group.required,
      fields
    } : null;
  }).filter(Boolean);

  return {
    groups,
    optionalKnowledgeGaps: planningReadiness?.optionalKnowledgeGaps || []
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
  applyReflectionEdit,
  buildBusinessReflection
};
