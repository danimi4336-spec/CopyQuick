const { buildObjectiveInsights, insightValue } = require('./objectiveInsights');
const { MODES, resolveConversionMode } = require('./conversionMode');

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
    ...(metadata.concept ? { concept: metadata.concept } : {}),
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
  const insights = buildObjectiveInsights({ objective: 'get_more_customers', understanding: facts, answers });
  const customer = fieldLabel(facts, 'targetAudience');
  const goal = fieldLabel(facts, 'acquisitionGoal');
  const currentChannel = fieldLabel(facts, 'currentAcquisitionChannel');
  const stage = fieldLabel(facts, 'acquisitionStage');
  const salesProcess = fieldLabel(facts, 'salesProcess');
  const capacity = fieldValue(facts, 'capacityReadiness');
  const capacityUnknown = !capacity || capacity === 'unsure';
  const offer = String(answers.initial_description || '').trim();
  const customerField = field(facts, 'targetAudience');
  const channelField = field(facts, 'currentAcquisitionChannel');
  const strategy = {
    businessObjective: section(insightValue(insights, 'businessObjective'), 0.9, 'This is the business outcome the builder selected; it is not an end-customer motivation.', { semanticRole: insights.businessObjective.provenance, concept: 'business_objective', sourceFields: ['acquisitionGoal'] }),
    marketPosition: section('Customer-Acquisition Focus', 0.86, 'The strategy is organized around winning the defined priority customer for the existing offer.', { sourceFields: ['initial_description', 'targetAudience'] }),
    primaryCustomer: customer ? section(customer, customerField?.confidence || 0.9, provenanceExplanation(customerField, 'The builder explicitly established this priority customer.', 'CopyQuick inferred this customer from the business description.'), { semanticRole: factRole(customerField), sourceFields: ['targetAudience'] }) : section(null, 0, 'A priority customer is required.'),
    customerMotivation: section(null, 0, 'The homeowner or end-customer motivation is not established by the business acquisition goal and remains unresolved.', { concept: 'customer_motivation' }),
    competitiveApproach: section('Lead with relevance and evidence', 0.8, 'Acquisition messages should connect the offer to the priority customer without inventing superiority or results.', { sourceFields: ['initial_description', 'targetAudience'] }),
    pricingPosition: section(null, 0, 'Pricing was not required to design the first acquisition tests and remains an explicit open decision.'),
    primarySalesChannel: currentChannel ? section(currentChannel, channelField?.confidence || 0.9, 'This is the builder’s current customer-acquisition source. It is not a recommended future channel.', { semanticRole: factRole(channelField), concept: 'current_channel', sourceFields: ['currentAcquisitionChannel'] }) : section(null, 0, 'The current acquisition source must be established.', { concept: 'current_channel' }),
    communicationStyle: section('Specific, credible, and action-oriented', 0.88, 'Customer-acquisition communication should make relevance and the next step clear without unsupported promises.', { sourceFields: ['salesProcess'] }),
    marketingFocus: section(stage && /works|established/i.test(stage) ? 'Scale the strongest evidenced channel' : 'Run focused channel and message tests', 0.86, 'The recommended focus follows the stated maturity of the current acquisition system.', { sourceFields: ['acquisitionStage', 'currentAcquisitionChannel'] }),
    launchApproach: section('Evaluate acquisition channels before selecting execution', 0.84, 'The current source is context only. A recommended channel remains a hypothesis until separately selected and validated.', { concept: 'recommended_channel', sourceFields: ['currentAcquisitionChannel', 'acquisitionStage'] }),
    risks: section([
      'Current channel performance and customer demand have not been independently verified.',
      capacity === 'capacity_limited'
        ? 'Delivery capacity should be addressed before increasing acquisition volume.'
        : capacityUnknown
          ? 'Available delivery capacity is not established. Estimate it before choosing campaign volume or spend.'
          : 'Lead quality, conversion, and cost must be measured before scaling spend.',
      'Claims, testimonials, and performance statements require supporting evidence.'
    ], 0.84, 'These risks preserve the difference between builder-provided context and measured acquisition evidence.', { semanticRole: 'derived_risk', sourceFields: ['acquisitionStage', 'capacityReadiness'] })
  };
  return {
    policyVersion: STRATEGY_POLICY_VERSION,
    strategy,
    reasoning: SECTION_KEYS.map(key => ({ section: key, reason: strategy[key].explanation })),
    status: capacityUnknown ? 'Strategy Ready — Diagnostic Work Needed' : 'Strategy Ready — Measurement Required',
    confidence: capacityUnknown ? 'Strategy Ready — Diagnostic Work Needed' : 'Strategy Ready — Measurement Required',
    assumptions: [offer ? `The existing offer is described by the builder as: ${offer}. This description is not independent proof of demand or performance.` : 'Offer details remain builder-provided context.', 'No channel, lead, conversion, revenue, or acquisition-cost performance is assumed.'],
    recommendations: [
      ...(capacityUnknown ? [{ recommendation: 'Estimate safe acquisition capacity before scaling.', reason: 'Review active projects, project duration, estimate and sales bandwidth, crew availability, service area, desired project mix, consultation capacity, and backlog before setting campaign volume or spend.' }] : []),
      { recommendation: 'Establish a baseline before scaling.', reason: 'A baseline makes the first customer-acquisition experiments comparable and prevents activity from being mistaken for progress.' }
    ],
    insights
  };
}

function buildStrategy({ objective, understanding = {}, answers = {}, confirmedUnderstanding = {} }) {
  if (objective === 'validate_idea') {
    const facts = { ...understanding, ...confirmedUnderstanding };
    const customer = fieldLabel(facts, 'targetAudience');
    const problem = fieldLabel(facts, 'problemHypothesis');
    const solution = fieldLabel(facts, 'solutionHypothesis');
    const evidence = fieldLabel(facts, 'validationEvidence');
    const demand = fieldLabel(facts, 'demandAssumptions');
    const alternatives = fieldLabel(facts, 'knownAlternatives');
    const strategy = {
      marketPosition: section(solution || 'Solution hypothesis to test', 0.76, 'This is a proposed solution, not a validated market position.', { semanticRole: 'strategic_recommendation', sourceFields: ['solutionHypothesis'] }),
      primaryCustomer: customer ? section(customer, 0.78, 'This is the proposed customer segment and remains a hypothesis until evidence supports it.', { semanticRole: 'inferred_fact', sourceFields: ['targetAudience'] }) : section(null, 0, 'A target-customer hypothesis is required.'),
      customerMotivation: section(problem || 'Problem hypothesis to test', 0.76, 'This is a problem hypothesis, not a confirmed customer need.', { semanticRole: 'strategic_recommendation', sourceFields: ['problemHypothesis'] }),
      competitiveApproach: section(alternatives && alternatives !== "I'm not sure yet" ? `Compare against: ${alternatives}` : 'Identify current alternatives before claiming differentiation', 0.78, 'Known alternatives are builder-provided; competitive preference is not assumed.', { sourceFields: ['knownAlternatives'] }),
      pricingPosition: section(null, 0, 'Willingness to pay requires observed evidence and remains unknown.'),
      primarySalesChannel: section('Validation channels selected by experiment', 0.8, 'Choose interview, prototype, or smoke-test channels based on the hypothesis and available access.', { sourceFields: ['validationResources'] }),
      communicationStyle: section('Neutral, curious, and non-leading', 0.92, 'Validation language should elicit evidence rather than persuade respondents to agree.', { sourceFields: ['problemHypothesis'] }),
      marketingFocus: section(`Test the riskiest demand assumption: ${demand || 'customer problem and willingness to act'}`, 0.86, 'Assumptions must become explicit tests with thresholds before investment decisions.', { sourceFields: ['demandAssumptions'] }),
      launchApproach: section('Evidence gate: continue, revise, or stop', 0.9, 'The idea advances only when pre-defined evidence thresholds are met.', { sourceFields: ['validationEvidence', 'ideaMaturity'] }),
      risks: section([evidence && evidence !== "I'm not sure yet" ? 'Classify supplied evidence by source, behavior, sample, and relevance before using it.' : 'No validation evidence is currently established.', 'Plausibility, enthusiasm, and AI confidence do not validate demand.', 'Avoid leading interviews or changing success criteria after seeing results.'], 0.94, 'These risks keep hypotheses separate from facts and protect the next decision.', { semanticRole: 'derived_risk', sourceFields: ['validationEvidence', 'demandAssumptions'] })
    };
    return { policyVersion: STRATEGY_POLICY_VERSION, strategy, reasoning: SECTION_KEYS.map(key => ({ section: key, reason: strategy[key].explanation })), status: evidence && evidence !== "I'm not sure yet" ? 'Strategy Ready — Evidence Requires Assessment' : 'Strategy Ready — Validation Required', confidence: evidence && evidence !== "I'm not sure yet" ? 'Strategy Ready — Evidence Requires Assessment' : 'Strategy Ready — Validation Required', assumptions: ['Customer, problem, solution, demand, and willingness-to-pay statements remain hypotheses until observed evidence meets pre-defined criteria.', 'CopyQuick does not declare an idea validated based on AI judgment or plausibility.'], recommendations: [{ recommendation: 'Test the riskiest assumption with the least expensive credible evidence.', reason: 'Early disconfirming evidence reduces avoidable product and launch investment.' }] };
  }
  if (objective === 'promote_service') {
    const facts = { ...understanding, ...confirmedUnderstanding };
    const mapped = { ...facts,
      acquisitionGoal: { value: 'qualified_clients', label: 'Win better-fit clients', confidence: 1, source: 'user_confirmed' },
      currentAcquisitionChannel: facts.serviceChannel,
      acquisitionStage: { value: 'service_promotion', label: 'Service promotion to validate', confidence: 1, source: 'user_confirmed' },
      salesProcess: { value: 'booked_call', label: 'Book a consultation or next-step conversation', confidence: 1, source: 'user_confirmed' },
      capacityReadiness: { value: 'capacity_ready', label: 'Capacity must remain within stated constraints', confidence: 1, source: 'user_confirmed' }
    };
    const result = buildCustomerAcquisitionStrategy(mapped, answers, mapped);
    const service = fieldLabel(facts, 'serviceDefinition');
    const problem = fieldLabel(facts, 'clientProblem');
    const difference = fieldLabel(facts, 'serviceDifferentiation');
    const proof = fieldLabel(facts, 'serviceExpertise');
    result.strategy.marketPosition = section(service ? `Service focus: ${service}` : 'Service position to establish', 0.88, 'The service definition is builder-provided context, not proof of results.', { semanticRole: 'strategic_recommendation', sourceFields: ['serviceDefinition'] });
    result.strategy.customerMotivation = section(problem || 'Client priority to confirm', problem ? 0.88 : 0.5, problem ? 'This problem was supplied by the builder and should be validated in client language.' : 'The client problem remains open.', { semanticRole: problem ? factRole(field(facts, 'clientProblem')) : 'unresolved', sourceFields: ['clientProblem'] });
    result.strategy.competitiveApproach = section(difference || 'Clarify a relevant service difference', 0.8, 'This is a positioning hypothesis and must not be presented as proven superiority.', { sourceFields: ['serviceDifferentiation'] });
    result.strategy.marketingFocus = section('Lead with client relevance and substantiated expertise', 0.9, proof && proof !== "I'm not sure yet" ? 'Use only the builder-supplied expertise after confirming it is suitable for publication.' : 'Credentials, testimonials, case studies, results, certifications, and customer counts remain unavailable.', { sourceFields: ['serviceExpertise'] });
    result.status = result.confidence = 'Strategy Ready — Service Proof Boundaries';
    result.assumptions = ['No testimonial, credential, certification, case study, client count, or performance result is invented.', 'Pricing and offer details remain unknown unless supplied by the builder.'];
    return result;
  }
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
    const insights = buildObjectiveInsights({ objective, understanding: facts, answers });
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
      businessObjective: section(insightValue(insights, 'searchGoal'), goalField?.confidence || 0.9, 'This is the builder’s search and authority objective, not the reader’s motivation.', { semanticRole: insights.searchGoal.provenance, concept: 'search_goal', sourceFields: ['searchGoal'] }),
      marketPosition: section('Evidence-Grounded Search Growth', 0.9, 'The search direction is based on the confirmed offer and audience, without assuming external keyword or ranking evidence.', { sourceFields: ['websiteContext', 'targetAudience'] }),
      primaryCustomer: audience ? section(audience, audienceField?.confidence || 0.9, provenanceExplanation(audienceField, 'The builder explicitly established this search audience.', 'CopyQuick inferred this audience from the supplied website context.'), { semanticRole: factRole(audienceField), sourceFields: ['targetAudience'] }) : section(null, 0, 'A priority search audience is required.'),
      customerMotivation: section(null, 0, 'The reader’s motivation or need has not been established by the search goal and remains unresolved.', { concept: 'customer_motivation' }),
      competitiveApproach: section('Answer priority customer questions more clearly and completely', 0.82, 'This is a recommended content approach, not evidence of a competitor gap or SERP opportunity.', { sourceFields: ['existingContent', 'suppliedKeywords'] }),
      pricingPosition: section(null, 0, 'Pricing is outside the confirmed search evidence and remains unresolved.'),
      primarySalesChannel: section(market ? `Organic search for ${market}` : 'Organic search', 0.86, market ? 'The geographic scope was supplied by the builder.' : 'Organic search is the current objective scope; no geographic priority was established.', { semanticRole: market ? 'confirmed_fact' : 'strategic_recommendation', concept: 'current_channel', sourceFields: ['geographicMarket'] }),
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
      recommendations: [{ recommendation: 'Establish a sourced search baseline before prioritizing production at scale.', reason: 'A documented baseline prevents plausible topics from being presented as measured opportunities.' }],
      insights
    };
  }
  if (objective === 'increase_conversion_rates') {
    const facts = { ...understanding, ...confirmedUnderstanding };
    const conversionMode = resolveConversionMode(facts);
    const insights = buildObjectiveInsights({ objective, understanding: facts, answers });
    const audience = fieldLabel(facts, 'targetAudience');
    const action = insightValue(insights, 'conversionAction');
    const friction = insightValue(insights, 'observedFriction');
    const traffic = insightValue(insights, 'currentChannel');
    const cta = fieldLabel(facts, 'primaryCta');
    const diagnosticUnknown = !friction || !traffic || !cta || !fieldLabel(facts, 'pageExperience');
    const serviceConsultation = conversionMode === MODES.SERVICE_CONSULTATION;
    const unresolvedMode = conversionMode === MODES.UNRESOLVED;
    const strategy = {
      businessObjective: section(insightValue(insights, 'businessObjective'), 0.9, 'This is the business conversion objective, not an end-customer motivation.', { semanticRole: insights.businessObjective.provenance, concept: 'business_objective', sourceFields: ['objective'] }),
      marketPosition: section(serviceConsultation ? 'Consultation Conversion Focus' : unresolvedMode ? 'Conversion Mode Requires Confirmation' : 'Conversion Improvement Focus', 0.9, serviceConsultation ? 'The strategy focuses on helping qualified service prospects understand fit and take the established consultation action.' : unresolvedMode ? 'The conversion mode remains unresolved and must not default to ecommerce.' : 'The strategy focuses on the current offer, page, and conversion action rather than treating conversion as acquisition.', { sourceFields: ['currentOffer', 'pageExperience', 'funnelType'] }),
      primaryCustomer: audience ? section(audience, field(facts, 'targetAudience')?.confidence || 0.9, 'This is the audience established by the builder.', { semanticRole: factRole(field(facts, 'targetAudience')), sourceFields: ['targetAudience'] }) : section(null, 0, 'A target audience is required.'),
      customerMotivation: section(null, 0, serviceConsultation ? 'The prospective customer’s motivation is separate from the booking objective and remains unresolved.' : 'The customer’s motivation is separate from the conversion KPI and remains unresolved.', { concept: 'customer_motivation' }),
      competitiveApproach: section('Reduce friction with clarity and credible proof', 0.86, friction ? 'This is a conversion hypothesis informed by builder-provided friction; it is not a measured diagnosis.' : 'Observed friction is unresolved, so this remains a hypothesis to test.', { semanticRole: 'strategic_recommendation', concept: 'hypothesis', sourceFields: ['conversionFriction', 'pageExperience'] }),
      pricingPosition: section(null, 0, 'Pricing remains unresolved and discounting is not assumed to be the solution.'),
      primarySalesChannel: traffic ? section(traffic, facts.trafficSource?.confidence || 0.8, 'This is current traffic-source context, not a recommended acquisition channel.', { semanticRole: factRole(facts.trafficSource), concept: 'current_channel', sourceFields: ['trafficSource'] }) : section(null, 0, 'Traffic source remains unresolved.', { concept: 'current_channel' }),
      communicationStyle: section('Clear, specific, and evidence-aware', 0.88, 'Conversion communication should clarify the offer and next action without inventing diagnosis or proof.', { sourceFields: ['currentOffer', 'primaryCta'] }),
      marketingFocus: section(action ? `Improve the ${action.toLowerCase()} path` : 'Confirm the conversion action before proposing execution copy', 0.88, 'The conversion action is distinct from the business KPI and customer motivation.', { concept: 'conversion_action', sourceFields: ['funnelType'] }),
      launchApproach: section(serviceConsultation ? 'Clarify service fit, trust, the consultation process, and the booking path; then measure qualified inquiries' : unresolvedMode ? 'Confirm the conversion mode before prescribing page execution' : 'Diagnose page friction, form hypotheses, and measure conversion behavior', 0.86, 'This is a conversion-testing sequence, not an acquisition path. Unobserved friction remains a hypothesis.', { concept: 'hypothesis', sourceFields: ['pageExperience', 'conversionEvidence', 'conversionFriction'] }),
      risks: section([friction ? 'Builder-provided friction must not be presented as measured diagnosis.' : 'Observed customer friction is not established.', 'Traffic, conversion rate, drop-off, and statistical significance remain unknown unless measured.', 'Customer motivation remains unresolved and must not be replaced by the conversion objective.'], 0.9, 'These boundaries keep current context, hypotheses, and measured evidence separate.', { semanticRole: 'derived_risk', sourceFields: ['conversionEvidence', 'conversionFriction'] })
    };
    return {
      policyVersion: STRATEGY_POLICY_VERSION, strategy,
      reasoning: SECTION_KEYS.map(key => ({ section: key, reason: strategy[key].explanation })),
      status: diagnosticUnknown ? 'Strategy Ready — Diagnostic Work Needed' : 'Strategy Ready — Conversion Hypotheses',
      confidence: diagnosticUnknown ? 'Strategy Ready — Diagnostic Work Needed' : 'Strategy Ready — Conversion Hypotheses',
      assumptions: [
      'Traffic, conversion rate, drop-off, and statistical significance remain unknown unless the builder supplied measured evidence.',
      'Page friction and objections are hypotheses unless tied to observed customer behavior or feedback.'
      ],
      recommendations: [
        ...(diagnosticUnknown ? [{ recommendation: 'Diagnose the unresolved conversion inputs before prescribing final copy.', reason: serviceConsultation ? 'Check service fit, trust and proof, scope clarity, consultation expectations, CTA clarity, form or scheduling friction, and material objections as hypotheses—not established causes.' : unresolvedMode ? 'Confirm the business model and conversion action before selecting mode-specific execution.' : 'Check value clarity, trust and proof, product comprehension, price perception, shipping and returns, CTA clarity, mobile usability, checkout friction, comparison difficulty, and offer fit as hypotheses—not established causes.' }] : []),
        { recommendation: 'Establish a conversion baseline and test one page hypothesis at a time.', reason: 'Measured page behavior—not acquisition activity—should guide conversion decisions.' }
      ],
      insights,
      conversionMode
    };
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
  const differentiationDetails = fieldLabel(facts, 'competitiveDifferentiationDetails');
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
  if (differentiationDetails && ['clear', 'partial'].includes(differentiation)) {
    competitiveApproach = section(
      `Lead with established product differences: ${differentiationDetails}`,
      0.9,
      'The builder established these product differences. They may guide positioning, while efficacy, superiority, certification, and performance still require separate substantiation.',
      { semanticRole: 'strategic_recommendation', sourceFields: ['competitiveDifferentiation', 'competitiveDifferentiationDetails'] }
    );
  } else if (isSupplement) {
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
    builderFacts: {
      ...(existingProductContext?.semanticRole === 'builder_provided_product_context' && existingProductContext.value !== 'unsure' ? {
        builderProductContext: section(
          existingProductContext.label || String(existingProductContext.value),
          existingProductContext.confidence || 1,
          'The builder supplied this product identity and configuration context; it is not independent evidence.',
          { semanticRole: 'builder_provided_product_context', sourceFields: ['existingProductDefinition'] }
        )
      } : {}),
      ...(differentiationDetails ? {
        builderDifferentiationDetails: section(
          differentiationDetails,
          field(facts, 'competitiveDifferentiationDetails')?.confidence || 1,
          'The builder supplied these product differences; efficacy, superiority, certification, and performance remain separate evidence questions.',
          { semanticRole: 'builder_provided_product_context', sourceFields: ['competitiveDifferentiationDetails'] }
        )
      } : {}),
      ...(channelLabel ? {
        confirmedSalesChannel: section(
          channelLabel,
          field(facts, 'salesChannel')?.confidence || 1,
          'The builder confirmed this sales-channel context.',
          { semanticRole: factRole(field(facts, 'salesChannel')), sourceFields: ['salesChannel'] }
        )
      } : {})
    },
    reasoning,
    status,
    confidence: status,
    assumptions,
    recommendations,
    insights: buildObjectiveInsights({ objective, understanding: facts, answers })
  };
}

module.exports = {
  STRATEGY_POLICY_VERSION,
  buildStrategy
};
