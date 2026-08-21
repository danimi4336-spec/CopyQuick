const DOMAIN_DEFINITIONS = [
  { name: 'Product', importance: 100, required: true, fields: ['businessType', 'industry', 'category'], questionId: 'business_type' },
  { name: 'Customer', importance: 100, required: true, fields: ['targetAudience'], questionId: 'target_audience' },
  { name: 'Value Proposition', importance: 95, required: true, fields: ['customerMotivation'], questionId: 'customer_motivation' },
  { name: 'Sales Channel', importance: 90, required: true, fields: ['salesChannel'], questionId: 'sales_channel' },
  { name: 'Competitive Positioning', importance: 90, required: true, fields: ['competitiveDifferentiation'], questionId: 'competitive_differentiation' },
  { name: 'Launch Stage', importance: 80, required: true, fields: ['launchStage'], questionId: 'launch_stage' },
  { name: 'Brand', importance: 60, required: false, fields: ['brand'], questionId: 'brand' },
  { name: 'Budget', importance: 40, required: false, fields: ['budget'], questionId: 'budget' },
  { name: 'Timeline', importance: 30, required: false, fields: ['timeline'], questionId: 'timeline' }
];

const QUESTION_CATALOG = {
  business_type: {
    understandingField: 'businessType',
    prompt: 'What kind of offer are you building?',
    explanation: 'This gives me the context needed to ask useful launch questions without making assumptions.',
    options: [
      { value: 'physical_product', label: 'A physical product' },
      { value: 'digital_product', label: 'A digital product' },
      { value: 'service', label: 'A service' },
      { value: 'software', label: 'Software or an app' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  },
  target_audience: {
    understandingField: 'targetAudience',
    prompt: 'Who is this product primarily for?',
    explanation: 'Knowing who you want to reach helps shape the offer, message and launch plan.',
    options: [
      { value: 'consumers', label: 'Individual consumers' },
      { value: 'businesses', label: 'Businesses or teams' },
      { value: 'professionals', label: 'A specific profession' },
      { value: 'local_customers', label: 'Customers in my local area' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  },
  customer_motivation: {
    understandingField: 'customerMotivation',
    prompt: 'What makes people want this product?',
    explanation: 'This clarifies the value customers are buying—whether that is solving a problem, fulfilling a desire or something else.',
    options: [
      { value: 'solve_problem', label: 'It solves a clear problem' },
      { value: 'fulfill_desire', label: 'It fulfills a desire or aspiration' },
      { value: 'convenience', label: 'It makes something easier or faster' },
      { value: 'identity_experience', label: 'It offers identity, enjoyment or experience' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  },
  sales_channel: {
    understandingField: 'salesChannel',
    prompt: 'Where do you plan to sell this product?',
    explanation: 'This helps me tailor your launch strategy to the channels you will actually use.',
    options: [
      { value: 'amazon', label: 'Amazon' },
      { value: 'own_website', label: 'Shopify / my own website' },
      { value: 'retail', label: 'Retail stores' },
      { value: 'multiple', label: 'Multiple channels' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  },
  competitive_differentiation: {
    understandingField: 'competitiveDifferentiation',
    prompt: 'How different is this from products already available?',
    explanation: 'This helps identify whether your launch should lead with product differences, positioning or another advantage.',
    options: [
      { value: 'clear', label: 'It has clear, meaningful differences' },
      { value: 'partial', label: 'It is different in a few ways' },
      { value: 'similar', label: 'It is similar to existing products' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  },
  launch_stage: {
    understandingField: 'launchStage',
    prompt: 'What stage is the product in today?',
    explanation: 'This keeps the recommended next steps realistic for where you are now.',
    options: [
      { value: 'idea', label: 'Idea or early concept' },
      { value: 'development', label: 'In development' },
      { value: 'ready', label: 'Ready to launch' },
      { value: 'selling', label: 'Already selling' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  },
  brand: {
    understandingField: 'brand',
    prompt: 'How developed is the brand for this product?',
    explanation: 'This shows whether your launch needs brand foundations or can build on decisions already made.',
    options: [
      { value: 'established', label: 'The brand is established' },
      { value: 'in_progress', label: 'The brand is in progress' },
      { value: 'name_only', label: 'I only have a name' },
      { value: 'not_started', label: 'I have not started the brand yet' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  },
  budget: {
    understandingField: 'budget',
    prompt: 'What launch investment are you planning for?',
    explanation: 'This keeps recommendations proportionate to the resources you want to commit.',
    options: [
      { value: 'under_1000', label: 'Under $1,000' },
      { value: '1000_5000', label: '$1,000–$5,000' },
      { value: '5000_25000', label: '$5,000–$25,000' },
      { value: 'over_25000', label: 'More than $25,000' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  },
  timeline: {
    understandingField: 'timeline',
    prompt: 'When would you like to launch?',
    explanation: 'This helps sequence the work around the time you actually have available.',
    options: [
      { value: 'within_month', label: 'Within one month' },
      { value: 'one_to_three_months', label: 'In one to three months' },
      { value: 'three_to_six_months', label: 'In three to six months' },
      { value: 'later', label: 'More than six months from now' },
      { value: 'unsure', label: "I'm not sure yet" },
      { value: 'other', label: 'Other', allowsText: true }
    ]
  }
};

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function fieldConfidence(field) {
  if (!field || field.value === null || field.value === 'unsure' || field.source === 'unknown') return 0;
  return clampConfidence(field.confidence);
}

function domainConfidence(definition, understanding) {
  const confidences = definition.fields
    .map(function(field) { return fieldConfidence(understanding[field]); })
    .filter(function(confidence) { return confidence > 0; });
  if (!confidences.length) return 0;
  return confidences.reduce(function(sum, confidence) { return sum + confidence; }, 0) / confidences.length;
}

function statusForConfidence(confidence) {
  if (confidence >= 0.7) return 'known';
  if (confidence > 0) return 'partial';
  return 'unknown';
}

function buildQuestion(definition) {
  const template = QUESTION_CATALOG[definition.questionId];
  if (!template) return null;
  return {
    id: definition.questionId,
    domain: definition.name,
    prompt: template.prompt,
    explanation: template.explanation,
    type: 'single_choice',
    options: template.options.map(function(option) { return { ...option }; }),
    importance: definition.importance,
    understandingField: template.understandingField
  };
}

function analyzeDiscovery({ objective, understanding = {}, unknowns = [], answers = {} }) {
  if (objective !== 'launch_product') {
    throw new Error(`Unsupported discovery objective: ${objective || 'missing'}`);
  }

  const knowledgeDomains = {};
  const candidates = [];
  const reasoning = [];
  let weightedScore = 0;
  let totalImportance = 0;

  DOMAIN_DEFINITIONS.forEach(function(definition, index) {
    const confidence = domainConfidence(definition, understanding);
    const score = Math.round(confidence * 100);
    const status = statusForConfidence(confidence);
    const priority = definition.importance * (1 - confidence);
    const questionAnswered = Object.prototype.hasOwnProperty.call(answers, definition.questionId)
      && confidence > 0;

    knowledgeDomains[definition.name] = {
      score,
      importance: definition.importance,
      confidence: Number(confidence.toFixed(2)),
      status
    };
    weightedScore += definition.importance * confidence;
    totalImportance += definition.importance;

    if (status === 'known') {
      reasoning.push({
        skippedDomain: definition.name,
        reason: 'Already understood from previous answers.'
      });
    } else if (definition.required && !questionAnswered) {
      candidates.push({ definition, priority, index });
    }
  });

  candidates.sort(function(left, right) {
    return right.priority - left.priority || left.index - right.index;
  });

  const selected = candidates[0] || null;
  const nextQuestion = selected ? buildQuestion(selected.definition) : null;
  if (selected) {
    reasoning.push({
      selectedDomain: selected.definition.name,
      reason: 'Highest importance multiplied by missing confidence.',
      priority: Number(selected.priority.toFixed(2))
    });
  }

  const requiredDomains = DOMAIN_DEFINITIONS.filter(function(definition) { return definition.required; });
  const optionalDomains = DOMAIN_DEFINITIONS.filter(function(definition) { return !definition.required; });
  const unsatisfiedRequiredDomains = requiredDomains
    .filter(function(definition) { return knowledgeDomains[definition.name].status !== 'known'; })
    .map(function(definition) { return definition.name; });
  const optionalKnowledgeGaps = optionalDomains
    .filter(function(definition) { return knowledgeDomains[definition.name].status !== 'known'; })
    .map(function(definition) { return definition.name; });

  return {
    completion: Math.round((weightedScore / totalImportance) * 100),
    knowledgeDomains,
    nextQuestion,
    reasoning,
    planningReadiness: {
      ready: unsatisfiedRequiredDomains.length === 0,
      requiredDomains: requiredDomains.map(function(definition) { return definition.name; }),
      satisfiedRequiredDomains: requiredDomains
        .filter(function(definition) { return knowledgeDomains[definition.name].status === 'known'; })
        .map(function(definition) { return definition.name; }),
      unsatisfiedRequiredDomains,
      optionalDomains: optionalDomains.map(function(definition) { return definition.name; }),
      optionalKnowledgeGaps
    },
    remainingKnowledgeGaps: DOMAIN_DEFINITIONS
      .filter(function(definition) { return knowledgeDomains[definition.name].status !== 'known'; })
      .map(function(definition) { return definition.name; })
  };
}

module.exports = {
  analyzeDiscovery
};
