const PHASES = [
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

function directionFrom(strategyResult, keys, fallback) {
  const directions = keys.map(function(key) {
    return strategyValue(strategyResult, key);
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

  const businessType = normalizedField(confirmedUnderstanding, 'businessType');
  const industry = normalizedField(confirmedUnderstanding, 'industry');
  const category = normalizedField(confirmedUnderstanding, 'category');
  const salesChannel = normalizedField(confirmedUnderstanding, 'salesChannel');
  const targetAudience = normalizedField(confirmedUnderstanding, 'targetAudience');
  const brand = normalizedField(confirmedUnderstanding, 'brand');
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

  const foundationDirection = directionFrom(
    strategyResult,
    ['marketPosition', 'primaryCustomer', 'customerMotivation'],
    'Clarify the confirmed customer, value, and market position before producing execution assets.'
  );
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

  const candidates = [
    {
      id: 'customer_profile', title: 'Customer Profile', category: 'foundation', phase: 'foundation', priority: 100,
      recommendationLevel: 'essential', dependencies: [], applicable: true,
      reason: 'A clear customer profile keeps every later recommendation focused on the confirmed audience.', direction: foundationDirection
    },
    {
      id: 'product_positioning', title: isService ? 'Service Positioning' : 'Product Positioning', category: 'foundation', phase: 'foundation', priority: 99,
      recommendationLevel: 'essential', dependencies: ['customer_profile'], applicable: true,
      reason: 'Positioning establishes how this offer should be understood before channel or launch assets are created.', direction: foundationDirection
    },
    {
      id: 'value_proposition', title: 'Value Proposition', category: 'foundation', phase: 'foundation', priority: 98,
      recommendationLevel: 'essential', dependencies: ['customer_profile', 'product_positioning'], applicable: true,
      reason: 'The value proposition translates the confirmed customer motivation into a clear reason to choose the offer.', direction: foundationDirection
    },
    {
      id: 'core_messaging', title: 'Core Messaging', category: 'foundation', phase: 'foundation', priority: 97,
      recommendationLevel: 'essential', dependencies: ['customer_profile', 'product_positioning', 'value_proposition'], applicable: true,
      reason: 'Core messaging gives every sales-channel and launch asset one coherent strategic voice.', direction: channelDirection
    },
    {
      id: 'amazon_listing', title: 'Amazon Listing', category: 'sales_channel', phase: 'sales_channel', priority: 92,
      recommendationLevel: 'essential', dependencies: ['product_positioning', 'core_messaging'], applicable: isAmazon,
      reason: 'Amazon is the confirmed sales channel, so the listing is the primary conversion asset.',
      exclusionReason: 'Amazon is not the confirmed sales channel.', direction: channelDirection
    },
    {
      id: 'amazon_bullet_points', title: 'Amazon Bullet Points', category: 'sales_channel', phase: 'sales_channel', priority: 90,
      recommendationLevel: 'recommended', dependencies: ['amazon_listing'], applicable: isAmazon,
      reason: 'Amazon bullet points make the approved value and differentiation easy to scan at purchase time.',
      exclusionReason: 'Amazon is not the confirmed sales channel.', direction: channelDirection
    },
    {
      id: 'amazon_keyword_guidance', title: 'Amazon Search & Keyword Guidance', category: 'sales_channel', phase: 'sales_channel', priority: 87,
      recommendationLevel: 'recommended', dependencies: ['amazon_listing'], applicable: isAmazon,
      reason: 'The confirmed Amazon channel requires marketplace-specific discovery guidance.',
      exclusionReason: 'Amazon is not the confirmed sales channel.', direction: channelDirection
    },
    {
      id: 'amazon_a_plus', title: 'Amazon A+ Content', category: 'sales_channel', phase: 'sales_channel', priority: 78,
      recommendationLevel: 'optional', dependencies: ['amazon_listing', 'core_messaging'], applicable: isAmazon && brand === 'established',
      reason: 'Amazon and an established brand are confirmed, making enhanced brand content contextually appropriate.',
      exclusionReason: !isAmazon ? 'Amazon is not the confirmed sales channel.' : 'An established brand context required for A+ Content is not confirmed.', direction: channelDirection
    },
    {
      id: 'ecommerce_product_page', title: 'Ecommerce Product Page', category: 'sales_channel', phase: 'sales_channel', priority: 92,
      recommendationLevel: 'essential', dependencies: ['product_positioning', 'core_messaging'], applicable: isOwnedStore && !isService,
      reason: 'An owned ecommerce store is confirmed, so the product page is the primary conversion asset.',
      exclusionReason: !isOwnedStore ? 'An owned ecommerce store is not the confirmed sales channel.' : 'A product-selling context is not confirmed.', direction: channelDirection
    },
    {
      id: 'ecommerce_trust_faq', title: 'FAQ & Trust Content', category: 'sales_channel', phase: 'sales_channel', priority: 85,
      recommendationLevel: 'recommended', dependencies: ['ecommerce_product_page'], applicable: isOwnedStore && !isService,
      reason: 'Owned-store customers need clear answers and trust signals before checkout.',
      exclusionReason: !isOwnedStore ? 'An owned ecommerce store is not the confirmed sales channel.' : 'A product-selling context is not confirmed.', direction: channelDirection
    },
    {
      id: 'ecommerce_conversion_copy', title: 'Ecommerce Conversion Copy', category: 'sales_channel', phase: 'sales_channel', priority: 82,
      recommendationLevel: 'recommended', dependencies: ['ecommerce_product_page'], applicable: isOwnedStore && !isService,
      reason: 'The confirmed owned-store context supports copy that guides customers toward its direct checkout.',
      exclusionReason: !isOwnedStore ? 'A direct ecommerce checkout context is not confirmed.' : 'A product-selling context is not confirmed.', direction: channelDirection
    },
    {
      id: 'abandoned_cart_email', title: 'Abandoned Cart Email', category: 'sales_channel', phase: 'sales_channel', priority: 72,
      recommendationLevel: 'optional', dependencies: ['ecommerce_product_page', 'core_messaging'], applicable: isOwnedStore && !isService,
      reason: 'The confirmed direct ecommerce context supports checkout-recovery messaging.',
      exclusionReason: 'A confirmed direct ecommerce checkout context is required.', direction: channelDirection
    },
    {
      id: 'google_business_profile', title: 'Google Business Profile', category: 'sales_channel', phase: 'sales_channel', priority: 91,
      recommendationLevel: 'essential', dependencies: ['core_messaging'], applicable: isLocalService,
      reason: 'The confirmed local-service context makes local search visibility a primary route to customers.',
      exclusionReason: 'An applicable local-service context is not confirmed.', direction: channelDirection
    },
    {
      id: 'service_page', title: 'Service Page', category: 'sales_channel', phase: 'sales_channel', priority: 88,
      recommendationLevel: 'essential', dependencies: ['product_positioning', 'core_messaging'], applicable: isService && (isOwnedStore || isLocalService),
      reason: 'The confirmed service context needs a clear page that explains the offer, trust, and next action.',
      exclusionReason: 'An applicable direct or local service context is not confirmed.', direction: channelDirection
    },
    {
      id: 'product_image_guidance', title: 'Product Image Guidance', category: 'sales_channel', phase: 'sales_channel', priority: 80,
      recommendationLevel: 'recommended', dependencies: ['product_positioning'], applicable: isPhysicalProduct,
      reason: 'A physical product requires imagery that communicates its positioning and purchase value.',
      exclusionReason: 'A physical product is not confirmed.', direction: channelDirection
    },
    {
      id: 'software_product_demo', title: 'Software Product Demonstration', category: 'sales_channel', phase: 'sales_channel', priority: 89,
      recommendationLevel: 'essential', dependencies: ['core_messaging'], applicable: isSoftware,
      reason: 'The confirmed software context benefits from showing the workflow and outcome directly.',
      exclusionReason: 'A software or SaaS business is not confirmed.', direction: channelDirection
    },
    {
      id: 'saas_trial_emails', title: 'SaaS Trial Emails', category: 'launch', phase: 'launch', priority: 82,
      recommendationLevel: 'recommended', dependencies: ['software_product_demo', 'core_messaging'], applicable: hasTrialContext,
      reason: 'The approved software strategy includes a trial, making guided trial communication appropriate.',
      exclusionReason: 'Both a software business and an approved trial context are required.', direction: launchDirection
    },
    {
      id: 'launch_announcement', title: 'Launch Announcement', category: 'launch', phase: 'launch', priority: 86,
      recommendationLevel: 'essential', dependencies: ['core_messaging'], applicable: true,
      reason: 'A launch objective requires one clear announcement grounded in the approved core message.', direction: launchDirection
    },
    {
      id: 'social_launch_campaign', title: 'Social Launch Campaign', category: 'launch', phase: 'launch', priority: 76,
      recommendationLevel: 'recommended', dependencies: ['core_messaging', 'launch_announcement'], applicable: true,
      reason: 'A coordinated social sequence can reinforce the launch story without changing the approved strategy.', direction: launchDirection
    },
    {
      id: 'educational_content', title: 'Educational Launch Content', category: 'launch', phase: 'launch', priority: 79,
      recommendationLevel: 'recommended', dependencies: ['core_messaging'],
      applicable: /education|evidence|demonstration|trust/i.test(`${strategyValue(strategyResult, 'marketingFocus') || ''} ${strategyValue(strategyResult, 'launchApproach') || ''}`),
      reason: 'The approved strategy calls for education, evidence, demonstration, or trust-building before promotion.',
      exclusionReason: 'The approved strategy does not currently prioritize educational or trust-building content.', direction: launchDirection
    }
  ];

  const applicable = [];
  const exclusions = [];
  candidates.forEach(function(candidate) {
    if (candidate.applicable) applicable.push(deliverable(candidate, candidate.direction));
    else exclusions.push(exclusion(candidate, candidate.exclusionReason));
  });

  const phaseResults = PHASES.map(function(phase) {
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
  const whyThisPlan = `This plan establishes the ${businessLabel || 'business'} foundation first, then ${channelPhrase}, and finally sequences launch promotion around the approved strategy.`;

  return {
    objective,
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
  buildPlan
};
