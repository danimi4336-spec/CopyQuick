const FOUNDATION_SCHEMAS = {
  customer_profile: {
    summary: 'string', primaryCustomer: 'string', needs: 'array', motivations: 'array',
    objections: 'array', buyingTriggers: 'array', languageStyle: 'string'
  },
  product_positioning: {
    positioningStatement: 'string', marketPosition: 'string', differentiation: 'string',
    proofPoints: 'array', positioningPillars: 'array', messagingImplications: 'array'
  },
  value_proposition: {
    primaryValueProposition: 'string', customerProblemOrDesire: 'string', promisedOutcome: 'string',
    reasonsToBelieve: 'array', differentiators: 'array', supportingMessages: 'array'
  },
  core_messaging: {
    coreMessage: 'string', messagePillars: 'array', supportingPoints: 'array',
    toneGuidance: 'string', proofThemes: 'array', callsToAction: 'array'
  }
};

const CONTENT_TYPES = {
  customer_profile: 'sales_message', product_positioning: 'sales_message',
  value_proposition: 'sales_message', core_messaging: 'sales_message',
  amazon_listing: 'product_description', amazon_bullet_points: 'product_description',
  amazon_keyword_guidance: 'blog_intro', amazon_a_plus: 'product_description',
  ecommerce_product_page: 'product_description', ecommerce_trust_faq: 'blog_intro',
  ecommerce_conversion_copy: 'cta', abandoned_cart_email: 'email_campaign',
  google_business_profile: 'sales_message', service_page: 'sales_message',
  product_image_guidance: 'sales_message', software_product_demo: 'sales_message',
  saas_trial_emails: 'email_campaign', launch_announcement: 'email_campaign',
  social_launch_campaign: 'social_post', educational_content: 'blog_intro'
};

const REQUIRED_DEPENDENCIES = {
  product_positioning: ['customer_profile'],
  value_proposition: ['customer_profile', 'product_positioning'],
  core_messaging: ['customer_profile', 'product_positioning', 'value_proposition']
};

function nonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function validateSchema(output, schema) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  return Object.entries(schema).every(function([key, type]) {
    if (type === 'string') return nonEmptyString(output[key]);
    return Array.isArray(output[key]) && output[key].length > 0 && output[key].every(nonEmptyString);
  });
}

function rawTexts(results) {
  if (!Array.isArray(results) || !results.length) return [];
  return results.map(function(item) { return item?.text; }).filter(nonEmptyString);
}

function strategyValue(context, key, fallback = 'Needs confirmation') {
  const value = context?.strategySnapshot?.[key]?.value;
  return typeof value === 'string' && value.trim() && value !== 'Unknown' ? value : fallback;
}

function structuredFoundation(id, results, context) {
  const supplied = results[0]?.structuredOutput;
  if (supplied !== undefined) return supplied;
  const texts = rawTexts(results);
  const at = function(index) { return texts[index % texts.length]; };
  if (id === 'customer_profile') return {
    summary: at(0), primaryCustomer: strategyValue(context, 'primaryCustomer'), needs: [at(2)], motivations: [at(3)],
    objections: [at(4)], buyingTriggers: [at(5)], languageStyle: strategyValue(context, 'communicationStyle')
  };
  if (id === 'product_positioning') return {
    positioningStatement: at(0), marketPosition: strategyValue(context, 'marketPosition'),
    differentiation: strategyValue(context, 'competitiveApproach'), proofPoints: ['Needs confirmation'],
    positioningPillars: [at(4)], messagingImplications: [at(5)]
  };
  if (id === 'value_proposition') return {
    primaryValueProposition: at(0), customerProblemOrDesire: at(1), promisedOutcome: at(2),
    reasonsToBelieve: ['Needs confirmation'], differentiators: [strategyValue(context, 'competitiveApproach')], supportingMessages: [at(5)]
  };
  return {
    coreMessage: at(0), messagePillars: [at(1)], supportingPoints: [at(2)],
    toneGuidance: strategyValue(context, 'communicationStyle'), proofThemes: ['Use confirmed proof only'], callsToAction: [at(5)]
  };
}

function violatesUnsupportedClaimSafety(output) {
  const text = JSON.stringify(output).toLowerCase();
  return /clinically proven|\b(?:cure|cures|cured)\b|guaranteed results|guaranteed return|\b\d+% (?:effective|improvement|return|roi)\b/.test(text);
}

function presentationFor(output) {
  return Object.entries(output).map(function([key, value]) {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, function(char) { return char.toUpperCase(); });
    return `${label}: ${Array.isArray(value) ? value.join('; ') : value}`;
  }).join('\n\n');
}

function makeContract(id, contentType) {
  const schema = FOUNDATION_SCHEMAS[id] || { content: 'array', summary: 'string' };
  const foundation = Boolean(FOUNDATION_SCHEMAS[id]);
  return Object.freeze({
    id,
    title: id.replace(/_/g, ' '),
    version: `${id}:v1`,
    contentType,
    requiredContext: ['objective', 'strategySnapshot', 'strategicDirection'],
    requiredDependencies: REQUIRED_DEPENDENCIES[id] || [],
    outputSchema: schema,
    buildPrompt: function(context) {
      return [
        `Create the approved ${context.title} deliverable.`,
        `Strategic direction: ${context.strategicDirection}`,
        'Use known facts as facts. Treat strategic guidance as direction, not evidence.',
        'Do not invent demographic details, scientific proof, performance results, or regulated claims.',
        context.strategyText ? `Approved strategy:\n${context.strategyText}` : '',
        context.dependencyText ? `Completed prerequisite outputs (structured):\n${context.dependencyText}` : ''
      ].filter(Boolean).join('\n\n');
    },
    normalizeOutput: function(results, context) {
      const texts = rawTexts(results);
      if (!texts.length) return null;
      if (foundation) return structuredFoundation(id, results, context);
      const supplied = results[0]?.structuredOutput;
      return supplied !== undefined ? supplied : { summary: texts[0], content: texts };
    },
    validateOutput: function(output) {
      return validateSchema(output, schema) && !violatesUnsupportedClaimSafety(output);
    },
    presentOutput: function(output, rawResults) {
      if (!foundation) return rawResults;
      return [{ text: presentationFor(output), tone: rawResults[0]?.tone || 'professional' }];
    }
  });
}

const contracts = Object.freeze(Object.fromEntries(Object.entries(CONTENT_TYPES).map(function([id, contentType]) {
  return [id, makeContract(id, contentType)];
})));

function getProductionContract(id) { return contracts[id] || null; }
function getProductionContractIds() { return Object.keys(contracts); }

module.exports = { getProductionContract, getProductionContractIds };
