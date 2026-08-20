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

const QUESTIONS = [
  {
    id: 'business_type',
    understandingField: 'businessType',
    type: 'single_choice',
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
  {
    id: 'sales_channel',
    understandingField: 'salesChannel',
    type: 'single_choice',
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
  {
    id: 'target_audience',
    understandingField: 'targetAudience',
    type: 'single_choice',
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
  {
    id: 'customer_motivation',
    understandingField: 'customerMotivation',
    type: 'single_choice',
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
  {
    id: 'competitive_differentiation',
    understandingField: 'competitiveDifferentiation',
    type: 'single_choice',
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
  {
    id: 'launch_stage',
    understandingField: 'launchStage',
    type: 'single_choice',
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
  }
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

function isAnswered(field) {
  return Boolean(field && field.source === 'user_confirmed');
}

function mergeUnderstanding(inferred, existingUnderstanding) {
  const merged = { ...inferred };
  Object.keys(existingUnderstanding || {}).forEach(function(key) {
    if (isSettled(existingUnderstanding[key]) || !isSettled(merged[key])) {
      merged[key] = existingUnderstanding[key];
    }
  });
  return merged;
}

function cloneQuestion(question) {
  return question ? {
    ...question,
    options: question.options.map(function(option) { return { ...option }; })
  } : null;
}

async function understandBusiness({ objective, answer, existingUnderstanding = {} }) {
  const normalizedAnswer = typeof answer === 'string' ? answer.trim() : '';
  const classified = classifyWithRules(normalizedAnswer);
  const inferred = { ...classified, ...inferHighValueDetails(normalizedAnswer) };
  const understanding = mergeUnderstanding(inferred, existingUnderstanding);

  const classificationFields = ['businessType', 'industry', 'category'];
  const highValueFields = QUESTIONS.map(function(question) { return question.understandingField; });
  const unknowns = Array.from(new Set(classificationFields.concat(highValueFields))).filter(function(field) {
    return !isSettled(understanding[field]);
  });
  const nextQuestion = QUESTIONS.find(function(question) {
    return unknowns.includes(question.understandingField)
      && !isAnswered(understanding[question.understandingField]);
  }) || null;

  return {
    understanding,
    unknowns,
    nextQuestion: cloneQuestion(nextQuestion)
  };
}

module.exports = {
  SETTLED_CONFIDENCE,
  understandBusiness
};
