const SETTLED_CONFIDENCE = 0.7;

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
  ebook: 'eBook'
};

const UNDERSTANDING_FIELDS = [
  'businessType',
  'industry',
  'category',
  'targetAudience',
  'customerMotivation',
  'salesChannel',
  'competitiveDifferentiation',
  'launchStage',
  'brand',
  'budget',
  'timeline'
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

function inferHighValueDetails(answer) {
  const text = answer.toLowerCase();
  const details = {};

  if (hasAny(text, ['amazon'])) details.salesChannel = inferredField('amazon', 0.95);
  else if (hasAny(text, ['shopify', 'own website', 'my website'])) details.salesChannel = inferredField('own_website', 0.9);
  else if (hasAny(text, ['retail', 'stores'])) details.salesChannel = inferredField('retail', 0.82);

  const audienceMatch = answer.match(/\bfor\s+([^,.!?;]{2,80})/i);
  if (audienceMatch) {
    const audience = audienceMatch[1].trim();
    details.targetAudience = {
      value: audience,
      label: audience.charAt(0).toUpperCase() + audience.slice(1),
      confidence: 0.82,
      source: 'inference'
    };
  }

  return details;
}

function isSettled(field) {
  return Boolean(field && field.value !== null && field.value !== 'unsure' && (
    field.source === 'user_confirmed' || field.confidence >= SETTLED_CONFIDENCE
  ));
}

function mergeUnderstanding(inferred, existingUnderstanding) {
  const merged = { ...inferred };
  Object.keys(existingUnderstanding || {}).forEach(function(key) {
    if (existingUnderstanding[key]?.source === 'user_confirmed'
      || isSettled(existingUnderstanding[key])
      || !isSettled(merged[key])) {
      merged[key] = existingUnderstanding[key];
    }
  });
  return merged;
}

async function understandBusiness({ objective, answer, existingUnderstanding = {} }) {
  const normalizedAnswer = typeof answer === 'string' ? answer.trim() : '';
  const classified = classifyWithRules(normalizedAnswer);
  const inferred = { ...classified, ...inferHighValueDetails(normalizedAnswer) };
  const understanding = mergeUnderstanding(inferred, existingUnderstanding);

  const unknowns = UNDERSTANDING_FIELDS.filter(function(field) {
    return !isSettled(understanding[field]);
  });

  return {
    understanding,
    unknowns
  };
}

module.exports = {
  SETTLED_CONFIDENCE,
  understandBusiness
};
