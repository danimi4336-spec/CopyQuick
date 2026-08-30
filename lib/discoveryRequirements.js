const DISCOVERY_POLICY_VERSION = 2;
const SETTLED_CONFIDENCE = 0.7;

const QUESTION_CATALOG = {
  business_type: {
    understandingField: 'businessType',
    prompt: 'What kind of offer are you building?',
    explanation: 'This gives me the context needed to ask useful launch questions without making assumptions.',
    options: [
      ['physical_product', 'A physical product'], ['digital_product', 'A digital product'],
      ['service', 'A service'], ['software', 'Software or an app'], ['unsure', "I'm not sure yet"],
      ['other', 'Other', true]
    ]
  },
  supplement_intended_outcome: {
    understandingField: 'intendedOutcome',
    prompt: 'What would you most like this supplement to help people with?',
    explanation: 'Choose the broad direction you want to explore. This records your intended product direction, not a medical or scientific claim.',
    options: [
      ['everyday_wellness', 'Everyday wellness'], ['energy_focus', 'Energy or focus'],
      ['digestive_wellness', 'Digestive wellness'], ['sleep_stress_support', 'Sleep or stress support'],
      ['mobility_active_lifestyle', 'Mobility or active-lifestyle support'], ['unsure', "I'm not sure yet"],
      ['other', 'Other', true]
    ]
  },
  supplement_outcome_exploration: {
    understandingField: 'intendedOutcome',
    prompt: 'Which customer situation feels most worth exploring first?',
    explanation: "That's okay — we can figure this out together. Choose a direction only if one feels useful; CopyQuick will not treat a suggestion as fact until you confirm it.",
    options: [
      ['steady_daily_wellness', 'Supporting a steady everyday wellness routine'],
      ['daily_energy_focus', 'Helping people feel more supported with daily energy or focus'],
      ['digestive_routine', 'Supporting digestive wellness as part of a daily routine'],
      ['rest_stress_routine', 'Supporting a calmer rest or stress-management routine'],
      ['active_lifestyle', 'Supporting movement and an active lifestyle'],
      ['unsure', "I'm still not sure yet"], ['other', 'Other', true]
    ]
  },
  supplement_concept_maturity: {
    understandingField: 'conceptMaturity',
    prompt: 'How developed is the supplement idea today?',
    explanation: 'This helps CopyQuick distinguish an early concept from a product that already has formulation work behind it.',
    options: [
      ['idea_only', 'I only have the product idea'],
      ['direction_no_formula', 'I know the direction, but not the formula'],
      ['formula_in_mind', 'I have ingredients or a formula in mind'],
      ['in_development', 'A formula or product is already being developed'],
      ['finalized', 'The product is already finalized'],
      ['unsure', "I'm not sure yet"], ['other', 'Other', true]
    ]
  },
  target_audience: {
    understandingField: 'targetAudience', prompt: 'Who is this product primarily for?',
    explanation: 'Knowing who you want to reach helps shape the offer, message and launch plan.',
    options: [['consumers', 'Individual consumers'], ['businesses', 'Businesses or teams'], ['professionals', 'A specific profession'], ['local_customers', 'Customers in my local area'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  customer_motivation: {
    understandingField: 'customerMotivation', prompt: 'What makes people want this product?',
    explanation: 'This clarifies the customer need or desired outcome without assuming a finished value proposition.',
    options: [['solve_problem', 'It solves a clear problem'], ['fulfill_desire', 'It fulfills a desire or aspiration'], ['convenience', 'It makes something easier or faster'], ['identity_experience', 'It offers identity, enjoyment or experience'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  sales_channel: {
    understandingField: 'salesChannel', prompt: 'Where do you plan to sell this product?',
    explanation: 'This helps tailor execution to channels you have actually chosen; it can remain open while foundation strategy develops.',
    options: [['amazon', 'Amazon'], ['own_website', 'Shopify / my own website'], ['retail', 'Retail stores'], ['multiple', 'Multiple channels'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  competitive_differentiation: {
    understandingField: 'competitiveDifferentiation', prompt: 'How different is this from products already available?',
    explanation: 'This is useful competitive context, but it can remain unresolved while the product direction develops.',
    options: [['clear', 'It has clear, meaningful differences'], ['partial', 'It is different in a few ways'], ['similar', 'It is similar to existing products'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  launch_stage: {
    understandingField: 'launchStage', prompt: 'What stage is the product in today?',
    explanation: 'This keeps the recommended next steps realistic for where you are now.',
    options: [['idea', 'Idea or early concept'], ['development', 'In development'], ['ready', 'Ready to launch'], ['selling', 'Already selling'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  brand: {
    understandingField: 'brand', prompt: 'How developed is the brand for this product?', explanation: 'This optional context can make later recommendations more precise.',
    options: [['established', 'The brand is established'], ['in_progress', 'The brand is in progress'], ['name_only', 'I only have a name'], ['not_started', 'I have not started the brand yet'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  budget: {
    understandingField: 'budget', prompt: 'What launch investment are you planning for?', explanation: 'This optional context keeps recommendations proportionate.',
    options: [['under_1000', 'Under $1,000'], ['1000_5000', '$1,000–$5,000'], ['5000_25000', '$5,000–$25,000'], ['over_25000', 'More than $25,000'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  timeline: {
    understandingField: 'timeline', prompt: 'When would you like to launch?', explanation: 'This optional context helps sequence work.',
    options: [['within_month', 'Within one month'], ['one_to_three_months', 'In one to three months'], ['three_to_six_months', 'In three to six months'], ['later', 'More than six months from now'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  }
};

function normalizedOptions(options) {
  return options.map(function(option) {
    return { value: option[0], label: option[1], ...(option[2] ? { allowsText: true } : {}) };
  });
}

function settled(field) {
  return Boolean(field && field.value !== null && field.value !== 'unsure' && field.source !== 'unknown'
    && (field.source === 'user_confirmed' || Number(field.confidence) >= SETTLED_CONFIDENCE));
}

function isSupplement(understanding) {
  return understanding?.category?.value === 'dietary_supplement';
}

function requirementsFor({ objective, understanding = {} }) {
  if (objective !== 'launch_product') throw new Error(`Unsupported discovery objective: ${objective || 'missing'}`);
  const supplement = isSupplement(understanding);
  return [
    { id: 'product_context', domain: 'Product', importance: 120, essential: true, fields: supplement ? ['businessType', 'category'] : ['businessType'], allFields: true, questionIds: ['business_type'], unresolvedPolicy: 'block' },
    ...(supplement ? [{ id: 'intended_outcome', domain: 'Customer Need / Desired Outcome', importance: 115, essential: true, fields: ['intendedOutcome'], questionIds: ['supplement_intended_outcome', 'supplement_outcome_exploration'], unresolvedPolicy: 'guided_followup' }] : [{ id: 'customer_need', domain: 'Customer Need / Desired Outcome', importance: 95, essential: true, fields: ['customerMotivation'], questionIds: ['customer_motivation'], unresolvedPolicy: 'block' }]),
    ...(supplement ? [{ id: 'concept_maturity', domain: 'Product', importance: 110, essential: true, fields: ['conceptMaturity'], questionIds: ['supplement_concept_maturity'], unresolvedPolicy: 'block' }] : []),
    { id: 'target_customer', domain: 'Customer', importance: 100, essential: true, fields: ['targetAudience'], questionIds: ['target_audience'], unresolvedPolicy: 'block' },
    { id: 'launch_stage', domain: 'Launch Stage', importance: 80, essential: true, fields: ['launchStage'], questionIds: ['launch_stage'], unresolvedPolicy: 'block' },
    { id: 'sales_channel', domain: 'Sales Channel', importance: 75, essential: false, fields: ['salesChannel'], questionIds: ['sales_channel'], unresolvedPolicy: 'defer' },
    { id: 'competitive_context', domain: 'Competitive Context', importance: 60, essential: false, fields: ['competitiveDifferentiation'], questionIds: ['competitive_differentiation'], unresolvedPolicy: 'defer', prerequisites: [supplement ? 'intended_outcome' : 'customer_need'] },
    { id: 'brand', domain: 'Brand', importance: 30, essential: false, fields: ['brand'], questionIds: ['brand'], unresolvedPolicy: 'defer', askByDefault: false },
    { id: 'budget', domain: 'Budget', importance: 20, essential: false, fields: ['budget'], questionIds: ['budget'], unresolvedPolicy: 'defer', askByDefault: false },
    { id: 'timeline', domain: 'Timeline', importance: 15, essential: false, fields: ['timeline'], questionIds: ['timeline'], unresolvedPolicy: 'defer', askByDefault: false }
  ];
}

function answerValue(answer) {
  return answer && typeof answer === 'object' ? answer.value : answer;
}

function stateFor(requirement, understanding, answers) {
  const established = requirement.allFields
    ? requirement.fields.every(function(field) { return settled(understanding[field]); })
    : requirement.fields.some(function(field) { return settled(understanding[field]); });
  if (established) return 'known';
  const answered = requirement.questionIds.filter(function(id) { return Object.prototype.hasOwnProperty.call(answers, id); });
  if (!answered.length) return 'unasked';
  const hasFurtherQuestion = requirement.questionIds.some(function(id) { return !Object.prototype.hasOwnProperty.call(answers, id); });
  if (requirement.unresolvedPolicy === 'guided_followup' && hasFurtherQuestion) return 'unresolved_nonblocking';
  return requirement.essential ? 'unresolved_blocking' : 'unresolved_nonblocking';
}

function nextQuestionId(requirement, answers) {
  if (requirement.id === 'intended_outcome') {
    if (!Object.prototype.hasOwnProperty.call(answers, 'supplement_intended_outcome')) return 'supplement_intended_outcome';
    if (answerValue(answers.supplement_intended_outcome) === 'unsure'
      && !Object.prototype.hasOwnProperty.call(answers, 'supplement_outcome_exploration')) return 'supplement_outcome_exploration';
    return null;
  }
  return requirement.questionIds.find(function(id) { return !Object.prototype.hasOwnProperty.call(answers, id); }) || null;
}

function buildQuestion(questionId, requirement) {
  const definition = QUESTION_CATALOG[questionId];
  if (!definition) return null;
  return {
    id: questionId, requirementId: requirement.id, domain: requirement.domain,
    prompt: definition.prompt, explanation: definition.explanation, type: 'single_choice',
    options: normalizedOptions(definition.options), importance: requirement.importance,
    understandingField: definition.understandingField,
    guidedExploration: questionId === 'supplement_outcome_exploration'
  };
}

function evaluateRequirements({ objective, understanding = {}, answers = {} }) {
  const requirements = requirementsFor({ objective, understanding });
  const states = Object.fromEntries(requirements.map(function(requirement) {
    return [requirement.id, stateFor(requirement, understanding, answers)];
  }));
  const candidates = requirements.filter(function(requirement) {
    if (states[requirement.id] === 'known') return false;
    if (!requirement.essential && requirement.askByDefault === false) return false;
    const prerequisitesKnown = (requirement.prerequisites || []).every(function(id) { return states[id] === 'known'; });
    return prerequisitesKnown && Boolean(nextQuestionId(requirement, answers));
  }).sort(function(left, right) { return right.importance - left.importance; });
  const selected = candidates[0] || null;
  const nextQuestion = selected ? buildQuestion(nextQuestionId(selected, answers), selected) : null;
  const entries = requirements.map(function(requirement) {
    return { id: requirement.id, domain: requirement.domain, essential: requirement.essential, state: states[requirement.id] };
  });
  const knownRequirements = entries.filter(function(item) { return item.state === 'known'; }).map(function(item) { return item.id; });
  const answeredRequirements = entries.filter(function(item) { return item.state !== 'unasked'; }).map(function(item) { return item.id; });
  const unresolvedBlockingRequirements = entries.filter(function(item) { return item.state === 'unresolved_blocking'; });
  const unresolvedNonBlockingRequirements = entries.filter(function(item) { return item.state === 'unresolved_nonblocking'; });
  const unaskedEssentialRequirements = entries.filter(function(item) { return item.essential && item.state === 'unasked'; });
  const optionalKnowledgeGaps = entries.filter(function(item) { return !item.essential && item.state !== 'known'; }).map(function(item) { return item.domain; });
  return {
    policyVersion: DISCOVERY_POLICY_VERSION,
    requirements: entries,
    nextQuestion,
    discoveryCompleteForNow: nextQuestion === null,
    ready: unaskedEssentialRequirements.length === 0 && unresolvedBlockingRequirements.length === 0,
    answeredRequirements,
    knownRequirements,
    unresolvedBlockingRequirements,
    unresolvedNonBlockingRequirements,
    unaskedEssentialRequirements,
    optionalKnowledgeGaps
  };
}

function isMeaningfullyReady(readiness) {
  return Boolean(readiness?.ready
    && readiness.policyVersion === DISCOVERY_POLICY_VERSION
    && Array.isArray(readiness.unresolvedBlockingRequirements)
    && readiness.unresolvedBlockingRequirements.length === 0
    && Array.isArray(readiness.unaskedEssentialRequirements)
    && readiness.unaskedEssentialRequirements.length === 0);
}

function isDiscoverySessionReady(session) {
  if (!session?.objective || !session?.understanding || !session?.answers) return false;
  try {
    return isMeaningfullyReady(evaluateRequirements({
      objective: session.objective,
      understanding: session.understanding,
      answers: session.answers
    }));
  } catch (err) {
    return false;
  }
}

module.exports = {
  DISCOVERY_POLICY_VERSION,
  evaluateRequirements,
  isDiscoverySessionReady,
  isMeaningfullyReady,
  requirementsFor
};
