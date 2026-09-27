const SETTLED_CONFIDENCE = 0.7;
const { interpretDiscovery } = require('./aiDiscoveryInterpreter');

const VALUE_LABELS = {
  physical_product: 'Physical Product',
  digital_product: 'Digital Product',
  service: 'Service Business',
  software: 'Software / SaaS',
  health_wellness: 'Health & Wellness',
  education: 'Education',
  technology: 'Technology',
  automotive: 'Automotive Services',
  home_services: 'Home Services',
  professional_services: 'Professional Services',
  beauty_personal_care: 'Beauty & Personal Care',
  dietary_supplement: 'Dietary Supplement',
  auto_detailing: 'Mobile Auto Detailing',
  coaching: 'Coaching',
  consulting: 'Consulting',
  online_course: 'Online Course',
  ebook: 'eBook',
  everyday_wellness: 'General health & everyday wellness',
  energy_focus: 'Energy & focus',
  digestive_wellness: 'Digestive health',
  sleep_stress_support: 'Sleep & relaxation',
  mobility_active_lifestyle: 'Joint, mobility & active-lifestyle support',
  immune_health: 'Immune health',
  healthy_aging: 'Healthy aging',
  amazon: 'Amazon',
  own_website: 'Shopify / my own website',
  retail: 'Retail stores',
  steady_daily_wellness: 'Supporting a steady everyday wellness routine',
  daily_energy_focus: 'Staying energized and focused through the day',
  digestive_routine: 'Building a more comfortable digestive routine',
  rest_stress_routine: 'Winding down and relaxing',
  active_lifestyle: 'Staying active and mobile',
  immune_wellness_exploration: 'Exploring immune wellness',
  healthy_aging_exploration: 'Supporting wellness through healthy aging',
  idea_only: 'Product idea only',
  direction_no_formula: 'Direction known; formula not established',
  formula_in_mind: 'Ingredients or formula in mind',
  in_development: 'Formula or product in development',
  finalized: 'Product finalized',
  idea: 'Idea or early concept',
  development: 'In development'
  ,qualified_leads: 'More qualified leads'
  ,direct_sales: 'More direct sales'
  ,appointments: 'More booked appointments'
  ,repeat_customers: 'More repeat customers'
  ,referrals: 'Referrals'
  ,organic_search: 'Organic search or content'
  ,social: 'Social media'
  ,paid_ads: 'Paid advertising'
  ,outbound: 'Outbound outreach'
  ,mixed_channels: 'A mix of channels'
  ,no_reliable_channel: 'No reliable channel yet'
  ,inconsistent_traction: 'Some traction, but inconsistent'
  ,working_channel: 'A working channel to scale'
  ,optimizing: 'An established system to optimize'
  ,self_serve: 'Self-serve purchase'
  ,booked_call: 'Booked call or appointment'
  ,sales_conversation: 'Direct sales conversation'
  ,marketplace_retail: 'Marketplace or retail purchase'
  ,capacity_ready: 'Ready to serve more customers now'
  ,capacity_limited: 'Capacity needs attention before scaling'
};

const UNDERSTANDING_FIELDS = [
  'businessType',
  'industry',
  'category',
  'targetAudience',
  'customerMotivation',
  'intendedOutcome',
  'conceptMaturity',
  'existingProductDefinition',
  'productExplorationDirections',
  'salesChannel',
  'competitiveDifferentiation',
  'launchStage',
  'brand',
  'budget',
  'timeline'
  ,'acquisitionGoal'
  ,'currentAcquisitionChannel'
  ,'acquisitionStage'
  ,'salesProcess'
  ,'capacityReadiness'
];

function unknownField() {
  return { value: null, label: null, confidence: 0, source: 'unknown' };
}

function inferredField(value, confidence) {
  return {
    value,
    label: VALUE_LABELS[value] || value,
    confidence,
    source: 'inference'
  };
}

function aiInferredField(value) {
  return {
    value,
    label: VALUE_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1),
    confidence: 0.78,
    source: 'ai_inference'
  };
}

function hasAny(text, signals) {
  return signals.some(function(signal) {
    return new RegExp(`\\b${signal}\\b`, 'i').test(text);
  });
}

function classifyWithRules(answer) {
  const text = answer.toLowerCase();
  const result = {
    businessType: unknownField(),
    industry: unknownField(),
    category: unknownField()
  };

  const supplement = hasAny(text, ['supplement', 'vitamin', 'vitamins', 'capsule', 'capsules', 'turmeric', 'probiotic', 'probiotics']);
  const personalCare = hasAny(text, ['skincare', 'cream', 'shampoo', 'serum', 'moisturizer']);
  const software = hasAny(text, ['software', 'saas', 'app', 'platform', 'scheduler', 'scheduling', 'crm']);
  const digitalEducation = hasAny(text, ['course', 'online course', 'training', 'ebook', 'academy', 'workshop']);
  const physicalBook = hasAny(text, ['book']) && !hasAny(text, ['ebook']);
  const service = hasAny(text, ['consulting', 'coaching', 'contractor', 'plumbing', 'landscaping', 'detailing', 'accounting', 'legal service', 'agency']);

  if (software) {
    result.businessType = inferredField('software', 0.94);
    result.industry = inferredField('technology', 0.88);
  } else if (service) {
    result.businessType = inferredField('service', 0.93);
    if (hasAny(text, ['detailing'])) {
      result.industry = inferredField('automotive', 0.94);
      result.category = inferredField('auto_detailing', 0.96);
    } else if (hasAny(text, ['plumbing', 'landscaping', 'contractor'])) {
      result.industry = inferredField('home_services', 0.86);
    } else if (hasAny(text, ['accounting', 'legal service', 'consulting', 'agency'])) {
      result.industry = inferredField('professional_services', 0.82);
      if (hasAny(text, ['consulting'])) result.category = inferredField('consulting', 0.9);
    } else if (hasAny(text, ['coaching'])) {
      result.category = inferredField('coaching', 0.9);
    }
  } else if (digitalEducation) {
    result.businessType = inferredField('digital_product', 0.9);
    result.industry = inferredField('education', 0.9);
    if (hasAny(text, ['course', 'online course', 'training', 'academy', 'workshop'])) {
      result.category = inferredField('online_course', 0.86);
    } else if (hasAny(text, ['ebook'])) {
      result.category = inferredField('ebook', 0.94);
    }
  } else if (supplement || personalCare) {
    result.businessType = inferredField('physical_product', 0.95);
    result.industry = inferredField('health_wellness', supplement ? 0.93 : 0.84);
    result.category = supplement
      ? inferredField('dietary_supplement', 0.96)
      : inferredField('beauty_personal_care', 0.93);
  } else if (physicalBook) {
    result.businessType = inferredField('physical_product', 0.76);
    result.industry = inferredField('education', 0.72);
  }

  return result;
}

function audienceFromDescription(answer, objective) {
  if (objective === 'increase_conversion_rates') {
    const offerAudienceMatch = answer.match(
      /\b(?:service|product|software|offer|subscription|program|course|platform|page|funnel)\s+for\s+([^,.!?;]{2,80})/i
    );
    if (offerAudienceMatch) return offerAudienceMatch[1].trim();
  }

  const audienceMatch = answer.match(/\bfor\s+([^,.!?;]{2,80})/i);
  return audienceMatch ? removeSalesDistributionClause(audienceMatch[1]) : '';
}

function inferHighValueDetails(answer, objective) {
  const text = answer.toLowerCase();
  const details = {};

  if (hasAny(text, ['amazon'])) details.salesChannel = inferredField('amazon', 0.95);
  else if (hasAny(text, ['shopify', 'own website', 'my website'])) details.salesChannel = inferredField('own_website', 0.9);
  else if (hasAny(text, ['retail', 'stores'])) details.salesChannel = inferredField('retail', 0.82);

  const audience = audienceFromDescription(answer, objective);
  if (audience.length >= 2) {
    details.targetAudience = {
      value: audience,
      label: audience.charAt(0).toUpperCase() + audience.slice(1),
      confidence: 0.82,
      source: 'inference'
    };
  }

  return details;
}

function removeSalesDistributionClause(value) {
  const boundaries = [
    /\s+that\s+i\s+(?:plan|intend|want)\s+to\s+sell\b/i,
    /\s+(?:on|through|via)\s+(?:amazon|shopify|etsy|ebay|walmart|my\s+(?:own\s+)?website|an?\s+own\s+website|retail(?:\s+stores?)?)\b/i,
    /\s+sold\s+(?:on|through|via)\b/i,
    /\s+available\s+(?:on|through|via)\b/i,
    /\s+who\s+(?:will\s+)?(?:buy|purchase)\s+(?:it|this|the\s+product)\s+(?:on|through|from)\b/i
  ];
  let end = value.length;
  boundaries.forEach(function(boundary) {
    const match = boundary.exec(value);
    if (match && match.index < end) end = match.index;
  });
  return value.slice(0, end).trim();
}

function isSettled(field) {
  return Boolean(field && field.value !== null && field.value !== 'unsure'
    && (!Array.isArray(field.value) || field.value.length > 0) && (
    ['user_confirmed', 'remembered_confirmed'].includes(field.source) || field.confidence >= SETTLED_CONFIDENCE
  ));
}

function mergeUnderstanding(inferred, existingUnderstanding) {
  const merged = { ...inferred };
  Object.keys(existingUnderstanding || {}).forEach(function(key) {
    if (['user_confirmed', 'remembered_confirmed'].includes(existingUnderstanding[key]?.source)
      || isSettled(existingUnderstanding[key])
      || !isSettled(merged[key])) {
      merged[key] = existingUnderstanding[key];
    }
  });
  return merged;
}

function deriveSupplementLaunchStage(understanding) {
  if (understanding?.category?.value !== 'dietary_supplement') return understanding;
  if (understanding.launchStage?.source === 'user_confirmed' || isSettled(understanding.launchStage)) {
    return understanding;
  }

  const launchStageByMaturity = {
    idea_only: 'idea',
    direction_no_formula: 'idea',
    in_development: 'development'
  };
  const launchStage = launchStageByMaturity[understanding.conceptMaturity?.value];
  if (!launchStage || !isSettled(understanding.conceptMaturity)) return understanding;
  return {
    ...understanding,
    launchStage: inferredField(launchStage, 0.9)
  };
}

async function understandBusiness({ objective, answer, existingUnderstanding = {}, generatorApi, providerRuntime, signal, env } = {}) {
  const normalizedAnswer = typeof answer === 'string' ? answer.trim() : '';
  const classified = classifyWithRules(normalizedAnswer);
  const deterministic = { ...classified, ...inferHighValueDetails(normalizedAnswer, objective) };
  const interpretation = await interpretDiscovery({
    objective,
    answer: normalizedAnswer,
    generatorApi,
    providerRuntime,
    signal,
    env
  });
  const aiFields = {};
  if (interpretation.mode === 'ai_assisted') {
    Object.entries(interpretation.fields || {}).forEach(function([field, value]) {
      if (!isSettled(deterministic[field])) aiFields[field] = aiInferredField(value);
    });
  }
  const inferred = { ...deterministic, ...aiFields };
  const understanding = deriveSupplementLaunchStage(
    mergeUnderstanding(inferred, existingUnderstanding)
  );

  const unknowns = UNDERSTANDING_FIELDS.filter(function(field) {
    return !isSettled(understanding[field]);
  });

  return {
    understanding,
    unknowns,
    interpretation: {
      mode: interpretation.mode,
      provider: interpretation.provider || null,
      model: interpretation.model || null,
      reason: interpretation.reason || null,
      uncertaintyNotes: interpretation.uncertaintyNotes || [],
      suggestedQuestions: interpretation.suggestedQuestions || []
    }
  };
}

module.exports = {
  SETTLED_CONFIDENCE,
  understandBusiness
};
