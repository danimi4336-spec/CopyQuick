const { evaluateRequirements, isMeaningfullyReady } = require('./discoveryRequirements');

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
  const targetAudience = normalizedField(confirmedUnderstanding, 'targetAudience');
  const brand = normalizedField(confirmedUnderstanding, 'brand');
  const conceptMaturity = normalizedField(confirmedUnderstanding, 'conceptMaturity');
  const launchStage = normalizedField(confirmedUnderstanding, 'launchStage');
  const isPhysicalProduct = businessType === 'physical_product';
  const isService = businessType === 'service';
  const isSoftware = businessType === 'software';
  const isAmazon = salesChannel === 'amazon';
  const isOwnedStore = salesChannel === 'own_website';
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
  const groundedFoundationDirection = productContextDirection
    ? `${foundationDirection} · ${productContextDirection}`
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
  const groundedChannelDirection = productContextDirection
    ? `${channelDirection} · ${productContextDirection}`
    : channelDirection;
  const groundedLaunchDirection = productContextDirection
    ? `${launchDirection} · ${productContextDirection}`
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
      id: 'customer_profile', title: 'Customer Profile', category: 'foundation', phase: 'foundation', priority: 100,
      recommendationLevel: 'essential', dependencies: [], applicable: true,
      reason: 'A clear customer profile keeps every later recommendation focused on the confirmed audience.', direction: groundedFoundationDirection
    },
    {
      id: 'product_concept_brief', title: 'Product Concept Brief', category: 'foundation', phase: 'foundation', priority: 99,
      recommendationLevel: 'essential', dependencies: ['customer_profile'], applicable: validateProduct,
      reason: 'Turn the builder’s exploration choices into a clear working concept brief while keeping formulation, claims, and proof explicitly unresolved.',
      exclusionReason: 'A Product Concept Brief is reserved for physical products that are still validating the opportunity.', direction: validationDirection
    },
    {
      id: 'product_positioning', title: isService ? 'Service Positioning' : 'Product Positioning', category: 'foundation', phase: 'foundation', priority: 99,
      recommendationLevel: validateProduct ? 'recommended' : 'essential', dependencies: validateProduct ? ['customer_profile', 'product_concept_brief'] : ['customer_profile'], applicable: true,
      reason: validateProduct
        ? 'Develop a provisional positioning hypothesis to test before treating the product or market position as finalized.'
        : 'Positioning establishes how this offer should be understood before channel or launch assets are created.', direction: groundedFoundationDirection
    },
    {
      id: 'value_proposition', title: 'Value Proposition', category: 'foundation', phase: 'foundation', priority: 98,
      recommendationLevel: validateProduct ? 'recommended' : 'essential', dependencies: ['customer_profile', 'product_positioning'], applicable: true,
      reason: validateProduct
        ? 'Frame a value hypothesis to validate while proof, differentiation, and the product definition remain open.'
        : 'The value proposition translates the confirmed customer motivation into a clear reason to choose the offer.', direction: groundedFoundationDirection
    },
    {
      id: 'validation_plan', title: 'Validation Plan', category: 'foundation', phase: 'foundation', priority: 96,
      recommendationLevel: 'recommended', dependencies: ['customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition'], applicable: validateProduct,
      reason: 'Convert the open customer, concept, positioning, and value assumptions into practical questions and evidence-gathering steps before launch execution.',
      exclusionReason: 'A Validation Plan is reserved for physical products that are still validating the opportunity.', direction: validationDirection
    },
    {
      id: 'core_messaging', title: 'Core Messaging', category: 'foundation', phase: 'foundation', priority: 97,
      recommendationLevel: 'essential', dependencies: ['customer_profile', 'product_positioning', 'value_proposition'], applicable: !validateProduct,
      reason: 'Core messaging gives every sales-channel and launch asset one coherent strategic voice.', direction: groundedChannelDirection
    },
    {
      id: 'amazon_listing', title: 'Amazon Listing Draft', category: 'sales_channel', phase: 'sales_channel', priority: 92,
      recommendationLevel: 'essential', dependencies: ['product_positioning', 'core_messaging'], applicable: isAmazon && productExecutionReady,
      reason: 'Amazon is the confirmed sales channel, so the listing is the primary conversion asset.',
      exclusionReason: 'Amazon is not the confirmed sales channel.', direction: groundedChannelDirection
    },
    {
      id: 'amazon_bullet_points', title: 'Amazon Bullet Point Drafts', category: 'sales_channel', phase: 'sales_channel', priority: 90,
      recommendationLevel: 'recommended', dependencies: ['amazon_listing'], applicable: isAmazon && productExecutionReady,
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
      id: 'amazon_a_plus', title: 'Amazon A+ Content', category: 'sales_channel', phase: 'sales_channel', priority: 78,
      recommendationLevel: 'optional', dependencies: ['amazon_listing', 'core_messaging'], applicable: isAmazon && brand === 'established' && productExecutionReady,
      reason: 'Amazon and an established brand are confirmed, making enhanced brand content contextually appropriate.',
      exclusionReason: !isAmazon ? 'Amazon is not the confirmed sales channel.' : 'An established brand context required for A+ Content is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'ecommerce_product_page', title: 'Ecommerce Product Page', category: 'sales_channel', phase: 'sales_channel', priority: 92,
      recommendationLevel: 'essential', dependencies: ['product_positioning', 'core_messaging'], applicable: isOwnedStore && !isService && productExecutionReady,
      reason: 'An owned ecommerce store is confirmed, so the product page is the primary conversion asset.',
      exclusionReason: !isOwnedStore ? 'An owned ecommerce store is not the confirmed sales channel.' : 'A product-selling context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'ecommerce_trust_faq', title: 'FAQ & Trust Content', category: 'sales_channel', phase: 'sales_channel', priority: 85,
      recommendationLevel: 'recommended', dependencies: ['ecommerce_product_page'], applicable: isOwnedStore && !isService && productExecutionReady,
      reason: 'Owned-store customers need clear answers and trust signals before checkout.',
      exclusionReason: !isOwnedStore ? 'An owned ecommerce store is not the confirmed sales channel.' : 'A product-selling context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'ecommerce_conversion_copy', title: 'Ecommerce Conversion Copy', category: 'sales_channel', phase: 'sales_channel', priority: 82,
      recommendationLevel: 'recommended', dependencies: ['ecommerce_product_page'], applicable: isOwnedStore && !isService && productExecutionReady,
      reason: 'The confirmed owned-store context supports copy that guides customers toward its direct checkout.',
      exclusionReason: !isOwnedStore ? 'A direct ecommerce checkout context is not confirmed.' : 'A product-selling context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'abandoned_cart_email', title: 'Abandoned Cart Email', category: 'sales_channel', phase: 'sales_channel', priority: 72,
      recommendationLevel: 'optional', dependencies: ['ecommerce_product_page', 'core_messaging'], applicable: isOwnedStore && !isService && productExecutionReady,
      reason: 'The confirmed direct ecommerce context supports checkout-recovery messaging.',
      exclusionReason: 'A confirmed direct ecommerce checkout context is required.', direction: groundedChannelDirection
    },
    {
      id: 'google_business_profile', title: 'Google Business Profile', category: 'sales_channel', phase: 'sales_channel', priority: 91,
      recommendationLevel: 'essential', dependencies: ['core_messaging'], applicable: isLocalService,
      reason: 'The confirmed local-service context makes local search visibility a primary route to customers.',
      exclusionReason: 'An applicable local-service context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'service_page', title: 'Service Page', category: 'sales_channel', phase: 'sales_channel', priority: 88,
      recommendationLevel: 'essential', dependencies: ['product_positioning', 'core_messaging'], applicable: isService && (isOwnedStore || isLocalService),
      reason: 'The confirmed service context needs a clear page that explains the offer, trust, and next action.',
      exclusionReason: 'An applicable direct or local service context is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'product_image_guidance', title: 'Product Image Guidance', category: 'sales_channel', phase: 'sales_channel', priority: 80,
      recommendationLevel: 'recommended', dependencies: ['product_positioning'], applicable: isPhysicalProduct && productExecutionReady,
      reason: 'A physical product requires imagery that communicates its positioning and purchase value.',
      exclusionReason: 'A physical product is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'software_product_demo', title: 'Software Product Demonstration', category: 'sales_channel', phase: 'sales_channel', priority: 89,
      recommendationLevel: 'essential', dependencies: ['core_messaging'], applicable: isSoftware,
      reason: 'The confirmed software context benefits from showing the workflow and outcome directly.',
      exclusionReason: 'A software or SaaS business is not confirmed.', direction: groundedChannelDirection
    },
    {
      id: 'saas_trial_emails', title: 'SaaS Trial Emails', category: 'launch', phase: 'launch', priority: 82,
      recommendationLevel: 'recommended', dependencies: ['software_product_demo', 'core_messaging'], applicable: hasTrialContext,
      reason: 'The approved software strategy includes a trial, making guided trial communication appropriate.',
      exclusionReason: 'Both a software business and an approved trial context are required.', direction: groundedLaunchDirection
    },
    {
      id: 'launch_announcement', title: 'Launch Announcement', category: 'launch', phase: 'launch', priority: 86,
      recommendationLevel: 'essential', dependencies: ['core_messaging'], applicable: !isPhysicalProduct || productExecutionReady,
      reason: 'A launch objective requires one clear announcement grounded in the approved core message.', direction: groundedLaunchDirection
    },
    {
      id: 'social_launch_campaign', title: 'Social Launch Campaign', category: 'launch', phase: 'launch', priority: 76,
      recommendationLevel: 'recommended', dependencies: ['core_messaging', 'launch_announcement'], applicable: !isPhysicalProduct || productExecutionReady,
      reason: 'A coordinated social sequence can reinforce the launch story without changing the approved strategy.', direction: groundedLaunchDirection
    },
    {
      id: 'educational_content', title: 'Educational Launch Content', category: 'launch', phase: 'launch', priority: 79,
      recommendationLevel: 'recommended', dependencies: ['core_messaging'],
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

  const phases = validateProduct ? VALIDATE_PHASES : EXECUTION_PHASES;
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
    whyThisPlan = `This plan validates the opportunity before launch execution. It clarifies the customer, tests initial positioning and value hypotheses, and ${explorationSummary} before product and launch assets are created.`;
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
