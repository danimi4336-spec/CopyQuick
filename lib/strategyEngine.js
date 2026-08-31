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
const STRATEGY_POLICY_VERSION = 2;

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

function section(value, numericConfidence, explanation, metadata = {}) {
  return {
    value: value || 'Unknown',
    confidence: value ? confidenceLabel(numericConfidence) : 'Needs Confirmation',
    explanation,
    semanticRole: value ? (metadata.semanticRole || 'strategic_recommendation') : 'unresolved',
    ...(metadata.sourceFields?.length ? { sourceFields: metadata.sourceFields } : {})
  };
}

function factRole(item) {
  return item?.source === 'user_confirmed' ? 'confirmed_fact' : 'inferred_fact';
}

function provenanceExplanation(item, confirmedText, inferredText) {
  return item?.source === 'user_confirmed' ? confirmedText : inferredText;
}

function isBroadAudience(value) {
  return new Set(['adults', 'consumers', 'individual consumers', 'everyone', 'businesses', 'small businesses'])
    .has(normalize(value));
}

function wellnessDirectionLabel(intendedOutcome, naturalSignal) {
  const normalized = normalize(intendedOutcome);
  const directions = {
    'digestive health': 'Digestive Wellness',
    'digestive wellness': 'Digestive Wellness',
    'everyday wellness': 'Everyday Wellness',
    'general health & everyday wellness': 'Everyday Wellness',
    'energy & focus': 'Energy & Focus',
    'sleep & relaxation': 'Sleep & Relaxation'
  };
  const direction = directions[normalized] || String(intendedOutcome).replace(/\b\w/g, function(char) { return char.toUpperCase(); });
  return `${naturalSignal ? 'Natural ' : ''}${direction} Direction`;
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
  const conceptMaturity = fieldValue(facts, 'conceptMaturity');
  const differentiation = fieldValue(facts, 'competitiveDifferentiation');
  const motivation = fieldValue(facts, 'customerMotivation');
  const intendedOutcome = fieldLabel(facts, 'intendedOutcome');
  const targetCustomer = fieldLabel(facts, 'targetAudience');
  const channelLabel = fieldLabel(facts, 'salesChannel');
  const explicitMarketPosition = fieldLabel(facts, 'marketPosition');
  const explicitPricingPosition = fieldLabel(facts, 'pricingPosition');
  const isSupplement = category === 'dietary_supplement'
    || includesAny(description, ['supplement', 'turmeric', 'vitamin', 'probiotic']);
  const isArtisan = includesAny(description, ['artisan', 'handcrafted', 'handmade', 'candle']);
  const isLocalService = businessType === 'service'
    && (includesAny(description, ['local', 'plumbing', 'landscaping', 'detailing'])
      || ['home_services', 'automotive'].includes(industry));
  const isSoftware = businessType === 'software';
  const explorationIntent = field(facts, 'productExplorationDirections');
  const explorationLabels = explorationIntent?.semanticRole === 'exploration_intent'
    && Array.isArray(explorationIntent.value)
    ? (Array.isArray(explorationIntent.labels) ? explorationIntent.labels : [])
    : [];
  const digestiveIdeaStage = isSupplement
    && fieldValue(facts, 'intendedOutcome') === 'digestive_wellness'
    && conceptMaturity === 'idea_only';

  let marketPosition;
  if (explicitMarketPosition) {
    const item = field(facts, 'marketPosition');
    marketPosition = section(explicitMarketPosition, item?.confidence || 0.9,
      provenanceExplanation(item, 'This market position was explicitly established by the builder.', 'CopyQuick inferred this market position from the established business context.'),
      { semanticRole: factRole(item), sourceFields: ['marketPosition'] });
  } else if (isSupplement && intendedOutcome && includesAny(description, ['natural', 'herbal'])) {
    marketPosition = section(
      wellnessDirectionLabel(intendedOutcome, true),
      0.78,
      'The natural/herbal product context and intended wellness direction are established, but premium, value, and competitive positioning have not yet been defined.',
      { semanticRole: 'strategic_recommendation', sourceFields: ['initial_description', 'intendedOutcome'] }
    );
  } else if (isSupplement && intendedOutcome) {
    marketPosition = section(wellnessDirectionLabel(intendedOutcome, false), 0.74,
      'This is a recommended working direction based on the confirmed product purpose; value and competitive positioning still need definition.',
      { semanticRole: 'strategic_recommendation', sourceFields: ['intendedOutcome'] });
  } else if (isArtisan && businessType === 'physical_product') {
    marketPosition = section('Handcrafted Lifestyle Brand', 0.88, 'The handcrafted nature supports a personal, design-led position rather than a commodity comparison.', { semanticRole: 'strategic_recommendation', sourceFields: ['initial_description', 'businessType'] });
  } else if (isLocalService) {
    marketPosition = section('Reliable Local Expert', 0.9, 'Local service customers typically prioritize trust, responsiveness, and dependable delivery.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType', 'industry'] });
  } else if (isSoftware) {
    marketPosition = section('Focused Productivity Software', 0.8, 'Software that improves scheduling or workflow is strongest when positioned around a clear operational outcome.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType', 'initial_description'] });
  } else {
    marketPosition = section(null, 0, 'A reliable market position needs clearer category, customer, or value information.');
  }

  const primaryCustomer = targetCustomer
    ? section(targetCustomer, field(facts, 'targetAudience')?.confidence || 0.75,
      provenanceExplanation(field(facts, 'targetAudience'), 'The builder explicitly established this primary customer.', 'CopyQuick inferred this primary customer from the product description.'),
      { semanticRole: factRole(field(facts, 'targetAudience')), sourceFields: ['targetAudience'] })
    : section(null, 0, 'The primary customer has not been established clearly enough to guide strategy.');

  const motivationLabels = {
    solve_problem: 'Solve a Clear Problem',
    fulfill_desire: 'Fulfill a Desire or Aspiration',
    convenience: 'Save Time and Reduce Effort',
    identity_experience: 'Identity, Enjoyment, and Experience'
  };
  const customerMotivation = intendedOutcome
    ? section(intendedOutcome, field(facts, 'intendedOutcome')?.confidence || 0.9, 'This intended outcome is the product direction the entrepreneur confirmed; it is not a scientific efficacy claim.', { semanticRole: factRole(field(facts, 'intendedOutcome')), sourceFields: ['intendedOutcome'] })
    : motivation
      ? section(motivationLabels[motivation] || fieldLabel(facts, 'customerMotivation'), field(facts, 'customerMotivation')?.confidence || 0.9,
        provenanceExplanation(field(facts, 'customerMotivation'), 'This motivation reflects what the builder confirmed customers value most.', 'CopyQuick inferred this motivation from the established business context.'),
        { semanticRole: factRole(field(facts, 'customerMotivation')), sourceFields: ['customerMotivation'] })
    : section(null, 0, 'Customer motivation needs confirmation before it can anchor positioning and messaging.');

  let competitiveApproach;
  if (isSupplement) {
    competitiveApproach = section('Trust, Quality, and Proof', 0.85, 'This is a recommended credibility approach; actual proof and differentiation still need to be established.', { semanticRole: 'strategic_recommendation', sourceFields: ['category'] });
  } else if (isLocalService) {
    competitiveApproach = section('Reliability, Responsiveness, and Reviews', 0.9, 'Local services win when customers can quickly verify trust and expect a dependable response.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType', 'industry'] });
  } else if (isSoftware) {
    competitiveApproach = section('Demonstrated Utility and Low-Friction Adoption', 0.82, 'Software differentiation is easier to understand through visible workflows, proof, and an easy path to try the product.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType'] });
  } else if (differentiation === 'clear') {
    competitiveApproach = section('Lead With Meaningful Product Advantages', 0.86, 'The entrepreneur confirmed clear differences that should be made central to the market story.', { semanticRole: 'strategic_recommendation', sourceFields: ['competitiveDifferentiation'] });
  } else if (differentiation === 'similar') {
    competitiveApproach = section('Win Through Positioning and Execution', 0.8, 'When the product is similar to alternatives, customer focus, experience, and execution become the practical advantage.', { semanticRole: 'strategic_recommendation', sourceFields: ['competitiveDifferentiation'] });
  } else {
    competitiveApproach = section(null, 0, 'Competitive strategy needs clearer differentiation or category context.');
  }

  const pricingSignal = includesAny(description, ['premium', 'luxury', 'artisan', 'handcrafted']);
  const hasPricingPosition = Boolean(explicitPricingPosition || pricingSignal);
  const pricingPosition = explicitPricingPosition
    ? section(explicitPricingPosition, field(facts, 'pricingPosition')?.confidence || 0.9,
      provenanceExplanation(field(facts, 'pricingPosition'), 'The builder explicitly established this pricing position.', 'CopyQuick inferred this pricing position from the established business context.'),
      { semanticRole: factRole(field(facts, 'pricingPosition')), sourceFields: ['pricingPosition'] })
    : pricingSignal
    ? section('Premium', 0.75, 'The product description explicitly signals premium value, but the final price still needs market validation.', { semanticRole: 'inferred_fact', sourceFields: ['initial_description'] })
    : section(null, 0, 'No dependable product-pricing position was provided; launch budget is not a substitute for customer price strategy.');

  const primarySalesChannel = channelLabel
    ? section(channelLabel, field(facts, 'salesChannel')?.confidence || 0.8,
      provenanceExplanation(field(facts, 'salesChannel'), 'The builder explicitly confirmed this sales channel.', 'CopyQuick inferred this sales channel from the product description.'),
      { semanticRole: factRole(field(facts, 'salesChannel')), sourceFields: ['salesChannel'] })
    : section(null, 0, 'A primary sales channel must be confirmed before channel-specific execution can be recommended.');

  let communicationStyle;
  if (isSupplement) communicationStyle = section('Evidence-Based and Reassuring', 0.9, 'This recommended communication style supports credibility without implying that evidence already exists.', { semanticRole: 'strategic_recommendation', sourceFields: ['category'] });
  else if (isArtisan) communicationStyle = section('Warm, Personal, and Lifestyle-Led', 0.88, 'Handcrafted products benefit from human stories, sensory language, and lifestyle context.', { semanticRole: 'strategic_recommendation', sourceFields: ['initial_description'] });
  else if (isLocalService) communicationStyle = section('Direct, Trustworthy, and Responsive', 0.92, 'Local service communication should reduce risk and make the next action feel immediate and dependable.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType', 'industry'] });
  else if (isSoftware) communicationStyle = section('Professional, Clear, and Demonstration-Led', 0.9, 'Software buyers need to understand the workflow improvement quickly and see the product in action.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType'] });
  else communicationStyle = section(null, 0, 'Communication style needs stronger business-type or category signals.');

  let marketingFocus;
  if (isSupplement && salesChannel === 'amazon') marketingFocus = section('Marketplace Education, Trust Signals, and Reviews', 0.92, 'Amazon discovery and conversion benefit from clear product education, listing credibility, and review momentum.', { semanticRole: 'strategic_recommendation', sourceFields: ['category', 'salesChannel'] });
  else if (isSupplement) marketingFocus = section('Education, Credibility, and Customer Proof', 0.86, 'Wellness products need confidence-building information before promotional pressure.', { semanticRole: 'strategic_recommendation', sourceFields: ['category'] });
  else if (isArtisan && salesChannel === 'own_website') marketingFocus = section('Storytelling, Email, and Community', 0.9, 'An owned storefront gives a handcrafted brand room to build affinity through story and direct relationships.', { semanticRole: 'strategic_recommendation', sourceFields: ['initial_description', 'salesChannel'] });
  else if (isLocalService) marketingFocus = section('Local Visibility, Reviews, and Fast Response', 0.92, 'Local intent is captured through findability, proof, and an easy route to contact or booking.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType', 'industry'] });
  else if (isSoftware) marketingFocus = section('Product Demonstrations, Case Studies, and Trial Conversion', 0.88, 'Software adoption improves when prospects can see the workflow, verify outcomes, and experience value with low friction.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType'] });
  else if (salesChannel === 'amazon') marketingFocus = section('Marketplace Discoverability and Conversion Proof', 0.82, 'Amazon requires focused listing relevance, product clarity, and customer proof.', { semanticRole: 'strategic_recommendation', sourceFields: ['salesChannel'] });
  else if (salesChannel === 'own_website') marketingFocus = section('Owned Audience, Content, and Email', 0.8, 'An owned website benefits from demand creation and direct customer relationships.', { semanticRole: 'strategic_recommendation', sourceFields: ['salesChannel'] });
  else marketingFocus = section(null, 0, 'Marketing focus depends on clearer channel and business-model information.');

  let launchApproach;
  if (isSupplement && launchStage === 'idea') launchApproach = section('Validate Demand Before Scaling', 0.9, 'At idea stage, customer evidence should come before significant launch investment.', { semanticRole: 'strategic_recommendation', sourceFields: ['launchStage'] });
  else if (isSupplement && launchStage === 'development') launchApproach = section('Build Proof and Audience Before Release', 0.85, 'Development time can also establish early demand, feedback, and launch readiness.', { semanticRole: 'strategic_recommendation', sourceFields: ['launchStage'] });
  else if (isSupplement) launchApproach = section('Education Before Promotion', 0.87, 'Explain the confirmed product purpose carefully and establish substantiated evidence before making any product claim or asking customers to buy.', { semanticRole: 'strategic_recommendation', sourceFields: ['category', 'launchStage'] });
  else if (isSoftware) launchApproach = section('Demonstration and Guided Trial', 0.86, 'A product demonstration and low-friction trial help software prospects experience the operational value.', { semanticRole: 'strategic_recommendation', sourceFields: ['businessType'] });
  else if (launchStage === 'idea') launchApproach = section('Validate Demand Before Scaling', 0.9, 'At idea stage, customer evidence should come before significant launch investment.', { semanticRole: 'strategic_recommendation', sourceFields: ['launchStage'] });
  else if (launchStage === 'development') launchApproach = section('Build Proof and Audience Before Release', 0.85, 'Development time can also establish early demand, feedback, and launch readiness.', { semanticRole: 'strategic_recommendation', sourceFields: ['launchStage'] });
  else if (launchStage === 'ready') launchApproach = section('Coordinated Focused Launch', 0.88, 'A launch-ready product benefits from concentrated messaging and channel execution.', { semanticRole: 'strategic_recommendation', sourceFields: ['launchStage'] });
  else if (launchStage === 'selling') launchApproach = section('Optimize Proven Signals', 0.85, 'Existing customer behavior should guide improvements before expanding activity.', { semanticRole: 'strategic_recommendation', sourceFields: ['launchStage'] });
  else launchApproach = section(null, 0, 'The launch stage must be known before sequencing a responsible approach.');

  const riskItems = [];
  if (isSupplement) riskItems.push('No substantiated product claims have been established in discovery; credibility, evidence, and customer trust require careful handling.');
  if (salesChannel === 'amazon') riskItems.push('Marketplace competition and early review momentum may affect visibility and conversion.');
  if (!hasPricingPosition) riskItems.push('The customer-facing pricing position is not yet defined.');
  if (!differentiation || differentiation === 'unsure') riskItems.push('Competitive differentiation needs clarification before launch.');
  if (differentiation === 'similar') riskItems.push('Similarity to existing products increases dependence on positioning and execution.');
  const risks = riskItems.length
    ? section(riskItems, 0.82, 'These risks follow directly from the current business model, channel, and unresolved strategy inputs.', { semanticRole: 'derived_risk', sourceFields: ['category', 'salesChannel', 'pricingPosition', 'competitiveDifferentiation'] })
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
  if (isSupplement) assumptions.push('No ingredients, formulation details, scientific efficacy, or substantiated health claims are assumed.');
  if (explorationIntent?.semanticRole === 'exploration_intent') {
    assumptions.push('Product exploration selections are directions to investigate, not confirmed formulation details, ingredients, efficacy, or product claims.');
  }
  if (channelLabel) assumptions.push(`Assuming ${channelLabel} remains the primary sales channel for launch.`);
  if (launchStage) assumptions.push(`Assuming the confirmed ${fieldLabel(facts, 'launchStage') || launchStage} launch stage remains current.`);

  const recommendations = [];
  if (digestiveIdeaStage && explorationLabels.length) {
    recommendations.push({
      recommendation: `Explore a digestive-wellness concept focused on ${explorationLabels.join(', ')}.`,
      reason: 'These are the directions the builder selected for exploration; validate customer relevance and credible product development before treating them as product facts.'
    });
  } else if (digestiveIdeaStage) {
    recommendations.push({
      recommendation: 'Define the digestive product direction before developing positioning or execution assets.',
      reason: 'The builder has not selected a product focus yet, so the next step is guided concept exploration rather than assumed formulation or claims.'
    });
  }
  if (!differentiation || differentiation === 'unsure' || differentiation === 'similar') {
    recommendations.push({
      recommendation: digestiveIdeaStage
        ? 'Develop and validate differentiation after the product direction is better defined.'
        : isSupplement ? 'Clarify a credible ingredient or formulation advantage before launch.' : 'Clarify the strongest positioning advantage before launch.',
      reason: 'Clear differentiation or positioning improves customer understanding and conversion.'
    });
  }
  if (targetCustomer && isBroadAudience(targetCustomer)) {
    recommendations.push({
      recommendation: 'Further segment the primary customer before finalizing positioning and launch execution.',
      reason: 'The current audience is valid but broad; greater specificity could improve positioning and conversion without changing the audience already established.'
    });
  }
  if (!hasPricingPosition) {
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

  const hasEssentialUnderstanding = Boolean(targetCustomer && (intendedOutcome || motivation) && launchStage);
  const hasOpenDecisions = Object.values(strategy).some(function(item) { return item.semanticRole === 'unresolved'; })
    || !differentiation || differentiation === 'unsure'
    || isBroadAudience(targetCustomer)
    || explorationIntent?.semanticRole === 'exploration_intent';
  const status = !hasEssentialUnderstanding
    ? 'More Understanding Needed'
    : hasOpenDecisions ? 'Strategy Ready — Open Decisions' : 'Strategy Ready';
  return {
    policyVersion: STRATEGY_POLICY_VERSION,
    strategy,
    reasoning,
    status,
    confidence: status,
    assumptions,
    recommendations
  };
}

module.exports = {
  STRATEGY_POLICY_VERSION,
  buildStrategy
};
