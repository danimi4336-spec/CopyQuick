const INTERNAL_LANGUAGE = [
  /create the approved .{0,100} deliverable/i,
  /completed prerequisite outputs?\s*\(structured\)/i,
  /treat strategic guidance as direction, not evidence/i,
  /use known facts as facts/i,
  /approved strategy\s*:/i,
  /approved source context\s*:/i,
  /do not invent (?:demographic|scientific|performance|regulated)/i,
  /(?:output|json) schema\s*:/i,
  /(?:contractVersion|contract_version|structured_result|dependencyOutputs)\b/i,
  /\b(?:system|developer|user) (?:prompt|message|instruction)s?\b/i,
  /\b(?:provided|supplied|internal) (?:instructions?|context|metadata|schema)\b/i,
  /\b(?:according to|based on|using) (?:the )?(?:provided|supplied|approved|internal|upstream) (?:context|instructions?|brief|deliverable|outputs?|data)\b/i,
  /\b(?:upstream|prerequisite|dependency) (?:outputs?|results?|documents?|deliverables?|data|context)\b/i,
  /\bsemantic (?:role|label)s?\b/i,
  /\b(?:confirmed_fact|inferred_fact|strategic_recommendation|derived_risk|exploration_intent|builder_provided_product_context)\b/i,
  /\b(?:production|generation) (?:contract|context|pipeline|orchestration|instructions?|metadata)\b/i,
  /\b(?:i was|we were|the model was) (?:asked|instructed|provided|given)\b/i,
  /\bthis (?:output|response|deliverable) (?:follows|uses|was generated from) (?:the )?(?:requested structure|instructions?|context|schema)\b/i
];

const UNSUPPORTED_CLAIM_LANGUAGE = [
  /\bclinically proven\b/i,
  /\b(?:FDA|USDA)\s+(?:approved|certified)\b/i,
  /\bcertified organic\b/i,
  /\bdoctor[- ]recommended\b/i,
  /\b(?:cures?|prevents?)\s+(?:a |an |the )?[a-z][a-z -]{2,50}\b/i,
  /\b(?:proven|guaranteed)\s+(?:to|results?|returns?)\b/i,
  /\b\d+(?:\.\d+)?%\s+(?:effective|improvement|better|faster|return|roi)\b/i,
  /(?:^|\s)#1\b/i,
  /\bbest[- ]selling\b/i,
  /\b(?:rated\s+\d(?:\.\d+)?|five[- ]star rated)\b/i,
  /\btrusted by\s+\d[\d,]*\b/i,
  /\b(?:contains|made with|formulated with)\s+[a-z0-9][a-z0-9 ,&+/-]{2,80}\b/i
];

const CLAIM_QUALIFIERS = /\b(?:not|no|without|avoid|do not|does not|must not|cannot|unsubstantiated|unsupported|unverified|hypothesis|hypotheses|to investigate|to validate|requires? validation|once established|if established|before adoption)\b/i;
const META_OUTPUT_LANGUAGE = /^(?:here (?:is|are)|here's|i (?:have )?(?:created|prepared|generated)|as requested|the requested deliverable)\b/i;
const MINIMUM_OUTPUT_CHARACTERS = 80;
const CUSTOMER_COPY_FIELDS = Object.freeze({
  paid_ad_copy_set: Object.freeze([
    'ad1Headline', 'ad1PrimaryText', 'ad1Description',
    'ad2Headline', 'ad2PrimaryText', 'ad2Description',
    'ad3Headline', 'ad3PrimaryText', 'ad3Description', 'callToAction'
  ]),
  lead_capture_page: Object.freeze([
    'eyebrow', 'headline', 'subheadline', 'problemSection', 'offerSection',
    'processSteps', 'proofSection', 'primaryCallToAction', 'faq'
  ])
});
const PRODUCER_INSTRUCTION_LANGUAGE = [
  /\buse paid advertising to reach\b/i,
  /\bthis campaign is (?:built|designed|intended)\b/i,
  /\b(?:the|this) (?:ad|campaign|message|copy|section|page) (?:should|must|needs|stays)\b/i,
  /\b(?:keep|test|measure|track|scale) (?:the |this |one )?(?:message|campaign|ad|copy|lead quality|conversion|spend)\b/i,
  /\b(?:before publishing|before (?:the )?ads? go live|before launch|after performance is validated)\b/i,
  /\b(?:should be added here|if you add testimonials|if no proof points|remove this section)\b/i,
  /\b(?:can I use this page for paid advertising|should we include reviews|what should we verify before publishing|does (?:this|the) page make performance promises)\b/i,
  /\b(?:presented as a service description|should only be added after|before (?:being )?used in customer-facing (?:materials|copy)|supporting evidence before|should be supported by evidence before|before (?:it is|they are) presented here)\b/i
];
const SUBSTANTIVE_CONTRACTS = new Set([
  'outreach_sequence',
  'referral_campaign_kit',
  'paid_ad_copy_set',
  'social_lead_campaign',
  'organic_content_campaign',
  'lead_capture_page',
  'sales_call_script',
  'multi_channel_campaign_kit',
  'customer_profile',
  'product_concept_brief',
  'product_positioning',
  'value_proposition',
  'validation_plan',
  'core_messaging',
  'amazon_listing',
  'amazon_bullet_points',
  'amazon_keyword_guidance',
  'product_image_guidance',
  'launch_announcement',
  'educational_content',
  'social_launch_campaign'
]);
[
  'amazon_a_plus', 'ecommerce_product_page', 'ecommerce_trust_faq',
  'ecommerce_conversion_copy', 'abandoned_cart_email', 'google_business_profile',
  'service_page', 'software_product_demo', 'saas_trial_emails'
].forEach(id => SUBSTANTIVE_CONTRACTS.add(id));

function customerStrings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach(item => customerStrings(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => customerStrings(item, result));
  return result;
}

function looksLikeSerializedContext(value) {
  const text = String(value || '').trim();
  if (/^```(?:json)?\s*[\[{]/i.test(text)) return true;
  if (/^[\[{]\s*"[A-Za-z][^"]*"\s*:/.test(text)) return true;
  return (text.match(/"[A-Za-z][A-Za-z0-9_]*"\s*:/g) || []).length >= 2;
}

function containsUnsupportedClaim(value) {
  return String(value || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .some(sentence => sentence && !CLAIM_QUALIFIERS.test(sentence)
      && UNSUPPORTED_CLAIM_LANGUAGE.some(pattern => pattern.test(sentence)));
}

function normalizedCustomerText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasRepetitiveCustomerOutput(strings) {
  const counts = new Map();
  strings.map(normalizedCustomerText).filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  const populatedCount = Array.from(counts.values()).reduce((total, count) => total + count, 0);
  return (populatedCount >= 2 && counts.size === 1)
    || Array.from(counts.values()).some(count => count >= 3);
}

function containsProducerInstructions(output, contract) {
  const fields = CUSTOMER_COPY_FIELDS[contract?.id] || [];
  return fields.some(function(field) {
    return customerStrings(output?.[field], []).some(value => PRODUCER_INSTRUCTION_LANGUAGE.some(pattern => pattern.test(value)));
  });
}

function containsInternalContextLeak(value) {
  return INTERNAL_LANGUAGE.some(pattern => pattern.test(String(value || '')));
}

function validateProductPositioningSemantics(output) {
  const statement = String(output?.positioningStatement || '').trim();
  const marketPosition = String(output?.marketPosition || '').trim();
  const differentiation = String(output?.differentiation || '').trim();
  const proofPoints = Array.isArray(output?.proofPoints) ? output.proofPoints : [];
  const pillars = Array.isArray(output?.positioningPillars) ? output.positioningPillars : [];
  const implications = Array.isArray(output?.messagingImplications) ? output.messagingImplications : [];

  const identifiesAudience = /\b(?:for|serves?|designed for|built for|helps?)\b/i.test(statement);
  const identifiesNeed = /\b(?:seeking|needs?|priority|priorities|want(?:s|ing)?|looking for|trying to|outcome|problem|desire)\b/i.test(statement);
  const framesMarketStatus = /\b(?:market|position(?:ing)?|direction|hypothesis|category|alternative|frame)\b/i.test(marketPosition);
  const handlesDifferentiation = /\b(?:differen|alternative|approach|advantage|proof|evidence|open|unknown|establish|validate|verify|confirm)\w*/i.test(differentiation);
  const establishesEvidenceBoundary = /\b(?:evidence|proof|validate|verify|confirm|test|document|substantiat|research|measure)\w*/i.test(proofPoints.join(' '));
  const providesMessagingDirection = /\b(?:lead|message|communicat|explain|emphas|avoid|use|frame|anchor|focus)\w*/i.test(implications.join(' '));

  return statement.length >= 80
    && identifiesAudience
    && identifiesNeed
    && marketPosition.length >= 20
    && framesMarketStatus
    && differentiation.length >= 40
    && handlesDifferentiation
    && proofPoints.length >= 3
    && proofPoints.every(item => String(item).trim().length >= 25)
    && establishesEvidenceBoundary
    && pillars.length >= 3
    && pillars.every(item => String(item).trim().length >= 12)
    && implications.length >= 3
    && implications.every(item => String(item).trim().length >= 25)
    && providesMessagingDirection;
}

function validateCustomerReadyOutput(output, contract, context) {
  if (!contract?.validateOutput(output, context)) return { valid: false, code: 'PRODUCTION_QUALITY_REQUIRED_CONTENT_MISSING' };
  const strings = customerStrings(output);
  if (!strings.length || strings.some(value => !value.trim())) return { valid: false, code: 'PRODUCTION_QUALITY_REQUIRED_CONTENT_MISSING' };
  if (SUBSTANTIVE_CONTRACTS.has(contract.id)
    && strings.reduce((total, value) => total + value.trim().length, 0) < MINIMUM_OUTPUT_CHARACTERS) {
    return { valid: false, code: 'PRODUCTION_QUALITY_INSUFFICIENT_SUBSTANCE' };
  }
  if (hasRepetitiveCustomerOutput(strings)) return { valid: false, code: 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT' };
  if (containsProducerInstructions(output, contract)) return { valid: false, code: 'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS' };
  for (const value of strings) {
    if (containsInternalContextLeak(value)) return { valid: false, code: 'PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK' };
    if (looksLikeSerializedContext(value)) return { valid: false, code: 'PRODUCTION_QUALITY_SERIALIZED_CONTEXT_LEAK' };
    if (containsUnsupportedClaim(value)) return { valid: false, code: 'PRODUCTION_QUALITY_UNSUPPORTED_CLAIM' };
    if (META_OUTPUT_LANGUAGE.test(value.trim())) return { valid: false, code: 'PRODUCTION_QUALITY_META_OUTPUT' };
  }
  if (contract.id === 'product_positioning' && !validateProductPositioningSemantics(output)) {
    return { valid: false, code: 'PRODUCTION_QUALITY_POSITIONING_SEMANTICS' };
  }
  return { valid: true, code: null };
}

function assertCustomerReadyOutput(output, contract, context) {
  const result = validateCustomerReadyOutput(output, contract, context);
  if (!result.valid) {
    const error = new Error('Production output did not meet customer-facing quality requirements');
    error.code = result.code;
    throw error;
  }
  return output;
}

module.exports = {
  assertCustomerReadyOutput,
  containsInternalContextLeak,
  containsProducerInstructions,
  containsUnsupportedClaim,
  hasRepetitiveCustomerOutput,
  looksLikeSerializedContext,
  validateProductPositioningSemantics,
  validateCustomerReadyOutput
};
