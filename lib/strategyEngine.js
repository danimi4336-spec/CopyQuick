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
const STRATEGY_POLICY_VERSION = 4;

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

function buildCustomerAcquisitionStrategy(understanding, answers, confirmedUnderstanding) {
  const facts = { ...understanding, ...confirmedUnderstanding };
  const customer = fieldLabel(facts, 'targetAudience');
  const goal = fieldLabel(facts, 'acquisitionGoal');
  const currentChannel = fieldLabel(facts, 'currentAcquisitionChannel');
  const stage = fieldLabel(facts, 'acquisitionStage');
  const salesProcess = fieldLabel(facts, 'salesProcess');
  const capacity = fieldValue(facts, 'capacityReadiness');
  const offer = String(answers.initial_description || '').trim();
  const goalField = field(facts, 'acquisitionGoal');
  const customerField = field(facts, 'targetAudience');
  const channelField = field(facts, 'currentAcquisitionChannel');
  const strategy = {
    marketPosition: section('Customer-Acquisition Focus', 0.86, 'The strategy is organized around winning the defined priority customer for the existing offer.', { sourceFields: ['initial_description', 'targetAudience'] }),
    primaryCustomer: customer ? section(customer, customerField?.confidence || 0.9, provenanceExplanation(customerField, 'The builder explicitly established this priority customer.', 'CopyQuick inferred this customer from the business description.'), { semanticRole: factRole(customerField), sourceFields: ['targetAudience'] }) : section(null, 0, 'A priority customer is required.'),
    customerMotivation: goal ? section(goal, goalField?.confidence || 0.9, 'This is the customer-growth result the builder selected for this plan.', { semanticRole: factRole(goalField), sourceFields: ['acquisitionGoal'] }) : section(null, 0, 'A growth goal is required.'),
    competitiveApproach: section('Lead with relevance and evidence', 0.8, 'Acquisition messages should connect the offer to the priority customer without inventing superiority or results.', { sourceFields: ['initial_description', 'targetAudience'] }),
    pricingPosition: section(null, 0, 'Pricing was not required to design the first acquisition tests and remains an explicit open decision.'),
    primarySalesChannel: currentChannel ? section(currentChannel, channelField?.confidence || 0.9, 'This is the builder’s current customer-acquisition source, not a claim that it is already effective.', { semanticRole: factRole(channelField), sourceFields: ['currentAcquisitionChannel'] }) : section(null, 0, 'The current acquisition source must be established.'),
    communicationStyle: section('Specific, credible, and action-oriented', 0.88, 'Customer-acquisition communication should make relevance and the next step clear without unsupported promises.', { sourceFields: ['salesProcess'] }),
    marketingFocus: section(stage && /works|established/i.test(stage) ? 'Scale the strongest evidenced channel' : 'Run focused channel and message tests', 0.86, 'The recommended focus follows the stated maturity of the current acquisition system.', { sourceFields: ['acquisitionStage', 'currentAcquisitionChannel'] }),
    launchApproach: section(`Acquisition path: ${currentChannel || 'channel to validate'} → ${salesProcess || 'conversion step to confirm'}`, 0.84, 'The plan connects customer discovery to a concrete conversion action and measurable follow-up.', { sourceFields: ['currentAcquisitionChannel', 'salesProcess'] }),
    risks: section([
      'Current channel performance and customer demand have not been independently verified.',
      capacity === 'capacity_limited' ? 'Delivery capacity should be addressed before increasing acquisition volume.' : 'Lead quality, conversion, and cost must be measured before scaling spend.',
      'Claims, testimonials, and performance statements require supporting evidence.'
    ], 0.84, 'These risks preserve the difference between builder-provided context and measured acquisition evidence.', { semanticRole: 'derived_risk', sourceFields: ['acquisitionStage', 'capacityReadiness'] })
  };
  return {
    policyVersion: STRATEGY_POLICY_VERSION,
    strategy,
    reasoning: SECTION_KEYS.map(key => ({ section: key, reason: strategy[key].explanation })),
    status: 'Strategy Ready — Measurement Required', confidence: 'Strategy Ready — Measurement Required',
    assumptions: [offer ? `The existing offer is described by the builder as: ${offer}. This description is not independent proof of demand or performance.` : 'Offer details remain builder-provided context.', 'No channel, lead, conversion, revenue, or acquisition-cost performance is assumed.'],
    recommendations: [{ recommendation: 'Establish a baseline before scaling.', reason: 'A baseline makes the first customer-acquisition experiments comparable and prevents activity from being mistaken for progress.' }]
  };
}

function buildStrategy({ objective, understanding = {}, answers = {}, confirmedUnderstanding = {} }) {
  if (objective === 'build_brand') {
    const facts = { ...understanding, ...confirmedUnderstanding };
    const audience = fieldLabel(facts, 'targetAudience');
    const difference = fieldLabel(facts, 'brandDifferentiation');
    const values = fieldLabel(facts, 'brandValues');
    const voice = fieldLabel(facts, 'brandVoice');
    const existing = fieldLabel(facts, 'existingBrand');
    const proof = fieldLabel(facts, 'brandProof');
    const constraints = fieldLabel(facts, 'brandConstraints');
    const strategy = {
      marketPosition: section(difference || 'Positioning direction to establish', difference ? 0.82 : 0.5, difference ? 'This builder-provided direction remains a positioning hypothesis until supported by customer and competitive evidence.' : 'A meaningful position remains open.', { semanticRole: difference ? 'strategic_recommendation' : 'unresolved', sourceFields: ['brandDifferentiation'] }),
      primaryCustomer: audience ? section(audience, field(facts, 'targetAudience')?.confidence || 0.9, 'This is the audience established by the builder.', { semanticRole: factRole(field(facts, 'targetAudience')), sourceFields: ['targetAudience'] }) : section(null, 0, 'A priority audience is required.'),
      customerMotivation: section('Recognition, relevance, and trust', 0.78, 'This is a strategic recommendation to validate with the priority audience, not a confirmed customer belief.', { sourceFields: ['targetAudience', 'brandValues'] }),
      competitiveApproach: section(difference || 'Clarify a defensible difference', 0.78, 'No competitive superiority is assumed; differentiation requires customer relevance and credible proof.', { sourceFields: ['brandDifferentiation', 'brandProof'] }),
      pricingPosition: section(null, 0, 'No pricing position was established by this brand objective.'),
      primarySalesChannel: section(null, 0, 'Channel execution remains open until a channel is supplied or selected.'),
      communicationStyle: section(voice || 'Clear and consistent', voice ? 0.9 : 0.65, voice ? 'The builder established this voice direction.' : 'A clear baseline is recommended until a voice is confirmed.', { semanticRole: voice ? factRole(field(facts, 'brandVoice')) : 'strategic_recommendation', sourceFields: ['brandVoice'] }),
      marketingFocus: section(`Express ${values || 'the confirmed brand principles'} consistently`, 0.84, 'Messaging should translate stated values into observable choices rather than unsupported slogans.', { sourceFields: ['brandValues', 'existingBrand'] }),
      launchApproach: section(existing && existing !== "I'm not sure yet" ? 'Evolve the established foundation deliberately' : 'Establish and test the brand foundation', 0.86, existing ? 'Existing brand elements must be preserved unless the builder explicitly replaces them.' : 'The brand foundation should be tested before broad rollout.', { sourceFields: ['existingBrand', 'brandConstraints'] }),
      risks: section([proof && proof !== "I'm not sure yet" ? 'Use only the builder-provided proof after verifying its intended usage.' : 'Proof, testimonials, credentials, results, and customer preference remain unestablished.', constraints && constraints !== "I'm not sure yet" ? `Respect the stated constraint: ${constraints}.` : 'Legal, naming, and legacy-brand constraints should be confirmed.', 'Generated recommendations must not silently overwrite established Brand Brain facts.'], 0.88, 'These risks protect established brand truth and distinguish recommendations from evidence.', { semanticRole: 'derived_risk', sourceFields: ['brandProof', 'brandConstraints', 'existingBrand'] })
    };
    return { policyVersion: STRATEGY_POLICY_VERSION, strategy, reasoning: SECTION_KEYS.map(key => ({ section: key, reason: strategy[key].explanation })), status: 'Strategy Ready — Brand Decisions to Approve', confidence: 'Strategy Ready — Brand Decisions to Approve', assumptions: ['Positioning, differentiation, and audience response remain hypotheses unless the builder supplied evidence.', 'Existing Brand Brain values remain authoritative until the builder explicitly approves a change.'], recommendations: [{ recommendation: 'Review proposed Brand Brain enrichments field by field.', reason: 'Explicit review prevents speculative generated language from replacing established brand facts.' }] };
  }
  if (objective === 'improve_search_rankings') {
    const facts = { ...understanding, ...confirmedUnderstanding };
    const audience = fieldLabel(facts, 'targetAudience');
    const goal = fieldLabel(facts, 'searchGoal');
    const content = fieldLabel(facts, 'existingContent');
    const market = fieldLabel(facts, 'geographicMarket');
    const suppliedTopics = fieldLabel(facts, 'suppliedKeywords');
    const evidence = fieldLabel(facts, 'searchEvidence');
    const constraints = fieldLabel(facts, 'technicalLimitations');
    const audienceField = field(facts, 'targetAudience');
    const goalField = field(facts, 'searchGoal');
    const strategy = {
      marketPosition: section('Evidence-Grounded Search Growth', 0.9, 'The search direction is based on the confirmed offer and audience, without assuming external keyword or ranking evidence.', { sourceFields: ['websiteContext', 'targetAudience'] }),
      primaryCustomer: audience ? section(audience, audienceField?.confidence || 0.9, provenanceExplanation(audienceField, 'The builder explicitly established this search audience.', 'CopyQuick inferred this audience from the supplied website context.'), { semanticRole: factRole(audienceField), sourceFields: ['targetAudience'] }) : section(null, 0, 'A priority search audience is required.'),
      customerMotivation: goal ? section(goal, goalField?.confidence || 0.9, 'This is the search outcome selected by the builder.', { semanticRole: factRole(goalField), sourceFields: ['searchGoal'] }) : section(null, 0, 'A search goal is required.'),
      competitiveApproach: section('Answer priority customer questions more clearly and completely', 0.82, 'This is a recommended content approach, not evidence of a competitor gap or SERP opportunity.', { sourceFields: ['existingContent', 'suppliedKeywords'] }),
      pricingPosition: section(null, 0, 'Pricing is outside the confirmed search evidence and remains unresolved.'),
      primarySalesChannel: section(market ? `Organic search for ${market}` : 'Organic search', 0.86, market ? 'The geographic scope was supplied by the builder.' : 'No geographic priority was established, so the direction remains market-neutral.', { semanticRole: market ? 'confirmed_fact' : 'strategic_recommendation', sourceFields: ['geographicMarket'] }),
      communicationStyle: section('Useful, specific, and evidence-aware', 0.88, 'Search content should answer real questions clearly and distinguish sourced facts from recommendations.', { sourceFields: ['targetAudience', 'searchEvidence'] }),
      marketingFocus: section(suppliedTopics ? `Validate supplied topics: ${suppliedTopics}` : 'Build and validate a customer-question topic map', 0.84, suppliedTopics ? 'These topics were supplied by the builder but have no assumed volume or ranking potential.' : 'No keyword evidence was supplied; topic opportunities must be researched and validated.', { sourceFields: ['suppliedKeywords'] }),
      launchApproach: section('Publish, connect, measure, and refine', 0.86, 'The recommended sequence links useful content to relevant offer pages and establishes measurement before conclusions are drawn.', { sourceFields: ['existingContent', 'technicalLimitations'] }),
      risks: section([
        evidence ? 'Any supplied search evidence must retain its source and date before it supports a decision.' : 'Current rankings, traffic, search volume, backlinks, competitors, and SERP conditions are unknown.',
        content ? 'The content inventory is builder-provided and has not been verified by a crawl.' : 'Existing content coverage remains unknown.',
        constraints ? `Execution must respect the builder-provided constraint: ${constraints}.` : 'Technical and publishing capacity should be confirmed before scheduling work.'
      ], 0.86, 'These risks preserve the boundary between supplied context, unverified inference, and external SEO evidence.', { semanticRole: 'derived_risk', sourceFields: ['searchEvidence', 'existingContent', 'technicalLimitations'] })
    };
    return {
      policyVersion: STRATEGY_POLICY_VERSION, strategy,
      reasoning: SECTION_KEYS.map(key => ({ section: key, reason: strategy[key].explanation })),
      status: 'Strategy Ready — Search Evidence Required', confidence: 'Strategy Ready — Search Evidence Required',
      assumptions: ['No keyword volume, ranking, traffic, backlink, competitor, crawl, or SERP metric is assumed.', 'Builder-supplied topics are hypotheses until validated with an identified source and date.'],
      recommendations: [{ recommendation: 'Establish a sourced search baseline before prioritizing production at scale.', reason: 'A documented baseline prevents plausible topics from being presented as measured opportunities.' }]
    };
  }
  if (objective === 'increase_conversion_rates') {
    const facts = { ...understanding, ...confirmedUnderstanding };
    const mapped = {
      ...facts,
      acquisitionGoal: { value: 'conversion_improvement', label: 'Improve the primary conversion action', confidence: 1, source: 'user_confirmed' },
      currentAcquisitionChannel: facts.trafficSource,
      acquisitionStage: facts.conversionEvidence?.value && facts.conversionEvidence.value !== 'unsure'
        ? { value: 'baseline_known', label: 'A builder-provided baseline is available', confidence: 1, source: 'user_confirmed' }
        : { value: 'baseline_unknown', label: 'Baseline not established', confidence: 1, source: 'user_confirmed' },
      salesProcess: facts.funnelType,
      capacityReadiness: { value: 'capacity_ready', label: 'Conversion improvement scope', confidence: 1, source: 'user_confirmed' }
    };
    const result = buildCustomerAcquisitionStrategy(mapped, answers, mapped);
    result.strategy.marketPosition = section('Conversion Improvement Focus', 0.9, 'The strategy focuses on the current offer, audience, page, and primary action rather than assuming a traffic problem.', { sourceFields: ['currentOffer', 'pageExperience'] });
    result.strategy.competitiveApproach = section('Reduce friction with clarity and credible proof', 0.86, 'This is a recommended conversion hypothesis; it is not a measured finding.', { sourceFields: ['conversionFriction', 'pageExperience'] });
    result.strategy.marketingFocus = section('Prioritize evidence-backed page and offer experiments', 0.9, 'Recommendations remain hypotheses until controlled measurement shows an effect.', { sourceFields: ['conversionEvidence', 'primaryCta'] });
    result.status = result.confidence = 'Strategy Ready — Conversion Hypotheses';
    result.assumptions = [
      'Traffic, conversion rate, drop-off, and statistical significance remain unknown unless the builder supplied measured evidence.',
      'Page friction and objections are hypotheses unless tied to observed customer behavior or feedback.'
    ];
    return result;
  }
  if (objective === 'get_more_customers') {
    return buildCustomerAcquisitionStrategy(understanding, answers, confirmedUnderstanding);
  }
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
  const isPhysicalProduct = businessType === 'physical_product';
  const isArtisan = includesAny(description, ['artisan', 'handcrafted', 'handmade', 'candle']);
  const isLocalService = businessType === 'service'
    && (includesAny(description, ['local', 'plumbing', 'landscaping', 'detailing'])
      || ['home_services', 'automotive'].includes(industry));
  const isSoftware = businessType === 'software';
  const explorationIntent = field(facts, 'productExplorationDirections');
  const existingProductContext = field(facts, 'existingProductDefinition');
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
  if (isPhysicalProduct && !isSupplement
    && (launchStage === 'idea' || ['idea_only', 'direction_no_formula'].includes(conceptMaturity))) {
    riskItems.push('Product specifications, materials, performance requirements, and prototype evidence are not yet established.');
    riskItems.push('Supplier feasibility, quality controls, lead times, and landed unit economics require validation before inventory commitment.');
    riskItems.push('Packaging, shipping, fulfillment, and applicable compliance requirements must be established before launch assets are finalized.');
  }
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
  if (existingProductContext?.semanticRole === 'builder_provided_product_context' && existingProductContext.value !== 'unsure') {
    assumptions.push('Existing product details are builder-provided context, not independent verification of ingredients, formulation, efficacy, claims, or substantiation.');
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
