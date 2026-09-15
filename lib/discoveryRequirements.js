const DISCOVERY_POLICY_VERSION = 4;
const SETTLED_CONFIDENCE = 0.7;

const QUESTION_CATALOG = {
  service_definition: { understandingField: 'serviceDefinition', prompt: 'What service do you want to promote?', explanation: 'Describe what is included and the client situation it addresses.', type: 'free_text', placeholder: 'Describe the service and what a client receives.', allowsUnsure: false },
  service_client: { understandingField: 'targetAudience', prompt: 'Who is the best-fit client for this service?', explanation: 'A specific client definition keeps positioning and outreach relevant.', type: 'free_text', placeholder: 'Describe the ideal client and their situation.', allowsUnsure: true },
  service_problem: { understandingField: 'clientProblem', prompt: 'What problem or priority brings this client to you?', explanation: 'Use observed client language where available; assumptions remain hypotheses.', type: 'free_text', placeholder: 'Describe the client problem or desired outcome.', allowsUnsure: true },
  service_expertise: { understandingField: 'serviceExpertise', prompt: 'What expertise, credentials, or proof is established?', explanation: 'Only include credentials, results, testimonials, or case studies that can be substantiated.', type: 'free_text', placeholder: 'List established proof and its source, or choose unsure.', allowsUnsure: true },
  service_difference: { understandingField: 'serviceDifferentiation', prompt: 'Why might a client choose this service?', explanation: 'This can be a hypothesis; CopyQuick will not treat it as proven superiority.', type: 'free_text', placeholder: 'Describe a meaningful difference to validate.', allowsUnsure: true },
  service_offer: { understandingField: 'serviceOffer', prompt: 'How is the service currently packaged or priced?', explanation: 'Share supplied offer details; pricing may remain open.', type: 'free_text', placeholder: 'Describe scope, format, pricing, or the next sales step.', allowsUnsure: true },
  service_market: { understandingField: 'serviceMarket', prompt: 'Where can you serve clients?', explanation: 'Describe local, regional, remote, or other confirmed delivery boundaries.', type: 'free_text', placeholder: 'For example: remote across the United States.', allowsUnsure: true },
  service_channel: { understandingField: 'serviceChannel', prompt: 'Which acquisition channel should this plan support first?', explanation: 'Choose an actual or test channel; effectiveness will not be assumed.', options: [['referrals', 'Referrals'], ['organic_search', 'Organic search or content'], ['social', 'Social media'], ['paid_ads', 'Paid advertising'], ['outbound', 'Outbound outreach'], ['mixed_channels', 'A mix of channels'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]] },
  service_constraints: { understandingField: 'serviceConstraints', prompt: 'What constraints or existing assets should the plan respect?', explanation: 'Include capacity, compliance, geography, time, or existing marketing materials.', type: 'free_text', placeholder: 'Describe constraints and reusable assets.', allowsUnsure: true },
  brand_business: { understandingField: 'brandBusiness', prompt: 'What business, product, or service should this brand represent?', explanation: 'Describe the offer and category as they exist today.', type: 'free_text', placeholder: 'Describe the business, offer, and market category.', allowsUnsure: false },
  brand_audience: { understandingField: 'targetAudience', prompt: 'Who should this brand matter to?', explanation: 'Describe the priority audience without assuming they already prefer the brand.', type: 'free_text', placeholder: 'Describe the priority customer.', allowsUnsure: true },
  brand_state: { understandingField: 'existingBrand', prompt: 'What brand foundation already exists?', explanation: 'Share established names, positioning, visuals, language, or choose unsure.', type: 'free_text', placeholder: 'Describe established brand elements and open decisions.', allowsUnsure: true },
  brand_difference: { understandingField: 'brandDifferentiation', prompt: 'What meaningful difference should the brand explore?', explanation: 'This may remain a hypothesis until customers or evidence support it.', type: 'free_text', placeholder: 'Describe known proof or a differentiation hypothesis.', allowsUnsure: true },
  brand_values: { understandingField: 'brandValues', prompt: 'Which values or principles should guide the brand?', explanation: 'Include only principles the business is prepared to uphold.', type: 'free_text', placeholder: 'For example: clarity, accessibility, and practical expertise.', allowsUnsure: true },
  brand_voice: { understandingField: 'brandVoice', prompt: 'How should the brand sound?', explanation: 'Describe personality and voice, including anything it should avoid.', type: 'free_text', placeholder: 'For example: clear and warm, never flippant or overpromising.', allowsUnsure: true },
  brand_proof: { understandingField: 'brandProof', prompt: 'What proof or credibility can the brand honestly use?', explanation: 'Do not add testimonials, credentials, results, or customer counts that are not established.', type: 'free_text', placeholder: 'List established proof and its source, or choose unsure.', allowsUnsure: true },
  brand_constraints: { understandingField: 'brandConstraints', prompt: 'What constraints should the brand work respect?', explanation: 'Include legal, category, naming, legacy, or usage constraints.', type: 'free_text', placeholder: 'Describe constraints or choose unsure.', allowsUnsure: true },
  search_site: { understandingField: 'websiteContext', prompt: 'What website, business, product, or service should this search plan support?', explanation: 'Describe what the site offers and the pages or sections that already exist.', type: 'free_text', placeholder: 'Describe the website, offer, and current content.', allowsUnsure: false },
  search_audience: { understandingField: 'targetAudience', prompt: 'Who should find this business through search?', explanation: 'A defined audience helps connect search intent to useful content.', type: 'free_text', placeholder: 'Describe the priority customer or searcher.', allowsUnsure: true },
  search_goal: { understandingField: 'searchGoal', prompt: 'What should organic search help the business achieve?', explanation: 'Choose the primary outcome without assuming rankings or traffic already exist.', options: [['qualified_leads', 'Generate qualified leads'], ['sales', 'Support online sales'], ['local_visibility', 'Improve local discovery'], ['education', 'Build topical authority through education'], ['brand_discovery', 'Increase relevant brand discovery'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]] },
  search_content: { understandingField: 'existingContent', prompt: 'What relevant content exists today?', explanation: 'Describe confirmed pages or content. CopyQuick will not infer a crawl or content inventory.', type: 'free_text', placeholder: 'For example: five service pages and a monthly blog.', allowsUnsure: true },
  search_market: { understandingField: 'geographicMarket', prompt: 'Is there a geographic market this search plan should prioritize?', explanation: 'Local or regional context is optional and will remain open if unknown.', type: 'free_text', placeholder: 'For example: Toronto and the surrounding area.', allowsUnsure: true },
  search_keywords: { understandingField: 'suppliedKeywords', prompt: 'Which keywords, topics, or customer questions do you already know?', explanation: 'Only provide terms you have observed or want to investigate; no search volume will be assumed.', type: 'free_text', placeholder: 'List supplied topics, terms, or customer questions.', allowsUnsure: true },
  search_evidence: { understandingField: 'searchEvidence', prompt: 'What search evidence is actually available?', explanation: 'Share sourced rankings, analytics, or research if available. Unknown metrics will stay unknown.', type: 'free_text', placeholder: 'Name the source and date for any supplied evidence.', allowsUnsure: true },
  search_constraints: { understandingField: 'technicalLimitations', prompt: 'What technical or publishing constraints should the plan respect?', explanation: 'Include known platform, access, legal, or production limitations.', type: 'free_text', placeholder: 'For example: limited CMS access and one article per month.', allowsUnsure: true },
  conversion_offer: { understandingField: 'currentOffer', prompt: 'What offer should this conversion plan improve?', explanation: 'Describe what visitors are being asked to buy, book, join, or request.', type: 'free_text', placeholder: 'Describe the offer and what the customer receives.', allowsUnsure: false },
  conversion_audience: { understandingField: 'targetAudience', prompt: 'Who is the page or funnel intended to convert?', explanation: 'A specific audience keeps recommendations relevant.', type: 'free_text', placeholder: 'For example: operations leaders at growing software companies.', allowsUnsure: true },
  conversion_traffic: { understandingField: 'trafficSource', prompt: 'Where does the current traffic primarily come from?', explanation: 'Traffic intent affects the message and next step.', options: [['paid_ads', 'Paid advertising'], ['organic_search', 'Organic search or content'], ['social', 'Social media'], ['email', 'Email'], ['referrals', 'Referrals'], ['mixed_channels', 'A mix of channels'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]] },
  conversion_funnel: { understandingField: 'funnelType', prompt: 'What action completes the current conversion?', explanation: 'Choose the primary next step this journey should improve.', options: [['purchase', 'Purchase online'], ['lead_form', 'Submit a lead form'], ['booked_call', 'Book a call or appointment'], ['trial_signup', 'Start a trial or account'], ['contact', 'Contact the business'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]] },
  conversion_page: { understandingField: 'pageExperience', prompt: 'What does the current page or funnel communicate today?', explanation: 'Share the current headline, structure, or experience and what you believe may be unclear.', type: 'free_text', placeholder: 'Describe the page, key message, sections, and any known friction.', allowsUnsure: true },
  conversion_cta: { understandingField: 'primaryCta', prompt: 'What is the current primary call to action?', explanation: 'CopyQuick will treat this as the current CTA, not proof that it performs well.', type: 'free_text', placeholder: 'For example: Book a demo.', allowsUnsure: true },
  conversion_evidence: { understandingField: 'conversionEvidence', prompt: 'What conversion evidence is actually available?', explanation: 'Provide known measurements or choose unsure. CopyQuick will never invent a baseline.', type: 'free_text', placeholder: 'For example: 42 signups from 2,100 visits last month, measured in our analytics.', allowsUnsure: true },
  conversion_friction: { understandingField: 'conversionFriction', prompt: 'What objections or friction have customers actually mentioned?', explanation: 'Use observed feedback when available; assumptions will remain hypotheses.', type: 'free_text', placeholder: 'For example: prospects ask whether setup requires technical help.', allowsUnsure: true },
  acquisition_goal: {
    understandingField: 'acquisitionGoal', prompt: 'What customer-growth result matters most right now?',
    explanation: 'Choose the result this plan should be designed to improve.',
    options: [['qualified_leads', 'More qualified leads'], ['direct_sales', 'More direct sales'], ['appointments', 'More booked appointments'], ['repeat_customers', 'More repeat customers'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  acquisition_target: {
    understandingField: 'targetAudience', prompt: 'Who is the customer you most want to win?',
    explanation: 'A focused customer definition keeps channel and message recommendations relevant.',
    type: 'free_text', placeholder: 'For example: independent retailers with 5–25 employees.', allowsUnsure: true
  },
  acquisition_channel: {
    understandingField: 'currentAcquisitionChannel', prompt: 'Where do customers come from today?',
    explanation: 'This identifies what can be improved, tested, or complemented.',
    options: [['referrals', 'Referrals'], ['organic_search', 'Organic search or content'], ['social', 'Social media'], ['paid_ads', 'Paid advertising'], ['outbound', 'Outbound outreach'], ['mixed_channels', 'A mix of channels'], ['no_reliable_channel', 'No reliable channel yet'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  acquisition_stage: {
    understandingField: 'acquisitionStage', prompt: 'How consistent is customer acquisition today?',
    explanation: 'The plan should match your evidence and maturity rather than assume a channel already works.',
    options: [['no_reliable_channel', 'No reliable channel yet'], ['inconsistent_traction', 'Some traction, but inconsistent'], ['working_channel', 'One channel works and I want to scale it'], ['optimizing', 'The system works and needs optimization'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  sales_process: {
    understandingField: 'salesProcess', prompt: 'How does a prospect become a customer?',
    explanation: 'This determines the conversion path and calls to action the plan should support.',
    options: [['self_serve', 'They purchase online'], ['booked_call', 'They book a call or appointment'], ['sales_conversation', 'They speak with sales directly'], ['marketplace_retail', 'They purchase through a marketplace or retailer'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  capacity_readiness: {
    understandingField: 'capacityReadiness', prompt: 'Can the business serve more customers now?',
    explanation: 'Growth recommendations should respect delivery capacity and customer experience.',
    options: [['capacity_ready', 'Yes, we are ready for more customers'], ['capacity_limited', 'Capacity needs attention first'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  business_type: {
    understandingField: 'businessType',
    prompt: 'What kind of offer are you building?',
    explanation: 'This gives me the context needed to ask useful planning questions without making assumptions.',
    options: [
      ['physical_product', 'A physical product'], ['digital_product', 'A digital product'],
      ['service', 'A service'], ['software', 'Software or an app'], ['unsure', "I'm not sure yet"],
      ['other', 'Other', true]
    ]
  },
  supplement_intended_outcome: {
    understandingField: 'intendedOutcome',
    prompt: 'What is the primary wellness goal this supplement is intended to support?',
    explanation: 'Choose the closest direction for now. You can refine it later.',
    options: [
      ['everyday_wellness', 'General health & everyday wellness'], ['energy_focus', 'Energy & focus'],
      ['digestive_wellness', 'Digestive health'], ['sleep_stress_support', 'Sleep & relaxation'],
      ['mobility_active_lifestyle', 'Joint, mobility & active-lifestyle support'],
      ['immune_health', 'Immune health'], ['healthy_aging', 'Healthy aging'], ['unsure', "I'm not sure yet"],
      ['other', 'Other', true]
    ]
  },
  supplement_outcome_exploration: {
    understandingField: 'intendedOutcome',
    prompt: 'Which wellness goal feels most useful to explore first?',
    explanation: 'That’s okay — we can figure this out together. Choose the area that feels most useful to explore for now.',
    options: [
      ['steady_daily_wellness', 'Supporting a steady everyday wellness routine'],
      ['daily_energy_focus', 'Staying energized and focused through the day'],
      ['digestive_routine', 'Building a more comfortable digestive routine'],
      ['rest_stress_routine', 'Winding down and relaxing'],
      ['active_lifestyle', 'Staying active and mobile'],
      ['immune_wellness_exploration', 'Exploring immune wellness'],
      ['healthy_aging_exploration', 'Supporting wellness through healthy aging'],
      ['unsure', "I'm still not sure yet"], ['other', 'Other', true]
    ]
  },
  supplement_concept_maturity: {
    understandingField: 'conceptMaturity',
    prompt: 'How developed is the supplement idea today?',
    explanation: 'This helps CopyQuick distinguish an early concept from a product that already has formulation work behind it.',
    options: [
      ['idea_only', 'I only have the product idea'],
      ['direction_no_formula', 'I know the direction, but not the formula'],
      ['formula_in_mind', 'I have ingredients or a formula in mind'],
      ['in_development', 'A formula or product is already being developed'],
      ['finalized', 'The product is already finalized'],
      ['unsure', "I'm not sure yet"], ['other', 'Other', true]
    ]
  },
  supplement_formula_context: {
    understandingField: 'existingProductDefinition',
    prompt: 'What have you already decided about this supplement?',
    explanation: 'Share the ingredients, format, or product characteristics you already have in mind. Only include what you have actually decided.',
    type: 'free_text',
    placeholder: 'For example: a capsule concept using ingredients I am currently evaluating.',
    allowsUnsure: true
  },
  supplement_development_context: {
    understandingField: 'existingProductDefinition',
    prompt: 'What supplement is currently being developed?',
    explanation: 'Describe what is established so far and what is still changing. CopyQuick will keep unfinished details provisional.',
    type: 'free_text',
    placeholder: 'Describe the current product, format, and any established characteristics.',
    allowsUnsure: true
  },
  supplement_finalized_context: {
    understandingField: 'existingProductDefinition',
    prompt: 'What is the finished supplement product?',
    explanation: 'Describe the product as it exists today. CopyQuick will treat this as builder-provided context, not independent proof of claims.',
    type: 'free_text',
    placeholder: 'Describe the finished product, format, and established characteristics.',
    allowsUnsure: true
  },
  supplement_digestive_product_exploration: {
    understandingField: 'productExplorationDirections',
    prompt: 'What should this digestive supplement focus on?',
    explanation: "Select everything that fits your idea. If you're still deciding, choose the directions you want CopyQuick to explore with you.",
    type: 'multi_choice',
    maxSelections: 8,
    allowsAdditionalDetail: true,
    options: [
      ['microbiome_support', 'Gut microbiome support'],
      ['digestive_balance', 'Regularity & digestive balance'],
      ['bloating_comfort', 'Bloating & digestive comfort'],
      ['everyday_digestive_wellness', 'Everyday digestive wellness'],
      ['food_specific_digestion', 'Food-specific digestion support'],
      ['fiber_support', 'Fiber support'],
      ['occasional_digestive_discomfort', 'Occasional digestive discomfort'],
      ['explore_digestive_enzyme_support', 'Digestive enzyme support'],
      ['unsure', "I'm not sure yet"]
    ]
  },
  target_audience: {
    understandingField: 'targetAudience', prompt: 'Who is this product primarily for?',
    explanation: 'Knowing who you want to reach helps shape the offer, message and launch plan.',
    options: [['consumers', 'Individual consumers'], ['businesses', 'Businesses or teams'], ['professionals', 'A specific profession'], ['local_customers', 'Customers in my local area'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  customer_motivation: {
    understandingField: 'customerMotivation', prompt: 'What makes people want this product?',
    explanation: 'This clarifies the customer need or desired outcome without assuming a finished value proposition.',
    options: [['solve_problem', 'It solves a clear problem'], ['fulfill_desire', 'It fulfills a desire or aspiration'], ['convenience', 'It makes something easier or faster'], ['identity_experience', 'It offers identity, enjoyment or experience'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  sales_channel: {
    understandingField: 'salesChannel', prompt: 'Where do you plan to sell this product?',
    explanation: 'This helps tailor execution to channels you have actually chosen; it can remain open while foundation strategy develops.',
    options: [['amazon', 'Amazon'], ['own_website', 'Shopify / my own website'], ['retail', 'Retail stores'], ['multiple', 'Multiple channels'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  competitive_differentiation: {
    understandingField: 'competitiveDifferentiation', prompt: 'How different is this from products already available?',
    explanation: 'This is useful competitive context, but it can remain unresolved while the product direction develops.',
    options: [['clear', 'It has clear, meaningful differences'], ['partial', 'It is different in a few ways'], ['similar', 'It is similar to existing products'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  launch_stage: {
    understandingField: 'launchStage', prompt: 'What stage is the product in today?',
    explanation: 'This keeps the recommended next steps realistic for where you are now.',
    options: [['idea', 'Idea or early concept'], ['development', 'In development'], ['ready', 'Ready to launch'], ['selling', 'Already selling'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  supplement_launch_stage: {
    understandingField: 'launchStage', prompt: 'Where are you in the launch process?',
    explanation: 'This is about preparing to sell the product, separate from how far the product or formula has been developed.',
    options: [['idea', 'Idea or early concept'], ['development', 'In development'], ['ready', 'Ready to launch'], ['selling', 'Already selling'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  brand: {
    understandingField: 'brand', prompt: 'How developed is the brand for this product?', explanation: 'This optional context can make later recommendations more precise.',
    options: [['established', 'The brand is established'], ['in_progress', 'The brand is in progress'], ['name_only', 'I only have a name'], ['not_started', 'I have not started the brand yet'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  budget: {
    understandingField: 'budget', prompt: 'What launch investment are you planning for?', explanation: 'This optional context keeps recommendations proportionate.',
    options: [['under_1000', 'Under $1,000'], ['1000_5000', '$1,000–$5,000'], ['5000_25000', '$5,000–$25,000'], ['over_25000', 'More than $25,000'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  },
  timeline: {
    understandingField: 'timeline', prompt: 'When would you like to launch?', explanation: 'This optional context helps sequence work.',
    options: [['within_month', 'Within one month'], ['one_to_three_months', 'In one to three months'], ['three_to_six_months', 'In three to six months'], ['later', 'More than six months from now'], ['unsure', "I'm not sure yet"], ['other', 'Other', true]]
  }
};

function normalizedOptions(options) {
  return options.map(function(option) {
    return { value: option[0], label: option[1], ...(option[2] ? { allowsText: true } : {}) };
  });
}

function settled(field) {
  return Boolean(field && field.value !== null && field.value !== 'unsure'
    && (!Array.isArray(field.value) || field.value.length > 0) && field.source !== 'unknown'
    && (field.source === 'user_confirmed' || Number(field.confidence) >= SETTLED_CONFIDENCE));
}

function isSupplement(understanding) {
  return understanding?.category?.value === 'dietary_supplement';
}

function isDigestiveIdeaStageSupplement(understanding) {
  return isSupplement(understanding)
    && understanding?.intendedOutcome?.value === 'digestive_wellness'
    && understanding?.conceptMaturity?.value === 'idea_only';
}

function existingProductQuestionId(understanding) {
  if (!isSupplement(understanding)) return null;
  return {
    formula_in_mind: 'supplement_formula_context',
    in_development: 'supplement_development_context',
    finalized: 'supplement_finalized_context'
  }[understanding?.conceptMaturity?.value] || null;
}

function requirementsFor({ objective, understanding = {} }) {
  if (objective === 'promote_service') {
    return [
      { id: 'service', domain: 'Service', importance: 120, essential: true, fields: ['serviceDefinition'], questionIds: ['service_definition'], unresolvedPolicy: 'block' },
      { id: 'client', domain: 'Ideal Client', importance: 115, essential: true, fields: ['targetAudience'], questionIds: ['service_client'], unresolvedPolicy: 'block' },
      { id: 'problem', domain: 'Client Problem', importance: 110, essential: true, fields: ['clientProblem'], questionIds: ['service_problem'], unresolvedPolicy: 'block' },
      { id: 'expertise', domain: 'Expertise & Proof', importance: 105, essential: true, fields: ['serviceExpertise'], questionIds: ['service_expertise'], unresolvedPolicy: 'block' },
      { id: 'difference', domain: 'Differentiation', importance: 100, essential: true, fields: ['serviceDifferentiation'], questionIds: ['service_difference'], unresolvedPolicy: 'block' },
      { id: 'offer', domain: 'Offer & Pricing', importance: 80, essential: false, fields: ['serviceOffer'], questionIds: ['service_offer'], unresolvedPolicy: 'defer' },
      { id: 'market', domain: 'Service Market', importance: 75, essential: false, fields: ['serviceMarket'], questionIds: ['service_market'], unresolvedPolicy: 'defer' },
      { id: 'channel', domain: 'Acquisition Channel', importance: 95, essential: true, fields: ['serviceChannel'], questionIds: ['service_channel'], unresolvedPolicy: 'block' },
      { id: 'constraints', domain: 'Constraints & Assets', importance: 65, essential: false, fields: ['serviceConstraints'], questionIds: ['service_constraints'], unresolvedPolicy: 'defer' }
    ];
  }
  if (objective === 'build_brand') {
    return [
      { id: 'business', domain: 'Business & Category', importance: 120, essential: true, fields: ['brandBusiness'], questionIds: ['brand_business'], unresolvedPolicy: 'block' },
      { id: 'audience', domain: 'Audience', importance: 115, essential: true, fields: ['targetAudience'], questionIds: ['brand_audience'], unresolvedPolicy: 'block' },
      { id: 'existing', domain: 'Existing Brand', importance: 110, essential: true, fields: ['existingBrand'], questionIds: ['brand_state'], unresolvedPolicy: 'block' },
      { id: 'difference', domain: 'Differentiation', importance: 105, essential: true, fields: ['brandDifferentiation'], questionIds: ['brand_difference'], unresolvedPolicy: 'block' },
      { id: 'values', domain: 'Values', importance: 100, essential: true, fields: ['brandValues'], questionIds: ['brand_values'], unresolvedPolicy: 'block' },
      { id: 'voice', domain: 'Voice', importance: 95, essential: true, fields: ['brandVoice'], questionIds: ['brand_voice'], unresolvedPolicy: 'block' },
      { id: 'proof', domain: 'Proof', importance: 70, essential: false, fields: ['brandProof'], questionIds: ['brand_proof'], unresolvedPolicy: 'defer' },
      { id: 'constraints', domain: 'Constraints', importance: 60, essential: false, fields: ['brandConstraints'], questionIds: ['brand_constraints'], unresolvedPolicy: 'defer' }
    ];
  }
  if (objective === 'improve_search_rankings') {
    return [
      { id: 'site', domain: 'Website & Offer', importance: 120, essential: true, fields: ['websiteContext'], questionIds: ['search_site'], unresolvedPolicy: 'block' },
      { id: 'audience', domain: 'Search Audience', importance: 115, essential: true, fields: ['targetAudience'], questionIds: ['search_audience'], unresolvedPolicy: 'block' },
      { id: 'goal', domain: 'Search Goal', importance: 110, essential: true, fields: ['searchGoal'], questionIds: ['search_goal'], unresolvedPolicy: 'block' },
      { id: 'content', domain: 'Existing Content', importance: 105, essential: true, fields: ['existingContent'], questionIds: ['search_content'], unresolvedPolicy: 'block' },
      { id: 'market', domain: 'Geographic Market', importance: 70, essential: false, fields: ['geographicMarket'], questionIds: ['search_market'], unresolvedPolicy: 'defer' },
      { id: 'keywords', domain: 'Supplied Topics', importance: 65, essential: false, fields: ['suppliedKeywords'], questionIds: ['search_keywords'], unresolvedPolicy: 'defer' },
      { id: 'evidence', domain: 'Available Search Evidence', importance: 60, essential: false, fields: ['searchEvidence'], questionIds: ['search_evidence'], unresolvedPolicy: 'defer' },
      { id: 'constraints', domain: 'Technical Constraints', importance: 55, essential: false, fields: ['technicalLimitations'], questionIds: ['search_constraints'], unresolvedPolicy: 'defer' }
    ];
  }
  if (objective === 'increase_conversion_rates') {
    return [
      { id: 'offer', domain: 'Current Offer', importance: 120, essential: true, fields: ['currentOffer'], questionIds: ['conversion_offer'], unresolvedPolicy: 'block' },
      { id: 'audience', domain: 'Target Audience', importance: 115, essential: true, fields: ['targetAudience'], questionIds: ['conversion_audience'], unresolvedPolicy: 'block' },
      { id: 'traffic', domain: 'Traffic Source', importance: 110, essential: true, fields: ['trafficSource'], questionIds: ['conversion_traffic'], unresolvedPolicy: 'block' },
      { id: 'funnel', domain: 'Conversion Action', importance: 105, essential: true, fields: ['funnelType'], questionIds: ['conversion_funnel'], unresolvedPolicy: 'block' },
      { id: 'page', domain: 'Current Page Experience', importance: 100, essential: true, fields: ['pageExperience'], questionIds: ['conversion_page'], unresolvedPolicy: 'block' },
      { id: 'cta', domain: 'Call to Action', importance: 95, essential: true, fields: ['primaryCta'], questionIds: ['conversion_cta'], unresolvedPolicy: 'block' },
      { id: 'evidence', domain: 'Conversion Evidence', importance: 80, essential: false, fields: ['conversionEvidence'], questionIds: ['conversion_evidence'], unresolvedPolicy: 'defer' },
      { id: 'friction', domain: 'Friction & Objections', importance: 70, essential: false, fields: ['conversionFriction'], questionIds: ['conversion_friction'], unresolvedPolicy: 'defer' }
    ];
  }
  if (objective === 'get_more_customers') {
    return [
      { id: 'offer_context', domain: 'Offer', importance: 120, essential: true, fields: ['businessType'], questionIds: ['business_type'], unresolvedPolicy: 'block' },
      { id: 'growth_goal', domain: 'Growth Goal', importance: 115, essential: true, fields: ['acquisitionGoal'], questionIds: ['acquisition_goal'], unresolvedPolicy: 'block' },
      { id: 'target_customer', domain: 'Customer', importance: 110, essential: true, fields: ['targetAudience'], questionIds: ['acquisition_target'], unresolvedPolicy: 'block' },
      { id: 'current_channel', domain: 'Current Acquisition', importance: 100, essential: true, fields: ['currentAcquisitionChannel'], questionIds: ['acquisition_channel'], unresolvedPolicy: 'block' },
      { id: 'acquisition_stage', domain: 'Acquisition Maturity', importance: 95, essential: true, fields: ['acquisitionStage'], questionIds: ['acquisition_stage'], unresolvedPolicy: 'block' },
      { id: 'sales_process', domain: 'Sales Process', importance: 90, essential: true, fields: ['salesProcess'], questionIds: ['sales_process'], unresolvedPolicy: 'block' },
      { id: 'capacity', domain: 'Capacity', importance: 80, essential: true, fields: ['capacityReadiness'], questionIds: ['capacity_readiness'], unresolvedPolicy: 'block' }
    ];
  }
  if (objective !== 'launch_product') throw new Error(`Unsupported discovery objective: ${objective || 'missing'}`);
  const supplement = isSupplement(understanding);
  const digestiveIdeaStage = isDigestiveIdeaStageSupplement(understanding);
  const productDefinitionQuestion = existingProductQuestionId(understanding);
  const earlyConcept = supplement && ['idea_only', 'direction_no_formula'].includes(understanding?.conceptMaturity?.value);
  return [
    { id: 'product_context', domain: 'Product', importance: 120, essential: true, fields: supplement ? ['businessType', 'category'] : ['businessType'], allFields: true, questionIds: ['business_type'], unresolvedPolicy: 'block' },
    ...(supplement ? [{ id: 'intended_outcome', domain: 'Customer Need / Desired Outcome', importance: 115, essential: true, fields: ['intendedOutcome'], questionIds: ['supplement_intended_outcome', 'supplement_outcome_exploration'], unresolvedPolicy: 'guided_followup' }] : [{ id: 'customer_need', domain: 'Customer Need / Desired Outcome', importance: 95, essential: true, fields: ['customerMotivation'], questionIds: ['customer_motivation'], unresolvedPolicy: 'block' }]),
    ...(supplement ? [{ id: 'concept_maturity', domain: 'Product', importance: 110, essential: true, fields: ['conceptMaturity'], questionIds: ['supplement_concept_maturity'], unresolvedPolicy: 'block' }] : []),
    ...(productDefinitionQuestion ? [{ id: 'existing_product_definition', domain: 'Existing Product', importance: 105, essential: true, fields: ['existingProductDefinition'], questionIds: [productDefinitionQuestion], unresolvedPolicy: 'block', prerequisites: ['concept_maturity'] }] : []),
    ...(digestiveIdeaStage ? [{ id: 'product_exploration', domain: 'Product Exploration', importance: 105, essential: false, fields: ['productExplorationDirections'], questionIds: ['supplement_digestive_product_exploration'], unresolvedPolicy: 'defer' }] : []),
    { id: 'target_customer', domain: 'Customer', importance: 100, essential: true, fields: ['targetAudience'], questionIds: ['target_audience'], unresolvedPolicy: 'block' },
    { id: 'launch_stage', domain: 'Launch Stage', importance: 80, essential: true, fields: ['launchStage'], questionIds: [supplement ? 'supplement_launch_stage' : 'launch_stage'], unresolvedPolicy: 'block' },
    { id: 'sales_channel', domain: 'Sales Channel', importance: 75, essential: false, fields: ['salesChannel'], questionIds: ['sales_channel'], unresolvedPolicy: 'defer' },
    { id: 'competitive_context', domain: 'Competitive Context', importance: 60, essential: false, fields: ['competitiveDifferentiation'], questionIds: ['competitive_differentiation'], unresolvedPolicy: 'defer', prerequisites: [supplement ? 'intended_outcome' : 'customer_need', ...(productDefinitionQuestion ? ['existing_product_definition'] : [])], ...((digestiveIdeaStage || earlyConcept) ? { askByDefault: false } : {}) },
    { id: 'brand', domain: 'Brand', importance: 30, essential: false, fields: ['brand'], questionIds: ['brand'], unresolvedPolicy: 'defer', askByDefault: false },
    { id: 'budget', domain: 'Budget', importance: 20, essential: false, fields: ['budget'], questionIds: ['budget'], unresolvedPolicy: 'defer', askByDefault: false },
    { id: 'timeline', domain: 'Timeline', importance: 15, essential: false, fields: ['timeline'], questionIds: ['timeline'], unresolvedPolicy: 'defer', askByDefault: false }
  ];
}

function answerValue(answer) {
  return answer && typeof answer === 'object' ? answer.value : answer;
}

function stateFor(requirement, understanding, answers) {
  const established = requirement.allFields
    ? requirement.fields.every(function(field) { return settled(understanding[field]); })
    : requirement.fields.some(function(field) { return settled(understanding[field]); });
  if (established) return 'known';
  const answered = requirement.questionIds.filter(function(id) { return Object.prototype.hasOwnProperty.call(answers, id); });
  if (!answered.length) return 'unasked';
  const hasFurtherQuestion = requirement.questionIds.some(function(id) { return !Object.prototype.hasOwnProperty.call(answers, id); });
  if (requirement.unresolvedPolicy === 'guided_followup' && hasFurtherQuestion) return 'unresolved_nonblocking';
  return requirement.essential ? 'unresolved_blocking' : 'unresolved_nonblocking';
}

function nextQuestionId(requirement, answers) {
  if (requirement.id === 'intended_outcome') {
    if (!Object.prototype.hasOwnProperty.call(answers, 'supplement_intended_outcome')) return 'supplement_intended_outcome';
    if (answerValue(answers.supplement_intended_outcome) === 'unsure'
      && !Object.prototype.hasOwnProperty.call(answers, 'supplement_outcome_exploration')) return 'supplement_outcome_exploration';
    return null;
  }
  return requirement.questionIds.find(function(id) { return !Object.prototype.hasOwnProperty.call(answers, id); }) || null;
}

function buildQuestion(questionId, requirement) {
  const definition = QUESTION_CATALOG[questionId];
  if (!definition) return null;
  return {
    id: questionId, requirementId: requirement.id, domain: requirement.domain,
    prompt: definition.prompt, explanation: definition.explanation, type: definition.type || 'single_choice',
    options: normalizedOptions(definition.options || []), importance: requirement.importance,
    understandingField: definition.understandingField,
    guidedExploration: questionId === 'supplement_outcome_exploration',
    ...(definition.maxSelections ? { maxSelections: definition.maxSelections } : {}),
    ...(definition.allowsAdditionalDetail ? { allowsAdditionalDetail: true } : {}),
    ...(definition.placeholder ? { placeholder: definition.placeholder } : {}),
    ...(definition.allowsUnsure ? { allowsUnsure: true } : {})
  };
}

function evaluateRequirements({ objective, understanding = {}, answers = {} }) {
  const requirements = requirementsFor({ objective, understanding });
  const states = Object.fromEntries(requirements.map(function(requirement) {
    return [requirement.id, stateFor(requirement, understanding, answers)];
  }));
  const candidates = requirements.filter(function(requirement) {
    if (states[requirement.id] === 'known') return false;
    if (!requirement.essential && requirement.askByDefault === false) return false;
    const prerequisitesKnown = (requirement.prerequisites || []).every(function(id) { return states[id] === 'known'; });
    return prerequisitesKnown && Boolean(nextQuestionId(requirement, answers));
  }).sort(function(left, right) { return right.importance - left.importance; });
  const selected = candidates[0] || null;
  const nextQuestion = selected ? buildQuestion(nextQuestionId(selected, answers), selected) : null;
  const entries = requirements.map(function(requirement) {
    return { id: requirement.id, domain: requirement.domain, essential: requirement.essential, state: states[requirement.id] };
  });
  const knownRequirements = entries.filter(function(item) { return item.state === 'known'; }).map(function(item) { return item.id; });
  const answeredRequirements = entries.filter(function(item) { return item.state !== 'unasked'; }).map(function(item) { return item.id; });
  const unresolvedBlockingRequirements = entries.filter(function(item) { return item.state === 'unresolved_blocking'; });
  const unresolvedNonBlockingRequirements = entries.filter(function(item) { return item.state === 'unresolved_nonblocking'; });
  const unaskedEssentialRequirements = entries.filter(function(item) { return item.essential && item.state === 'unasked'; });
  const optionalKnowledgeGaps = entries.filter(function(item) { return !item.essential && item.state !== 'known'; }).map(function(item) { return item.domain; });
  return {
    policyVersion: DISCOVERY_POLICY_VERSION,
    requirements: entries,
    nextQuestion,
    discoveryCompleteForNow: nextQuestion === null,
    ready: unaskedEssentialRequirements.length === 0 && unresolvedBlockingRequirements.length === 0,
    answeredRequirements,
    knownRequirements,
    unresolvedBlockingRequirements,
    unresolvedNonBlockingRequirements,
    unaskedEssentialRequirements,
    optionalKnowledgeGaps
  };
}

function isMeaningfullyReady(readiness) {
  return Boolean(readiness?.ready
    && readiness.policyVersion === DISCOVERY_POLICY_VERSION
    && Array.isArray(readiness.unresolvedBlockingRequirements)
    && readiness.unresolvedBlockingRequirements.length === 0
    && Array.isArray(readiness.unaskedEssentialRequirements)
    && readiness.unaskedEssentialRequirements.length === 0);
}

function isDiscoverySessionReady(session) {
  if (!session?.objective || !session?.understanding || !session?.answers) return false;
  try {
    return isMeaningfullyReady(evaluateRequirements({
      objective: session.objective,
      understanding: session.understanding,
      answers: session.answers
    }));
  } catch (err) {
    return false;
  }
}

module.exports = {
  DISCOVERY_POLICY_VERSION,
  evaluateRequirements,
  isDiscoverySessionReady,
  isMeaningfullyReady,
  requirementsFor
};
