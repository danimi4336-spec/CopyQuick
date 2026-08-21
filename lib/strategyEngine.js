const SECTION_KEYS = [
  'marketPosition',
  'primaryCustomer',
  'customerMotivation',
  'competitiveApproach',
  'pricingPosition',
  'primarySalesChannel',
  'communicationStyle',
  'marketingFocus',
  'launchApproach',
  'risks'
];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function field(understanding, key) {
  return understanding?.[key] || null;
}

function fieldValue(understanding, key) {
  return normalize(field(understanding, key)?.value);
}

function fieldLabel(understanding, key) {
  const item = field(understanding, key);
  if (!item || item.value === null || item.value === 'unsure' || item.source === 'unknown') return null;
  return item.label || String(item.value);
}

function confidenceLabel(numericConfidence) {
  if (numericConfidence >= 0.85) return 'High Confidence';
  if (numericConfidence >= 0.65) return 'Moderate Confidence';
  return 'Needs Confirmation';
}

function section(value, numericConfidence, explanation) {
  return {
    value: value || 'Unknown',
    confidence: value ? confidenceLabel(numericConfidence) : 'Needs Confirmation',
    explanation
  };
}

function includesAny(text, signals) {
  return signals.some(function(signal) { return text.includes(signal); });
}

function buildStrategy({ objective, understanding = {}, answers = {}, confirmedUnderstanding = {} }) {
  if (objective !== 'launch_product') {
    throw new Error(`Unsupported strategy objective: ${objective || 'missing'}`);
  }

  const facts = { ...understanding, ...confirmedUnderstanding };
  const description = normalize(answers.initial_description);
  const businessType = fieldValue(facts, 'businessType');
  const industry = fieldValue(facts, 'industry');
  const category = fieldValue(facts, 'category');
  const salesChannel = fieldValue(facts, 'salesChannel');
  const launchStage = fieldValue(facts, 'launchStage');
  const differentiation = fieldValue(facts, 'competitiveDifferentiation');
  const motivation = fieldValue(facts, 'customerMotivation');
  const targetCustomer = fieldLabel(facts, 'targetAudience');
  const channelLabel = fieldLabel(facts, 'salesChannel');
  const isSupplement = category === 'dietary_supplement'
    || includesAny(description, ['supplement', 'turmeric', 'vitamin', 'probiotic']);
  const isArtisan = includesAny(description, ['artisan', 'handcrafted', 'handmade', 'candle']);
  const isLocalService = businessType === 'service'
    && (includesAny(description, ['local', 'plumbing', 'landscaping', 'detailing'])
      || ['home_services', 'automotive'].includes(industry));
  const isSoftware = businessType === 'software';

  let marketPosition;
  if (isSupplement) {
    marketPosition = section('Premium Natural Wellness', 0.82, 'Natural wellness products benefit from a credible position that combines quality, trust, and perceived efficacy.');
  } else if (isArtisan && businessType === 'physical_product') {
    marketPosition = section('Handcrafted Lifestyle Brand', 0.88, 'The handcrafted nature supports a personal, design-led position rather than a commodity comparison.');
  } else if (isLocalService) {
    marketPosition = section('Reliable Local Expert', 0.9, 'Local service customers typically prioritize trust, responsiveness, and dependable delivery.');
  } else if (isSoftware) {
    marketPosition = section('Focused Productivity Software', 0.8, 'Software that improves scheduling or workflow is strongest when positioned around a clear operational outcome.');
  } else {
    marketPosition = section(null, 0, 'A reliable market position needs clearer category, customer, or value information.');
  }

  const primaryCustomer = targetCustomer
    ? section(targetCustomer, field(facts, 'targetAudience')?.confidence || 0.75, 'This customer group comes directly from the confirmed business understanding.')
    : section(null, 0, 'The primary customer has not been established clearly enough to guide strategy.');

  const motivationLabels = {
    solve_problem: 'Solve a Clear Problem',
    fulfill_desire: 'Fulfill a Desire or Aspiration',
    convenience: 'Save Time and Reduce Effort',
    identity_experience: 'Identity, Enjoyment, and Experience'
  };
  const customerMotivation = motivation
    ? section(motivationLabels[motivation] || fieldLabel(facts, 'customerMotivation'), 0.9, 'This motivation reflects what the entrepreneur confirmed customers value most.')
    : section(null, 0, 'Customer motivation needs confirmation before it can anchor positioning and messaging.');

  let competitiveApproach;
  if (isSupplement) {
    competitiveApproach = section('Trust, Quality, and Proof', 0.85, 'Supplement buyers often look for ingredient credibility, quality signals, and reassuring customer evidence.');
  } else if (isLocalService) {
    competitiveApproach = section('Reliability, Responsiveness, and Reviews', 0.9, 'Local services win when customers can quickly verify trust and expect a dependable response.');
  } else if (isSoftware) {
    competitiveApproach = section('Demonstrated Utility and Low-Friction Adoption', 0.82, 'Software differentiation is easier to understand through visible workflows, proof, and an easy path to try the product.');
  } else if (differentiation === 'clear') {
    competitiveApproach = section('Lead With Meaningful Product Advantages', 0.86, 'The entrepreneur confirmed clear differences that should be made central to the market story.');
  } else if (differentiation === 'similar') {
    competitiveApproach = section('Win Through Positioning and Execution', 0.8, 'When the product is similar to alternatives, customer focus, experience, and execution become the practical advantage.');
  } else {
    competitiveApproach = section(null, 0, 'Competitive strategy needs clearer differentiation or category context.');
  }

  const pricingSignal = includesAny(description, ['premium', 'luxury', 'artisan', 'handcrafted']);
  const pricingPosition = pricingSignal
    ? section('Premium', 0.75, 'The product description signals craftsmanship or premium value, but the final price still needs market validation.')
    : section(null, 0, 'No dependable product-pricing position was provided; launch budget is not a substitute for customer price strategy.');

  const primarySalesChannel = channelLabel
    ? section(channelLabel, field(facts, 'salesChannel')?.confidence || 0.8, 'This channel was confirmed during discovery and should shape launch execution.')
    : section(null, 0, 'A primary sales channel must be confirmed before channel-specific execution can be recommended.');

  let communicationStyle;
  if (isSupplement) communicationStyle = section('Evidence-Based and Reassuring', 0.9, 'Health supplement buyers often seek credibility and trust before purchase.');
  else if (isArtisan) communicationStyle = section('Warm, Personal, and Lifestyle-Led', 0.88, 'Handcrafted products benefit from human stories, sensory language, and lifestyle context.');
  else if (isLocalService) communicationStyle = section('Direct, Trustworthy, and Responsive', 0.92, 'Local service communication should reduce risk and make the next action feel immediate and dependable.');
  else if (isSoftware) communicationStyle = section('Professional, Clear, and Demonstration-Led', 0.9, 'Software buyers need to understand the workflow improvement quickly and see the product in action.');
  else communicationStyle = section(null, 0, 'Communication style needs stronger business-type or category signals.');

  let marketingFocus;
  if (isSupplement && salesChannel === 'amazon') marketingFocus = section('Marketplace Education, Trust Signals, and Reviews', 0.92, 'Amazon discovery and conversion depend heavily on clear product education, listing credibility, and review momentum.');
  else if (isSupplement) marketingFocus = section('Education, Credibility, and Customer Proof', 0.86, 'Wellness products need confidence-building information before promotional pressure.');
  else if (isArtisan && salesChannel === 'own_website') marketingFocus = section('Storytelling, Email, and Community', 0.9, 'An owned storefront gives a handcrafted brand room to build affinity through story and direct relationships.');
  else if (isLocalService) marketingFocus = section('Local Visibility, Reviews, and Fast Response', 0.92, 'Local intent is captured through findability, proof, and an easy route to contact or booking.');
  else if (isSoftware) marketingFocus = section('Product Demonstrations, Case Studies, and Trial Conversion', 0.88, 'Software adoption improves when prospects can see the workflow, verify outcomes, and experience value with low friction.');
  else if (salesChannel === 'amazon') marketingFocus = section('Marketplace Discoverability and Conversion Proof', 0.82, 'Amazon requires focused listing relevance, product clarity, and customer proof.');
  else if (salesChannel === 'own_website') marketingFocus = section('Owned Audience, Content, and Email', 0.8, 'An owned website benefits from demand creation and direct customer relationships.');
  else marketingFocus = section(null, 0, 'Marketing focus depends on clearer channel and business-model information.');

  let launchApproach;
  if (isSupplement) launchApproach = section('Education Before Promotion', 0.87, 'Build credibility around ingredients, use, and expected value before asking customers to buy.');
  else if (isSoftware) launchApproach = section('Demonstration and Guided Trial', 0.86, 'A product demonstration and low-friction trial help software prospects experience the operational value.');
  else if (launchStage === 'idea') launchApproach = section('Validate Demand Before Scaling', 0.9, 'At idea stage, customer evidence should come before significant launch investment.');
  else if (launchStage === 'development') launchApproach = section('Build Proof and Audience Before Release', 0.85, 'Development time can also establish early demand, feedback, and launch readiness.');
  else if (launchStage === 'ready') launchApproach = section('Coordinated Focused Launch', 0.88, 'A launch-ready product benefits from concentrated messaging and channel execution.');
  else if (launchStage === 'selling') launchApproach = section('Optimize Proven Signals', 0.85, 'Existing customer behavior should guide improvements before expanding activity.');
  else launchApproach = section(null, 0, 'The launch stage must be known before sequencing a responsible approach.');

  const riskItems = [];
  if (isSupplement) riskItems.push('Credibility, claims, and customer trust require careful handling.');
  if (salesChannel === 'amazon') riskItems.push('Marketplace competition and early review momentum may affect visibility and conversion.');
  if (!pricingSignal) riskItems.push('The customer-facing pricing position is not yet defined.');
  if (!differentiation || differentiation === 'unsure') riskItems.push('Competitive differentiation needs clarification before launch.');
  if (differentiation === 'similar') riskItems.push('Similarity to existing products increases dependence on positioning and execution.');
  const risks = riskItems.length
    ? section(riskItems, 0.82, 'These risks follow directly from the current business model, channel, and unresolved strategy inputs.')
    : section(null, 0, 'There is not enough confirmed information to identify responsible strategic risks.');

  const strategy = {
    marketPosition,
    primaryCustomer,
    customerMotivation,
    competitiveApproach,
    pricingPosition,
    primarySalesChannel,
    communicationStyle,
    marketingFocus,
    launchApproach,
    risks
  };

  const reasoning = SECTION_KEYS.map(function(key) {
    return { section: key, reason: strategy[key].explanation };
  });

  const assumptions = [];
  if (isSupplement && (!targetCustomer || normalize(targetCustomer).includes('consumer'))) {
    assumptions.push('Assuming this product is intended primarily for health-conscious adults.');
  }
  if (channelLabel) assumptions.push(`Assuming ${channelLabel} remains the primary sales channel for launch.`);
  if (launchStage) assumptions.push(`Assuming the confirmed ${fieldLabel(facts, 'launchStage') || launchStage} launch stage remains current.`);

  const recommendations = [];
  if (!differentiation || differentiation === 'unsure' || differentiation === 'similar') {
    recommendations.push({
      recommendation: isSupplement ? 'Clarify a credible ingredient or formulation advantage before launch.' : 'Clarify the strongest positioning advantage before launch.',
      reason: 'Clear differentiation or positioning improves customer understanding and conversion.'
    });
  }
  if (!pricingSignal) {
    recommendations.push({
      recommendation: 'Validate the customer-facing pricing position.',
      reason: 'Pricing should reflect customer value, alternatives, and channel economics rather than internal budget alone.'
    });
  }
  if (salesChannel === 'amazon') {
    recommendations.push({
      recommendation: 'Prepare a deliberate early-review and marketplace-proof strategy.',
      reason: 'Customer proof materially affects trust and conversion in marketplace launches.'
    });
  }

  const knownSections = Object.values(strategy).filter(function(item) { return item.value !== 'Unknown'; }).length;
  return {
    strategy,
    reasoning,
    confidence: knownSections >= 8 ? 'High Confidence' : knownSections >= 5 ? 'Moderate Confidence' : 'Needs Confirmation',
    assumptions,
    recommendations
  };
}

module.exports = {
  buildStrategy
};
