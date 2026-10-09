const { evaluateRequirements, isMeaningfullyReady } = require('./discoveryRequirements');
const { minimumProductionDependencies } = require('./productionDependencyPolicy');
const { insightValue } = require('./objectiveInsights');
const { MODES, resolveConversionMode } = require('./conversionMode');

const EXECUTION_PHASES = [
  {
    id: 'foundation',
    title: 'Build Your Foundation',
    reason: 'Establish the customer, positioning, value, and messaging decisions that every later asset should follow.'
  },
  {
    id: 'sales_channel',
    title: 'Prepare Your Sales Channel',
    reason: 'Prepare only the channel assets supported by the entrepreneur’s confirmed route to market.'
  },
  {
    id: 'launch',
    title: 'Launch & Promote',
    reason: 'Turn the approved foundation and channel strategy into a focused launch sequence.'
  }
];

const VALIDATE_PHASES = [
  {
    id: 'foundation',
    title: 'Define & Validate',
    reason: 'Clarify who the opportunity is for and define the initial product and value hypotheses that need validation.'
  },
  {
    id: 'sales_channel',
    title: 'Explore Market Entry',
    reason: 'Identify marketplace themes and search directions to investigate without treating them as market evidence.'
  }
];

const PHYSICAL_PRODUCT_VALIDATION_PHASES = [
  {
    id: 'define_validate',
    title: 'Define & Validate',
    reason: 'Define the customer, working product requirements, market hypothesis, and evidence needed before feasibility investment.'
  },
  {
    id: 'feasibility',
    title: 'Establish Feasibility',
    reason: 'Test the product, supplier, compliance, and economic assumptions that determine whether the concept can responsibly move forward.'
  },
  {
    id: 'operations',
    title: 'Prepare Operations',
    reason: 'Translate the validated product definition into packaging, shipping, inventory, and fulfillment requirements before launch execution.'
  }
];

const CUSTOMER_ACQUISITION_PHASES = [
  { id: 'diagnose', title: 'Diagnose & Focus', reason: 'Establish the customer, goal, current acquisition baseline, and conversion path.' },
  { id: 'activate', title: 'Build the Acquisition System', reason: 'Create coordinated channel, campaign, outreach, and conversion-path guidance.' },
  { id: 'improve', title: 'Measure & Improve', reason: 'Define measurement and a disciplined experiment backlog before scaling.' }
];

function acquisitionAssetDefinitions({ channel, salesProcess, strategicDirection }) {
  const channelAssets = {
    referrals: [
      ['referral_campaign_kit', 'Referral Campaign Kit', 'recommended', 88, 'Create copy-ready customer and partner referral requests, introduction language, and follow-up messages.'],
      ['outreach_sequence', 'Customer Outreach Sequence', 'optional', 82, 'Create a coordinated email sequence for referred prospects who need a thoughtful follow-up.']
    ],
    organic_search: [
      ['organic_content_campaign', 'Organic Content Campaign', 'recommended', 88, 'Create a publishable pillar-content package that attracts the confirmed customer through useful search-led education.'],
      ['lead_capture_page', 'Lead Capture Page', 'recommended', 84, 'Create a conversion-focused destination that turns relevant organic traffic into the confirmed next step.'],
      ['outreach_sequence', 'Customer Outreach Sequence', 'optional', 78, 'Create a follow-up email sequence for leads captured through content.']
    ],
    social: [
      ['social_lead_campaign', 'Social Lead Campaign', 'recommended', 88, 'Create a coordinated set of publishable social posts, direct messages, replies, and calls to action.'],
      ['lead_capture_page', 'Lead Capture Page', 'recommended', 84, 'Create a conversion-focused destination for prospects who respond to the social campaign.'],
      ['outreach_sequence', 'Customer Outreach Sequence', 'optional', 78, 'Create a follow-up email sequence for social leads who opt in.']
    ],
    paid_ads: [
      ['paid_ad_copy_set', 'Paid Ad Copy Set', 'recommended', 90, 'Create multiple test-ready ad concepts with headlines, primary copy, descriptions, calls to action, and claim-safe variants.'],
      ['lead_capture_page', 'Lead Capture Page', 'recommended', 86, 'Create a conversion-focused destination aligned with the paid campaign.'],
      ['outreach_sequence', 'Customer Outreach Sequence', 'optional', 78, 'Create a follow-up email sequence for paid leads who opt in.']
    ],
    outbound: [
      ['outreach_sequence', 'Customer Outreach Sequence', 'recommended', 90, 'Create a complete outbound email sequence with subject lines, bodies, calls to action, timing, and compliance checks.']
    ],
    mixed_channels: [
      ['multi_channel_campaign_kit', 'Multi-Channel Campaign Kit', 'recommended', 88, 'Create coordinated referral, email, social, direct-message, and paid-copy starters around one campaign idea.'],
      ['lead_capture_page', 'Lead Capture Page', 'recommended', 84, 'Create a shared conversion destination that keeps the message consistent across selected channels.'],
      ['outreach_sequence', 'Customer Outreach Sequence', 'optional', 78, 'Create an opt-in follow-up email sequence for campaign leads.']
    ],
    no_reliable_channel: [
      ['multi_channel_campaign_kit', 'Channel Test Campaign Kit', 'recommended', 88, 'Create bounded copy variants for testing several plausible acquisition channels without assuming one already works.'],
      ['lead_capture_page', 'Lead Capture Page', 'optional', 80, 'Create a shared conversion destination once a test channel and offer path are selected.']
    ],
    unsure: [
      ['multi_channel_campaign_kit', 'Channel Test Campaign Kit', 'recommended', 88, 'Create bounded copy variants for testing several plausible acquisition channels without assuming one already works.'],
      ['lead_capture_page', 'Lead Capture Page', 'optional', 80, 'Create a shared conversion destination once a test channel and offer path are selected.']
    ]
  };
  const selected = [...(channelAssets[channel] || channelAssets.unsure)];
  if (['booked_call', 'sales_conversation'].includes(salesProcess)) {
    selected.push(['sales_call_script', 'Sales Call Script', 'recommended', 83, 'Create a practical discovery and sales-conversation script aligned with the confirmed offer, customer, and next step.']);
  }
  return selected.map(([id, title, recommendationLevel, priority, reason]) => [
    id, title, 'activate', recommendationLevel, priority,
    ['campaign_brief', 'conversion_path_brief'], reason, strategicDirection
  ]);
}

function buildCustomerAcquisitionPlan({ objective, confirmedUnderstanding, strategyResult, answers }) {
  if (!confirmedUnderstanding || !Object.keys(confirmedUnderstanding).length) return invalidResult(objective, 'Confirm the business understanding before building a plan.');
  if (!strategyResult?.strategy) return invalidResult(objective, 'Review and approve a current strategy before building a plan.');
  const readiness = evaluateRequirements({ objective, understanding: confirmedUnderstanding, answers });
  if (!isMeaningfullyReady(readiness)) return invalidResult(objective, 'Resolve the essential discovery requirements before building a plan.');
  const foundation = directionFrom(strategyResult, ['businessObjective', 'primaryCustomer', 'customerMotivation', 'competitiveApproach'], 'Focus on the confirmed priority customer and business objective.');
  const activation = directionFrom(strategyResult, ['primarySalesChannel', 'marketingFocus', 'communicationStyle', 'launchApproach'], 'Evaluate a measurable path from audience to conversion.');
  const channel = normalizedField(confirmedUnderstanding, 'currentAcquisitionChannel') || 'unsure';
  const salesProcess = normalizedField(confirmedUnderstanding, 'salesProcess');
  const businessType = normalizedField(confirmedUnderstanding, 'businessType');
  const serviceDefinition = normalizedField(confirmedUnderstanding, 'category') || normalizedField(confirmedUnderstanding, 'industry');
  const targetAudience = normalizedField(confirmedUnderstanding, 'targetAudience');
  const capacity = normalizedField(confirmedUnderstanding, 'capacityReadiness');
  const capacityUnresolved = !capacity || capacity === 'unsure';
  const channelNeutralServiceConversionReady = businessType === 'service'
    && Boolean(serviceDefinition && serviceDefinition !== 'unsure')
    && Boolean(targetAudience && targetAudience !== 'unsure')
    && ['booked_call', 'sales_conversation'].includes(salesProcess)
    && capacity === 'capacity_ready';
  const directSales = salesProcess === 'sales_conversation';
  const definitions = channelNeutralServiceConversionReady ? [
    ['conversion_diagnostic_brief', directSales ? 'Service Conversion Diagnostic' : 'Consultation Conversion Diagnostic', 'diagnose', 'essential', 100, [], 'Document the confirmed service, audience, conversion path, and unresolved proof or page questions without inventing a channel or diagnosis.', foundation],
    ['consultation_conversion_brief', directSales ? 'Service Conversation Brief' : 'Consultation Conversion Brief', 'activate', 'essential', 95, ['conversion_diagnostic_brief'], 'Define service fit, page structure, trust boundaries, and the confirmed conversion action.', activation],
    ['consultation_conversion_page_copy', directSales ? 'Service Conversation Page Copy' : 'Consultation Conversion Page Copy', 'activate', 'recommended', 90, ['consultation_conversion_brief'], 'Create ready-for-review, channel-neutral page copy that helps qualified prospects take the confirmed conversation step.', activation],
    ['conversion_measurement_plan', directSales ? 'Sales Conversation Measurement Plan' : 'Consultation Measurement Plan', 'improve', 'recommended', 80, ['conversion_diagnostic_brief'], 'Track inquiries, qualified inquiries, conversation starts, and completed next steps before scaling acquisition spend.', activation]
  ] : [
    ['acquisition_snapshot', 'Customer Acquisition Snapshot', 'diagnose', 'essential', 100, [], capacityUnresolved ? 'Document the offer, customer, goal, current channel, sales motion, and evidence gaps; estimate safe delivery and consultation capacity before scaling.' : 'Document the offer, customer, goal, current channel, sales motion, capacity, and evidence gaps.', foundation],
    ['acquisition_channel_strategy', 'Acquisition Channel Strategy', 'activate', 'essential', 95, ['acquisition_snapshot'], 'Choose a focused channel hypothesis and define how it will be validated before scaling.', activation],
    ['campaign_brief', 'Lead Generation Campaign Brief', 'activate', 'recommended', 90, ['acquisition_snapshot', 'acquisition_channel_strategy'], 'Turn the channel strategy into a focused campaign with an audience, message, offer, and next action.', activation],
    ['conversion_path_brief', 'Conversion Path Brief', 'activate', 'recommended', 80, ['acquisition_snapshot', 'campaign_brief'], 'Define the path from first contact to purchase, booking, or sales conversation.', activation],
    ...(insightValue(strategyResult.insights, 'recommendedChannel')
      ? acquisitionAssetDefinitions({ channel: insightValue(strategyResult.insights, 'recommendedChannel'), salesProcess, strategicDirection: activation })
      : []),
    ['acquisition_measurement_plan', 'Acquisition Measurement Plan', 'improve', 'recommended', 75, ['acquisition_channel_strategy', 'conversion_path_brief'], 'Specify baseline, funnel events, quality signals, and decision thresholds without inventing performance.', activation],
    ['acquisition_experiment_backlog', 'Acquisition Experiment Backlog', 'improve', 'optional', 70, ['acquisition_measurement_plan'], 'Prioritize bounded channel, message, offer, and follow-up tests with explicit learning goals.', activation]
  ];
  const items = definitions.map(([id, title, phase, recommendationLevel, priority, dependencies, reason, strategicDirection]) => deliverable({ id, title, phase, category: phase, recommendationLevel, priority, dependencies, reason }, strategicDirection));
  return {
    objective, planningStage: normalizedField(confirmedUnderstanding, 'acquisitionStage'),
    phases: CUSTOMER_ACQUISITION_PHASES.map(phase => ({ ...phase, deliverables: items.filter(item => item.phase === phase.id) })),
    exclusions: [],
    summary: {
      deliverableCount: items.length,
      estimatedCredits: null,
      estimatedTime: null,
      requiresReadyAsset: true,
      whyThisPlan: channelNeutralServiceConversionReady
        ? `The confirmed service, audience, ${directSales ? 'sales-conversation' : 'booking'} path, and capacity support conversion preparation now. The page copy is channel-neutral; future acquisition channels remain separate hypotheses, and measurement is included before scaling spend.`
        : 'This plan diagnoses the current customer-acquisition system, evaluates a future channel separately from the current source, and defines measurement before execution or scale.'
    },
    readiness: { ready: true, reason: null }
  };
}

function derivePlanningStage({ conceptMaturity, launchStage }) {
  if (!launchStage || launchStage === 'unsure') return null;
  if (conceptMaturity === 'unsure') return null;

  const stage = {
    idea: 'validate',
    development: 'develop',
    ready: 'prepare_launch',
    selling: 'optimize'
  }[launchStage] || null;
  if (!stage) return null;

  // Product maturity may conservatively hold a plan back, but it never promotes it.
  if (['idea_only', 'direction_no_formula'].includes(conceptMaturity)) return 'validate';
  if (conceptMaturity === 'in_development' && ['prepare_launch', 'optimize'].includes(stage)) return 'develop';
  return stage;
}

function normalizedField(understanding, key) {
  const field = understanding?.[key];
  if (!field || field.value === null || field.source === 'unknown') return null;
  const value = String(field.value).trim().toLowerCase();
  return value && value !== 'unsure' ? value : null;
}

function fieldLabel(understanding, key) {
  const field = understanding?.[key];
  if (!normalizedField(understanding, key)) return null;
  return field.label || String(field.value);
}

function strategyValue(strategyResult, key) {
  const value = strategyResult?.strategy?.[key]?.value;
  return value && value !== 'Unknown' ? value : null;
}

function strategyDirection(strategyResult, key) {
  const item = strategyResult?.strategy?.[key];
  const value = strategyValue(strategyResult, key);
  if (!value) return null;
  const labels = {
    marketPosition: 'market direction', primaryCustomer: 'primary customer', customerMotivation: 'customer motivation',
    competitiveApproach: 'competitive approach', communicationStyle: 'communication style',
    marketingFocus: 'marketing focus', launchApproach: 'launch approach'
  };
  const label = labels[key] || key;
  if (item.semanticRole === 'strategic_recommendation') return `Recommended ${label}: ${value}`;
  if (item.semanticRole === 'confirmed_fact') return `Confirmed ${label}: ${value}`;
  if (item.semanticRole === 'inferred_fact') return `Inferred ${label}: ${value}`;
  return value;
}

function directionFrom(strategyResult, keys, fallback) {
  const directions = keys.map(function(key) {
    return strategyDirection(strategyResult, key);
  }).filter(Boolean);
  return directions.length ? directions.join(' · ') : fallback;
}

function deliverable(definition, strategicDirection) {
  return {
    id: definition.id,
    title: definition.title,
    category: definition.category,
    phase: definition.phase,
    priority: definition.priority,
    recommendationLevel: definition.recommendationLevel,
    reason: definition.reason,
    strategicDirection,
    dependencies: definition.dependencies,
    applicable: true
  };
}

function exclusion(definition, reason) {
  return {
    id: definition.id,
    title: definition.title,
    applicable: false,
    reason
  };
}

function invalidResult(objective, reason) {
  return {
    objective,
    phases: [],
    exclusions: [],
    summary: {
      deliverableCount: 0,
      estimatedCredits: null,
      estimatedTime: null,
      whyThisPlan: null
    },
    readiness: { ready: false, reason }
  };
}

function buildPlan({ objective, confirmedUnderstanding, strategyResult, answers = {} }) {
  if (objective === 'validate_idea') {
    if (!confirmedUnderstanding || !Object.keys(confirmedUnderstanding).length) return invalidResult(objective, 'Confirm the business understanding before building a plan.');
    if (!strategyResult?.strategy) return invalidResult(objective, 'Review and approve a current strategy before building a plan.');
    const readiness = evaluateRequirements({ objective, understanding: confirmedUnderstanding, answers });
    if (!isMeaningfullyReady(readiness)) return invalidResult(objective, 'Resolve the essential discovery requirements before building a plan.');
    const direction = directionFrom(strategyResult, ['primaryCustomer', 'customerMotivation', 'marketPosition', 'launchApproach'], 'Validate the idea with observed evidence.');
    const definitions = [
      ['customer_profile', 'Target-Customer Hypothesis', 'map', 'essential', 100, [], 'Define the proposed customer, needs, objections, triggers, and language to investigate.'],
      ['product_concept_brief', 'Assumptions Map', 'map', 'essential', 96, ['customer_profile'], 'Separate the problem, solution, demand, alternative, and feasibility assumptions.'],
      ['product_positioning', 'Positioning Hypothesis', 'design', 'recommended', 90, ['customer_profile'], 'Create a testable position without presenting it as established.'],
      ['value_proposition', 'Value Proposition Hypothesis', 'design', 'recommended', 86, ['customer_profile', 'product_positioning'], 'Create language to test for relevance and comprehension.'],
      ['validation_plan', 'Validation Experiments & Decision Framework', 'test', 'essential', 95, ['customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition'], 'Provide interview questions, experiments, evidence thresholds, success/failure criteria, and continue/revise/stop decisions.']
    ];
    const items = definitions.map(([id, title, phase, recommendationLevel, priority, dependencies, reason]) => deliverable({ id, title, phase, category: phase, recommendationLevel, priority, dependencies, reason }, direction));
    return { objective, planningStage: 'validate', phases: [
      { id: 'map', title: 'Map the Riskiest Assumptions', deliverables: items.filter(item => item.phase === 'map') },
      { id: 'design', title: 'Design Testable Hypotheses', deliverables: items.filter(item => item.phase === 'design') },
      { id: 'test', title: 'Run Evidence-Gated Validation', deliverables: items.filter(item => item.phase === 'test') }
    ], exclusions: [], summary: { deliverableCount: items.length, estimatedCredits: null, estimatedTime: null, whyThisPlan: 'This plan maps assumptions, creates neutral customer and positioning hypotheses, and defines evidence thresholds and next decisions. It never treats AI plausibility as validation.' }, readiness: { ready: true, reason: null } };
  }
  if (objective === 'promote_service') {
    if (!confirmedUnderstanding || !Object.keys(confirmedUnderstanding).length) return invalidResult(objective, 'Confirm the business understanding before building a plan.');
    if (!strategyResult?.strategy) return invalidResult(objective, 'Review and approve a current strategy before building a plan.');
    const readiness = evaluateRequirements({ objective, understanding: confirmedUnderstanding, answers });
    if (!isMeaningfullyReady(readiness)) return invalidResult(objective, 'Resolve the essential discovery requirements before building a plan.');
    const offerDescription = String(answers.initial_description || '').trim().replace(/\s+/g, ' ').slice(0, 2000);
    const direction = directionFrom(strategyResult, ['marketPosition', 'primaryCustomer', 'customerMotivation', 'marketingFocus'], 'Promote the confirmed service responsibly.')
      + (offerDescription ? ` · Builder-provided offer description: ${offerDescription}. Treat this as unverified context, not proof of performance, demand, differentiation, claims, credentials, or results.` : '');
    const definitions = [
      ['customer_profile', 'Ideal Client Profile', 'position', 'essential', 100, [], 'Document the best-fit client, priorities, objections, and evidence gaps.'],
      ['product_positioning', 'Service Positioning', 'position', 'essential', 96, ['customer_profile'], 'Define an evidence-aware service position without implying proven superiority.'],
      ['value_proposition', 'Service Value Proposition', 'position', 'essential', 92, ['customer_profile', 'product_positioning'], 'Connect the service to the client problem while keeping results and proof bounded.'],
      ['core_messaging', 'Service Messaging Guide', 'promote', 'essential', 90, ['customer_profile', 'product_positioning', 'value_proposition'], 'Create coherent messages, proof themes, and calls to action.'],
      ['service_page', 'Service Page Copy', 'promote', 'recommended', 88, ['product_positioning', 'core_messaging'], 'Create concrete service-page copy grounded in approved positioning and proof.']
    ];
    const items = definitions.map(([id, title, phase, recommendationLevel, priority, dependencies, reason]) => deliverable({ id, title, phase, category: phase, recommendationLevel, priority, dependencies, reason }, direction));
    return { objective, planningStage: 'develop', phases: [
      { id: 'position', title: 'Position the Service', deliverables: items.filter(item => item.phase === 'position') },
      { id: 'promote', title: 'Create Client-Facing Promotion', deliverables: items.filter(item => item.phase === 'promote') }
    ], exclusions: [], summary: { deliverableCount: items.length, estimatedCredits: null, estimatedTime: null, whyThisPlan: 'This plan establishes service positioning and proof boundaries before creating concrete service-page and outreach assets. It never invents credentials, testimonials, case studies, results, certifications, or client counts.' }, readiness: { ready: true, reason: null } };
  }
  if (objective === 'build_brand') {
    if (!confirmedUnderstanding || !Object.keys(confirmedUnderstanding).length) return invalidResult(objective, 'Confirm the business understanding before building a plan.');
    if (!strategyResult?.strategy) return invalidResult(objective, 'Review and approve a current strategy before building a plan.');
    const readiness = evaluateRequirements({ objective, understanding: confirmedUnderstanding, answers });
    if (!isMeaningfullyReady(readiness)) return invalidResult(objective, 'Resolve the essential discovery requirements before building a plan.');
    const direction = directionFrom(strategyResult, ['marketPosition', 'primaryCustomer', 'communicationStyle', 'marketingFocus'], 'Develop an evidence-aware brand foundation.');
    const definitions = [
      ['customer_profile', 'Audience Profile', 'foundation', 'essential', 100, [], 'Document the priority audience, needs to validate, and language boundaries.'],
      ['product_positioning', 'Brand Positioning', 'foundation', 'essential', 95, ['customer_profile'], 'Create a positioning framework that keeps hypotheses and proof requirements explicit.'],
      ['value_proposition', 'Brand Value Proposition', 'messaging', 'essential', 90, ['customer_profile', 'product_positioning'], 'Translate positioning into a customer-relevant value proposition without invented proof.'],
      ['core_messaging', 'Brand Narrative & Messaging Guide', 'messaging', 'recommended', 85, ['customer_profile', 'product_positioning', 'value_proposition'], 'Create messaging pillars, narrative direction, voice guidance, proof themes, calls to action, and practical usage guidance.']
    ];
    const items = definitions.map(([id, title, phase, recommendationLevel, priority, dependencies, reason]) => deliverable({ id, title, phase, category: phase, recommendationLevel, priority, dependencies, reason }, direction));
    return { objective, planningStage: 'develop', phases: [
      { id: 'foundation', title: 'Define the Brand Foundation', deliverables: items.filter(item => item.phase === 'foundation') },
      { id: 'messaging', title: 'Build the Messaging System', deliverables: items.filter(item => item.phase === 'messaging') }
    ], exclusions: [], summary: { deliverableCount: items.length, estimatedCredits: null, estimatedTime: null, whyThisPlan: 'This plan defines the audience and positioning before producing a coherent narrative and messaging guide. Brand Brain changes require explicit field-level approval and never silently replace established facts.' }, readiness: { ready: true, reason: null } };
  }
  if (objective === 'improve_search_rankings') {
    if (!confirmedUnderstanding || !strategyResult?.strategy) return invalidResult(objective, 'Confirm the understanding and strategy before building a plan.');
    const direction = directionFrom(strategyResult, ['businessObjective', 'primaryCustomer', 'marketingFocus'], 'Establish search evidence and useful topic direction.');
    const defs = [
      ['search_evidence_snapshot', 'Search Evidence Snapshot', 'research', 'essential', 100, []],
      ['search_strategy', 'Search Strategy', 'research', 'essential', 95, ['search_evidence_snapshot']],
      ['priority_content_brief', 'Priority Content Brief', 'content', 'recommended', 90, ['search_evidence_snapshot', 'search_strategy']],
      ['research_evidence_pack', 'Research Evidence Pack', 'content', 'recommended', 87, ['priority_content_brief']],
      ['priority_search_article', 'Priority Search Article', 'content', 'recommended', 85, ['priority_content_brief', 'research_evidence_pack']],
      ['search_measurement_plan', 'Search Measurement Plan', 'measure', 'recommended', 75, ['search_strategy']]
    ];
    const prepared = defs.map(([id,title,phase,recommendationLevel,priority,dependencies]) => deliverable({ id,title,phase,category:phase,recommendationLevel,priority,dependencies,reason:'Advance the search objective without substituting acquisition concepts.' }, direction));
    return {
      objective, planningStage: 'develop', exclusions: [], readiness: { ready: true, reason: null },
      phases: [
        { id: 'research', title: 'Establish Search Evidence', deliverables: prepared.filter(item => item.phase === 'research') },
        { id: 'content', title: 'Build Search Content', deliverables: prepared.filter(item => item.phase === 'content') },
        { id: 'measure', title: 'Measure & Improve', deliverables: prepared.filter(item => item.phase === 'measure') }
      ],
      summary: { deliverableCount: prepared.length, estimatedCredits:null, estimatedTime:null, whyThisPlan: 'This plan uses search-specific evidence, strategy, content, and measurement foundations without relabeling acquisition artifacts.' }
    };
  }
  if (objective === 'increase_conversion_rates') {
    if (!confirmedUnderstanding || !strategyResult?.strategy) return invalidResult(objective, 'Confirm the understanding and strategy before building a plan.');
    const direction = directionFrom(strategyResult, ['businessObjective', 'primaryCustomer', 'competitiveApproach', 'marketingFocus'], 'Diagnose and improve the established conversion action.');
    const conversionMode = resolveConversionMode(confirmedUnderstanding);
    const serviceConsultation = conversionMode === MODES.SERVICE_CONSULTATION;
    const trialSignup = conversionMode === MODES.SAAS_TRIAL_SIGNUP;
    const defs = serviceConsultation ? [
      ['conversion_diagnostic_brief', 'Conversion Diagnostic Brief', 'diagnose', 'essential', 100, []],
      ['consultation_conversion_brief', 'Consultation Conversion Brief', 'improve', 'recommended', 92, ['conversion_diagnostic_brief']],
      ['consultation_conversion_page_copy', 'Consultation Conversion Page Copy', 'improve', 'recommended', 90, ['consultation_conversion_brief']],
      ['conversion_measurement_plan', 'Conversion Measurement Plan', 'measure', 'recommended', 80, ['conversion_diagnostic_brief']]
    ] : conversionMode === MODES.UNRESOLVED ? [
      ['conversion_diagnostic_brief', 'Conversion Diagnostic Brief', 'diagnose', 'essential', 100, []],
      ['conversion_measurement_plan', 'Conversion Measurement Plan', 'measure', 'recommended', 80, ['conversion_diagnostic_brief']]
    ] : [
      ['conversion_diagnostic_brief', 'Conversion Diagnostic Brief', 'diagnose', 'essential', 100, []],
      ['conversion_page_brief', trialSignup ? 'Trial-Signup Conversion Brief' : 'Product-Page Conversion Brief', 'improve', 'recommended', 90, ['conversion_diagnostic_brief']],
      ['conversion_measurement_plan', 'Conversion Measurement Plan', 'measure', 'recommended', 80, ['conversion_diagnostic_brief']]
    ];
    const items = defs.map(([id,title,phase,recommendationLevel,priority,dependencies]) => deliverable({id,title,phase,category:phase,recommendationLevel,priority,dependencies,reason:'Diagnose or test conversion without substituting acquisition work.'}, direction));
    return {
      objective, planningStage: 'optimize', exclusions: [], readiness: { ready: true, reason: null },
      phases: [
        { id: 'diagnose', title: 'Diagnose Conversion', deliverables: items.filter(item => item.phase === 'diagnose') },
        { id: 'improve', title: 'Improve Offer & Page', deliverables: items.filter(item => item.phase === 'improve') },
        { id: 'measure', title: 'Test & Measure', deliverables: items.filter(item => item.phase === 'measure') }
      ],
      summary: { deliverableCount: items.length, estimatedCredits:null, estimatedTime:null, requiresReadyAsset: serviceConsultation, conversionMode, whyThisPlan: serviceConsultation ? 'This plan creates ready-for-review consultation page copy supported by a service-specific diagnostic and brief, with measurement kept parallel.' : trialSignup ? 'This planning-only path diagnoses trial-signup friction, defines signup hypotheses, and establishes measurement without inventing an unrelated sales path.' : conversionMode === MODES.UNRESOLVED ? 'This diagnostic plan preserves the unresolved conversion mode instead of defaulting to ecommerce execution.' : 'This smaller plan diagnoses conversion and defines product-page hypotheses and measurement without selecting acquisition-only assets.' }
    };
  }
  if (objective === 'get_more_customers') return buildCustomerAcquisitionPlan({ objective, confirmedUnderstanding, strategyResult, answers });
  if (objective !== 'launch_product') {
    return invalidResult(objective, 'A supported confirmed objective is required before planning.');
  }
  if (!confirmedUnderstanding || !Object.keys(confirmedUnderstanding).length) {
    return invalidResult(objective, 'Confirm the business understanding before building a plan.');
  }
  if (!strategyResult?.strategy) {
    return invalidResult(objective, 'Review and approve a current strategy before building a plan.');
  }
  const readiness = evaluateRequirements({ objective, understanding: confirmedUnderstanding, answers });
  if (!isMeaningfullyReady(readiness)) {
    return invalidResult(objective, 'Resolve the essential discovery requirements before building a plan.');
  }

  const businessType = normalizedField(confirmedUnderstanding, 'businessType');
  const industry = normalizedField(confirmedUnderstanding, 'industry');
  const category = normalizedField(confirmedUnderstanding, 'category');
  const salesChannel = normalizedField(confirmedUnderstanding, 'salesChannel');
  const salesChannelLabel = String(fieldLabel(confirmedUnderstanding, 'salesChannel') || '').toLowerCase();
  const targetAudience = normalizedField(confirmedUnderstanding, 'targetAudience');
  const brand = normalizedField(confirmedUnderstanding, 'brand');
  const conceptMaturity = normalizedField(confirmedUnderstanding, 'conceptMaturity');
  const launchStage = normalizedField(confirmedUnderstanding, 'launchStage');
  const isPhysicalProduct = businessType === 'physical_product';
  const isService = businessType === 'service';
  const isSoftware = businessType === 'software';
  const isAmazon = salesChannel === 'amazon' || (salesChannel === 'multiple' && /amazon/.test(salesChannelLabel));
  const isOwnedStore = salesChannel === 'own_website' || (salesChannel === 'multiple' && /website|shopify|owned/.test(salesChannelLabel));
  const isLocalService = isService && (
    targetAudience === 'local_customers'
    || ['home_services', 'automotive'].includes(industry)
  );
  const hasTrialContext = isSoftware && /trial/i.test(strategyValue(strategyResult, 'launchApproach') || '');
  const planningStage = derivePlanningStage({ conceptMaturity, launchStage });
  if (!planningStage) {
    return invalidResult(objective, 'Confirm the launch stage before building a plan.');
  }
  const validateProduct = isPhysicalProduct && planningStage === 'validate';
  const generalPhysicalValidation = validateProduct && category !== 'dietary_supplement';
  const developProduct = isPhysicalProduct && planningStage === 'develop';
  const productExecutionReady = !isPhysicalProduct || ['prepare_launch', 'optimize'].includes(planningStage);

  const foundationDirection = directionFrom(
    strategyResult,
    ['marketPosition', 'primaryCustomer', 'customerMotivation'],
    'Clarify the confirmed customer, value, and market position before producing execution assets.'
  );
  const existingProductContext = confirmedUnderstanding.existingProductDefinition;
  const productContextDirection = existingProductContext?.semanticRole === 'builder_provided_product_context'
    && existingProductContext.value !== 'unsure'
    && typeof existingProductContext.label === 'string'
    ? `Builder-provided product context: ${existingProductContext.label.trim()}. Treat this as unverified context, not proof of ingredients, efficacy, claims, or substantiation.`
    : null;
  const differentiationContext = confirmedUnderstanding.competitiveDifferentiationDetails;
  const differentiationContextDirection = differentiationContext?.source === 'user_confirmed'
    && differentiationContext.value !== 'unsure'
    && typeof differentiationContext.label === 'string'
    ? `Builder-provided differentiation details: ${differentiationContext.label.trim()}. Treat these as product attributes supplied by the builder, not independent proof of efficacy, superiority, certification, or performance.`
    : null;
  const offerDescription = typeof answers.initial_description === 'string'
    ? answers.initial_description.trim().replace(/\s+/g, ' ').slice(0, 2000)
    : '';
  const offerContextDirection = offerDescription
    ? `Builder-provided offer description: ${offerDescription}. Treat this as unverified context, not proof of performance, demand, differentiation, claims, or substantiation.`
    : null;
  const sourceContextDirection = [offerContextDirection, productContextDirection, differentiationContextDirection].filter(Boolean).join(' · ');
  const groundedFoundationDirection = sourceContextDirection
    ? `${foundationDirection} · ${sourceContextDirection}`
    : foundationDirection;
  const channelDirection = directionFrom(
    strategyResult,
    ['competitiveApproach', 'communicationStyle', 'marketingFocus'],
    'Carry the approved positioning and messaging consistently into the confirmed sales channel.'
  );
  const launchDirection = directionFrom(
    strategyResult,
    ['launchApproach', 'communicationStyle', 'marketingFocus'],
    'Launch with messaging that follows the approved business strategy.'
  );
  const groundedChannelDirection = sourceContextDirection
    ? `${channelDirection} · ${sourceContextDirection}`
    : channelDirection;
  const groundedLaunchDirection = sourceContextDirection
    ? `${launchDirection} · ${sourceContextDirection}`
    : launchDirection;
  const explorationField = confirmedUnderstanding.productExplorationDirections;
  const explorationDirection = explorationField?.semanticRole === 'exploration_intent'
    && typeof explorationField.label === 'string'
    && explorationField.label.trim()
    ? `Exploration intent: ${explorationField.label.trim()}`
    : 'Exploration intent remains open and must be defined without inventing product facts.';
  const validationDirection = `${foundationDirection} · ${explorationDirection}`;

  const candidates = [
    {
      id: 'customer_profile', title: 'Customer Profile', category: 'foundation', phase: generalPhysicalValidation ? 'define_validate' : 'foundation', priority: 100,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('customer_profile'), applicable: true,
      reason: 'A clear customer profile keeps every later recommendation focused on the confirmed audience.', direction: groundedFoundationDirection
    },
    {
      id: 'product_concept_brief', title: 'Product Concept Brief', category: 'foundation', phase: generalPhysicalValidation ? 'define_validate' : 'foundation', priority: 99,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('product_concept_brief'), applicable: validateProduct,
      reason: 'Turn the builder’s exploration choices into a clear working concept brief while keeping formulation, claims, and proof explicitly unresolved.',
      exclusionReason: 'A Product Concept Brief is reserved for physical products that are still validating the opportunity.', direction: validationDirection
    },
    {
      id: 'product_specification_brief', title: 'Product Specification Brief', category: 'product_definition', phase: 'define_validate', priority: 98,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('product_specification_brief'), applicable: generalPhysicalValidation,
      reason: 'Turn the early concept into explicit specification decisions and test methods without inventing materials, dimensions, performance, or safety claims.',
      exclusionReason: 'A general physical product at idea stage is required.', direction: groundedFoundationDirection
    },
    {
      id: 'product_positioning', title: isService ? 'Service Positioning' : 'Product Positioning', category: 'foundation', phase: generalPhysicalValidation ? 'define_validate' : 'foundation', priority: generalPhysicalValidation ? 97 : 99,
      recommendationLevel: validateProduct ? 'recommended' : 'essential', dependencies: generalPhysicalValidation
        ? [...minimumProductionDependencies('product_positioning'), 'product_concept_brief', 'product_specification_brief']
        : validateProduct ? [...minimumProductionDependencies('product_positioning'), 'product_concept_brief'] : minimumProductionDependencies('product_positioning'), applicable: true,
      reason: validateProduct
        ? 'Develop a provisional positioning hypothesis to test before treating the product or market position as finalized.'
        : 'Positioning establishes how this offer should be understood before channel or launch assets are created.', direction: groundedFoundationDirection
    },
    {
      id: 'value_proposition', title: 'Value Proposition', category: 'foundation', phase: generalPhysicalValidation ? 'define_validate' : 'foundation', priority: generalPhysicalValidation ? 96 : 98,
      recommendationLevel: validateProduct ? 'recommended' : 'essential', dependencies: minimumProductionDependencies('value_proposition'), applicable: true,
      reason: validateProduct
        ? 'Frame a value hypothesis to validate while proof, differentiation, and the product definition remain open.'
        : 'The value proposition translates the confirmed customer motivation into a clear reason to choose the offer.', direction: groundedFoundationDirection
    },
    {
      id: 'validation_plan', title: generalPhysicalValidation ? 'Market Validation Plan' : 'Validation Plan', category: 'foundation', phase: generalPhysicalValidation ? 'define_validate' : 'foundation', priority: generalPhysicalValidation ? 95 : 96,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('validation_plan'), applicable: validateProduct,
      reason: 'Convert the open customer, concept, positioning, and value assumptions into practical questions and evidence-gathering steps before launch execution.',
      exclusionReason: 'A Validation Plan is reserved for physical products that are still validating the opportunity.', direction: validationDirection
    },
    {
      id: 'prototype_sample_validation_plan', title: 'Prototype & Sample Validation Plan', category: 'feasibility', phase: 'feasibility', priority: 94,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('prototype_sample_validation_plan'), applicable: generalPhysicalValidation,
      reason: 'Define how prototypes and supplier samples will be evaluated against the specification before committing to inventory.',
      exclusionReason: 'A general physical product at idea stage is required.', direction: groundedFoundationDirection
    },
    {
      id: 'sourcing_manufacturer_brief', title: 'Sourcing & Manufacturer Brief', category: 'feasibility', phase: 'feasibility', priority: 93,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('sourcing_manufacturer_brief'), applicable: generalPhysicalValidation,
      reason: 'Prepare supplier evaluation criteria and an RFQ checklist without inventing manufacturers, prices, lead times, or capabilities.',
      exclusionReason: 'A general physical product at idea stage is required.', direction: groundedFoundationDirection
    },
    {
      id: 'compliance_evidence_checklist', title: 'Compliance & Evidence Checklist', category: 'feasibility', phase: 'feasibility', priority: 92,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('compliance_evidence_checklist'), applicable: generalPhysicalValidation,
      reason: 'Identify product, material, labeling, testing, and documentation questions that require qualified review before claims or sale.',
      exclusionReason: 'A general physical product at idea stage is required.', direction: groundedFoundationDirection
    },
    {
      id: 'unit_economics_pricing_model', title: 'Unit Economics & Pricing Model', category: 'feasibility', phase: 'feasibility', priority: 91,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('unit_economics_pricing_model'), applicable: generalPhysicalValidation,
      reason: 'Provide a decision model for price, landed cost, fees, returns, acquisition allowance, and contribution margin without inventing inputs.',
      exclusionReason: 'A general physical product at idea stage is required.', direction: groundedFoundationDirection
    },
    {
      id: 'packaging_shipping_requirements', title: 'Packaging & Shipping Requirements', category: 'operations', phase: 'operations', priority: 90,
      recommendationLevel: 'optional', dependencies: minimumProductionDependencies('packaging_shipping_requirements'), applicable: generalPhysicalValidation,
      reason: 'Define packaging protection, labeling, parcel, and shipping decisions after the product specification and compliance questions are established.',
      exclusionReason: 'A general physical product at idea stage is required.', direction: groundedFoundationDirection
    },
    {
      id: 'inventory_fulfillment_plan', title: 'Inventory & Fulfillment Plan', category: 'operations', phase: 'operations', priority: 89,
      recommendationLevel: 'optional', dependencies: minimumProductionDependencies('inventory_fulfillment_plan'), applicable: generalPhysicalValidation,
      reason: 'Plan order quantities, receiving, storage, fulfillment, replenishment, returns, and operational readiness from validated supplier and economics inputs.',
      exclusionReason: 'A general physical product at idea stage is required.', direction: groundedFoundationDirection
    },
    {
      id: 'core_messaging', title: 'Core Messaging', category: 'foundation', phase: 'foundation', priority: 97,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('core_messaging'), applicable: !validateProduct,
      reason: 'Core messaging gives every sales-channel and launch asset one coherent strategic voice.', direction: groundedChannelDirection
    },
    {
      id: 'amazon_listing', title: 'Amazon Listing Draft', category: 'sales_channel', phase: 'sales_channel', priority: 92,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('amazon_listing'), applicable: isAmazon && productExecutionReady,
      reason: 'Amazon is the confirmed sales channel, so the listing is the primary conversion asset.',
      exclusionReason: 'Amazon is not the confirmed sales channel.', direction: groundedChannelDirection
    },
    {
      id: 'amazon_bullet_points', title: 'Amazon Bullet Point Drafts', category: 'sales_channel', phase: 'sales_channel', priority: 90,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('amazon_bullet_points'), applicable: isAmazon && productExecutionReady,
      reason: 'Amazon bullet points make the approved value and differentiation easy to scan at purchase time.',
      exclusionReason: 'Amazon is not the confirmed sales channel.', direction: groundedChannelDirection
    },
    {
      id: 'amazon_keyword_guidance', title: 'Amazon Search & Keyword Guidance', category: 'sales_channel', phase: 'sales_channel', priority: 87,
      recommendationLevel: 'recommended', dependencies: validateProduct
        ? ['product_concept_brief', 'product_positioning']
        : developProduct ? ['product_positioning'] : ['amazon_listing'], applicable: isAmazon,
      reason: (validateProduct || developProduct)
        ? 'Develop search-direction and marketplace-term hypotheses to investigate; these are not measured Amazon research or evidence.'
        : 'The confirmed Amazon channel requires marketplace-specific discovery guidance.',
      exclusionReason: 'Amazon is not the confirmed sales channel.',
      direction: (validateProduct || developProduct)
        ? `${foundationDirection} · Explore marketplace terms as hypotheses to validate, not measured demand or competition data.`
        : groundedChannelDirection
    },
    {
      id: 'amazon_a_plus', title: 'Amazon A+ Content Draft', category: 'sales_channel', phase: 'sales_channel', priority: 78,
      recommendationLevel: 'optional', dependencies: minimumProductionDependencies('amazon_a_plus'), applicable: isAmazon && brand === 'established' && productExecutionReady,
      reason: 'Amazon and an established brand are confirmed, making enhanced brand content contextually appropriate.',
      exclusionReason: !isAmazon ? 'Amazon is not the confirmed sales channel.' : 'An established brand context required for A+ Content is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'ecommerce_product_page', title: 'Ecommerce Product Page Draft', category: 'sales_channel', phase: 'sales_channel', priority: 92,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('ecommerce_product_page'), applicable: isOwnedStore && !isService && !isSoftware && productExecutionReady,
      reason: 'An owned ecommerce store is confirmed, so the product page is the primary conversion asset.',
      exclusionReason: !isOwnedStore ? 'An owned ecommerce store is not the confirmed sales channel.' : 'A product-selling context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'ecommerce_trust_faq', title: 'FAQ & Trust Content Draft', category: 'sales_channel', phase: 'sales_channel', priority: 85,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('ecommerce_trust_faq'), applicable: isOwnedStore && !isService && !isSoftware && productExecutionReady,
      reason: 'Owned-store customers need clear answers and trust signals before checkout.',
      exclusionReason: !isOwnedStore ? 'An owned ecommerce store is not the confirmed sales channel.' : 'A product-selling context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'ecommerce_conversion_copy', title: 'Ecommerce Conversion Copy Draft', category: 'sales_channel', phase: 'sales_channel', priority: 82,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('ecommerce_conversion_copy'), applicable: isOwnedStore && !isService && !isSoftware && productExecutionReady,
      reason: 'The confirmed owned-store context supports copy that guides customers toward its direct checkout.',
      exclusionReason: !isOwnedStore ? 'A direct ecommerce checkout context is not confirmed.' : 'A product-selling context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'abandoned_cart_email', title: 'Abandoned Cart Email Draft', category: 'sales_channel', phase: 'sales_channel', priority: 72,
      recommendationLevel: 'optional', dependencies: minimumProductionDependencies('abandoned_cart_email'), applicable: isOwnedStore && !isService && !isSoftware && productExecutionReady,
      reason: 'The confirmed direct ecommerce context supports checkout-recovery messaging.',
      exclusionReason: 'A confirmed direct ecommerce checkout context is required.', direction: groundedChannelDirection
    },
    {
      id: 'google_business_profile', title: 'Google Business Profile Draft', category: 'sales_channel', phase: 'sales_channel', priority: 91,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('google_business_profile'), applicable: isLocalService,
      reason: 'The confirmed local-service context makes local search visibility a primary route to customers.',
      exclusionReason: 'An applicable local-service context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'service_page', title: 'Service Page Draft', category: 'sales_channel', phase: 'sales_channel', priority: 88,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('service_page'), applicable: isService && (isOwnedStore || isLocalService),
      reason: 'The confirmed service context needs a clear page that explains the offer, trust, and next action.',
      exclusionReason: 'An applicable direct or local service context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'product_image_guidance', title: 'Product Image Guidance', category: 'sales_channel', phase: 'sales_channel', priority: 80,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('product_image_guidance'), applicable: isPhysicalProduct && productExecutionReady,
      reason: 'A physical product requires imagery that communicates its positioning and purchase value.',
      exclusionReason: 'A physical product is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'software_product_demo', title: 'Software Product Demonstration Outline', category: 'sales_channel', phase: 'sales_channel', priority: 89,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('software_product_demo'), applicable: isSoftware,
      reason: 'The confirmed software context benefits from showing the workflow and outcome directly.',
      exclusionReason: 'A software or SaaS business is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'saas_trial_emails', title: 'SaaS Trial Email Drafts', category: 'launch', phase: 'launch', priority: 82,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('saas_trial_emails'), applicable: hasTrialContext,
      reason: 'The approved software strategy includes a trial, making guided trial communication appropriate.',
      exclusionReason: 'Both a software business and an approved trial context are required.', direction: groundedLaunchDirection
    },
    {
      id: 'launch_announcement', title: 'Launch Announcement', category: 'launch', phase: 'launch', priority: 86,
      recommendationLevel: 'essential', dependencies: minimumProductionDependencies('launch_announcement'), applicable: !isPhysicalProduct || productExecutionReady,
      reason: 'A launch objective requires one clear announcement grounded in the approved core message.', direction: groundedLaunchDirection
    },
    {
      id: 'social_launch_campaign', title: 'Social Launch Campaign', category: 'launch', phase: 'launch', priority: 76,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('social_launch_campaign'), applicable: !isPhysicalProduct || productExecutionReady,
      reason: 'A coordinated social sequence can reinforce the launch story without changing the approved strategy.', direction: groundedLaunchDirection
    },
    {
      id: 'educational_content', title: 'Educational Launch Content', category: 'launch', phase: 'launch', priority: 79,
      recommendationLevel: 'recommended', dependencies: minimumProductionDependencies('educational_content'),
      applicable: (!isPhysicalProduct || productExecutionReady)
        && /education|evidence|demonstration|trust/i.test(`${strategyValue(strategyResult, 'marketingFocus') || ''} ${strategyValue(strategyResult, 'launchApproach') || ''}`),
      reason: 'The approved strategy calls for education, evidence, demonstration, or trust-building before promotion.',
      exclusionReason: 'The approved strategy does not currently prioritize educational or trust-building content.', direction: groundedLaunchDirection
    }
  ];

  const applicable = [];
  const exclusions = [];
  candidates.forEach(function(candidate) {
    if (candidate.applicable) applicable.push(deliverable(candidate, candidate.direction));
    else exclusions.push(exclusion(candidate, candidate.exclusionReason));
  });

  const phases = generalPhysicalValidation
    ? PHYSICAL_PRODUCT_VALIDATION_PHASES
    : validateProduct ? VALIDATE_PHASES : EXECUTION_PHASES;
  const phaseResults = phases.map(function(phase) {
    return {
      ...phase,
      deliverables: applicable
        .filter(function(item) { return item.phase === phase.id; })
        .sort(function(left, right) { return right.priority - left.priority; })
    };
  }).filter(function(phase) { return phase.deliverables.length; });

  const channelLabel = fieldLabel(confirmedUnderstanding, 'salesChannel');
  const businessLabel = fieldLabel(confirmedUnderstanding, 'businessType');
  const channelPhrase = channelLabel
    ? `prepares your confirmed ${channelLabel} sales channel`
    : 'uses channel-neutral recommendations because no sales channel is confirmed';
  let whyThisPlan = `This plan establishes the ${businessLabel || 'business'} foundation first, then ${channelPhrase}, and finally sequences launch promotion around the approved strategy.`;
  if (validateProduct) {
    const explorationSummary = isAmazon
      ? 'identifies Amazon search directions worth investigating'
      : 'identifies market-entry questions worth investigating';
    whyThisPlan = generalPhysicalValidation
      ? 'This plan validates the opportunity, defines the physical product, tests feasibility and economics, and prepares operations before product pages, imagery, or launch campaigns are created.'
      : `This plan validates the opportunity before launch execution. It clarifies the customer, tests initial positioning and value hypotheses, and ${explorationSummary} before product and launch assets are created.`;
  } else if (developProduct) {
    whyThisPlan = `This plan develops the ${businessLabel || 'product'} foundation and messaging while deferring launch-ready product and promotion assets until the offer is ready to sell.`;
  }

  return {
    objective,
    planningStage,
    phases: phaseResults,
    exclusions,
    summary: {
      deliverableCount: applicable.length,
      estimatedCredits: null,
      estimatedTime: null,
      whyThisPlan
    },
    readiness: { ready: true, reason: null }
  };
}

module.exports = {
  buildPlan,
  derivePlanningStage
};
