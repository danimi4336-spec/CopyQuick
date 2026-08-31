const DEFINITIONS = {
  customer_profile: { contentType: 'sales_message', dependencies: [], schema: { summary: 'string', primaryCustomer: 'string', needs: 'array', motivations: 'array', objections: 'array', buyingTriggers: 'array', languageStyle: 'string' }, labels: ['Profile Summary', 'Primary Customer', 'Needs', 'Motivations', 'Objections', 'Buying Triggers', 'Language & Communication Style'] },
  product_positioning: { contentType: 'sales_message', dependencies: ['customer_profile'], schema: { positioningStatement: 'string', marketPosition: 'string', differentiation: 'string', proofPoints: 'array', positioningPillars: 'array', messagingImplications: 'array' }, labels: ['Positioning Statement', 'Market Position', 'Core Differentiation', 'Reasons to Believe', 'Positioning Pillars', 'Messaging Implications'] },
  value_proposition: { contentType: 'sales_message', dependencies: ['customer_profile', 'product_positioning'], schema: { primaryValueProposition: 'string', customerProblemOrDesire: 'string', promisedOutcome: 'string', reasonsToBelieve: 'array', differentiators: 'array', supportingMessages: 'array' }, labels: ['Primary Value Proposition', 'Customer Problem or Desire', 'Promised Outcome', 'Reasons to Believe', 'Differentiators', 'Supporting Messages'] },
  core_messaging: { contentType: 'sales_message', dependencies: ['customer_profile', 'product_positioning', 'value_proposition'], schema: { coreMessage: 'string', messagePillars: 'array', supportingPoints: 'array', toneGuidance: 'string', proofThemes: 'array', callsToAction: 'array' }, labels: ['Core Message', 'Message Pillars', 'Supporting Points', 'Tone Guidance', 'Proof Themes', 'Calls to Action'] },
  product_image_guidance: { contentType: 'sales_message', dependencies: [], schema: { creativeDirection: 'string', visualConcepts: 'array', requiredShots: 'array', compositionGuidance: 'array', lightingAndColor: 'string', productionNotes: 'array', avoidances: 'array' }, labels: ['Creative Direction', 'Visual Concepts', 'Required Shots', 'Composition Guidance', 'Lighting & Color', 'Production Notes', 'What to Avoid'] },
  launch_announcement: { contentType: 'email_campaign', dependencies: [], schema: { subjectLine: 'string', previewText: 'string', headline: 'string', body: 'string', keyBenefits: 'array', callToAction: 'string' }, labels: ['Subject Line', 'Preview Text', 'Headline', 'Announcement', 'Key Benefits', 'Call to Action'] },
  educational_content: { contentType: 'blog_intro', dependencies: [], schema: { title: 'string', learningObjective: 'string', introduction: 'string', keyLessons: 'array', practicalTakeaways: 'array', conclusion: 'string', callToAction: 'string' }, labels: ['Title', 'Learning Objective', 'Introduction', 'Key Lessons', 'Practical Takeaways', 'Conclusion', 'Next Step'] },
  social_launch_campaign: { contentType: 'social_post', dependencies: [], schema: { campaignTheme: 'string', campaignObjective: 'string', posts: 'array', hashtags: 'array', visualDirections: 'array', postingSequence: 'array' }, labels: ['Campaign Theme', 'Campaign Objective', 'Social Posts', 'Hashtags', 'Visual Direction', 'Posting Sequence'] }
};

const OTHER_CONTENT_TYPES = {
  amazon_listing: 'product_description', amazon_bullet_points: 'product_description', amazon_keyword_guidance: 'blog_intro', amazon_a_plus: 'product_description',
  ecommerce_product_page: 'product_description', ecommerce_trust_faq: 'blog_intro', ecommerce_conversion_copy: 'cta', abandoned_cart_email: 'email_campaign',
  google_business_profile: 'sales_message', service_page: 'sales_message', software_product_demo: 'sales_message', saas_trial_emails: 'email_campaign'
};
Object.entries(OTHER_CONTENT_TYPES).forEach(([id, contentType]) => {
  DEFINITIONS[id] = { contentType, dependencies: [], schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Deliverable'] };
});

function nonEmptyString(value) { return typeof value === 'string' && Boolean(value.trim()); }
function validateSchema(output, schema) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  return Object.entries(schema).every(([key, type]) => type === 'string'
    ? nonEmptyString(output[key])
    : Array.isArray(output[key]) && output[key].length > 0 && output[key].every(nonEmptyString));
}
function rawTexts(results) { return Array.isArray(results) ? results.map(item => item?.text).filter(nonEmptyString) : []; }
function humanLabel(key) { return key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase()); }
function strategyValue(context, key, fallback = 'To be confirmed') {
  const value = context?.strategySnapshot?.[key]?.value;
  return nonEmptyString(value) && value !== 'Unknown' ? value : fallback;
}
function strategyRole(context, key) { return context?.strategySnapshot?.[key]?.semanticRole || null; }
function dependencyValue(context, id, key, fallback = 'To be confirmed') {
  const value = context?.dependencyOutputs?.find(item => item.deliverableId === id)?.output?.[key];
  if (nonEmptyString(value)) return value;
  if (Array.isArray(value) && value.length) return value[0];
  return fallback;
}

function defaultStructuredOutput(id, context, texts) {
  const safe = texts.filter(text => !/create the approved|completed prerequisite outputs|approved source context/i.test(text));
  const at = index => safe[index % Math.max(1, safe.length)] || 'To be confirmed';
  if (id === 'customer_profile') return { summary: `A focused profile of ${strategyValue(context, 'primaryCustomer', 'the priority customer')}.`, primaryCustomer: strategyValue(context, 'primaryCustomer'), needs: [strategyValue(context, 'customerNeeds')], motivations: [strategyValue(context, 'customerMotivations')], objections: [strategyValue(context, 'customerObjections')], buyingTriggers: [strategyValue(context, 'buyingTriggers')], languageStyle: strategyValue(context, 'communicationStyle') };
  if (id === 'product_positioning') {
    const customer = dependencyValue(context, 'customer_profile', 'primaryCustomer', strategyValue(context, 'primaryCustomer', 'the priority customer'));
    const need = dependencyValue(context, 'customer_profile', 'needs', 'their established priority');
    const market = strategyValue(context, 'marketPosition');
    const difference = strategyValue(context, 'competitiveApproach');
    const positionPhrase = strategyRole(context, 'marketPosition') === 'strategic_recommendation'
      ? `using the recommended ${market.toLowerCase()}`
      : `through a ${market.toLowerCase()} position`;
    return { positioningStatement: `For ${customer}, the offer addresses ${need} ${positionPhrase}, differentiated by ${difference.toLowerCase()}.`, marketPosition: market, differentiation: difference, proofPoints: ['Use only confirmed customer evidence and product proof.'], positioningPillars: [market, difference], messagingImplications: [`Lead with ${need}; support the promise with confirmed proof.`] };
  }
  if (id === 'value_proposition') {
    const problem = dependencyValue(context, 'customer_profile', 'needs');
    const difference = dependencyValue(context, 'product_positioning', 'differentiation');
    return { primaryValueProposition: `Help the priority customer address ${problem} with an approach distinguished by ${difference}.`, customerProblemOrDesire: problem, promisedOutcome: `A clearer path to ${strategyValue(context, 'customerMotivation', 'the desired outcome')}.`, reasonsToBelieve: ['Use confirmed product capabilities and customer evidence.'], differentiators: [difference], supportingMessages: [`Built around ${problem}, without unsupported promises.`] };
  }
  if (id === 'core_messaging') {
    const value = dependencyValue(context, 'value_proposition', 'primaryValueProposition');
    return { coreMessage: value, messagePillars: [dependencyValue(context, 'product_positioning', 'marketPosition'), dependencyValue(context, 'product_positioning', 'differentiation')], supportingPoints: [dependencyValue(context, 'value_proposition', 'supportingMessages')], toneGuidance: strategyValue(context, 'communicationStyle'), proofThemes: [dependencyValue(context, 'value_proposition', 'reasonsToBelieve')], callsToAction: ['Invite the customer to take the next appropriate step.'] };
  }
  if (id === 'product_image_guidance') return { creativeDirection: at(0), visualConcepts: [at(1)], requiredShots: ['Primary product hero image', 'Detail and context image'], compositionGuidance: ['Keep the product and its use clear at a glance.'], lightingAndColor: strategyValue(context, 'visualStyle', 'Use clear, brand-consistent lighting and color.'), productionNotes: ['Show only confirmed product attributes.'], avoidances: ['Avoid unsupported visual claims or misleading scale.'] };
  if (id === 'launch_announcement') {
    const message = dependencyValue(context, 'core_messaging', 'coreMessage', at(0));
    return { subjectLine: strategyValue(context, 'launchHeadline', 'A new solution, built around what matters'), previewText: message, headline: strategyValue(context, 'launchHeadline', 'Meet the new offer'), body: message, keyBenefits: [dependencyValue(context, 'value_proposition', 'primaryValueProposition', at(1))], callToAction: dependencyValue(context, 'core_messaging', 'callsToAction', 'Learn more') };
  }
  if (id === 'educational_content') {
    const need = dependencyValue(context, 'customer_profile', 'needs', 'the customer’s priority');
    const lesson = dependencyValue(context, 'core_messaging', 'supportingPoints', at(0));
    return { title: `A practical guide to ${need}`, learningObjective: `Understand the key considerations surrounding ${need}.`, introduction: lesson, keyLessons: [lesson], practicalTakeaways: [`Evaluate options against confirmed needs and evidence.`], conclusion: `A clear decision starts with the customer need and credible proof.`, callToAction: 'Take the next appropriate step when ready.' };
  }
  if (id === 'social_launch_campaign') {
    const message = dependencyValue(context, 'core_messaging', 'coreMessage', at(0));
    return { campaignTheme: strategyValue(context, 'launchApproach', 'Education before promotion'), campaignObjective: 'Introduce the offer clearly and build confidence through confirmed value.', posts: [message, `${message} Learn more when you are ready.`], hashtags: ['#Launch'], visualDirections: ['Use brand-consistent product imagery that supports the message.'], postingSequence: ['Introduce the customer need', 'Explain the value', 'Invite the next step'] };
  }
  return { summary: at(0), content: safe.length ? safe : ['Deliverable content to be confirmed.'] };
}

function violatesUnsupportedClaimSafety(output) {
  return /clinically proven|\b(?:cure|cures|cured)\b|guaranteed results|guaranteed return|\b\d+% (?:effective|improvement|return|roi)\b/i.test(JSON.stringify(output));
}
function violatesMarketplaceEvidenceSafety(output) {
  const text = JSON.stringify(output);
  return /\b(?:search volume|monthly searches|market size|competition (?:level|score)|demand (?:metric|score|volume)|ranking difficulty|keyword (?:opportunity )?score)\s*(?:is|of|:|=)?\s*\d/i.test(text)
    || /\b\d[\d,]*(?:\.\d+)?\s+(?:monthly\s+)?searches\b/i.test(text);
}
function formatContext(context) {
  const lines = [];
  Object.entries(context.strategySnapshot || {}).forEach(([key, item]) => {
    const value = item?.value;
    if (value && value !== 'Unknown') {
      const prefix = item.semanticRole === 'strategic_recommendation' ? 'Recommended '
        : item.semanticRole === 'confirmed_fact' ? 'Confirmed '
          : item.semanticRole === 'inferred_fact' ? 'Inferred '
            : item.semanticRole === 'derived_risk' ? 'Derived ' : '';
      lines.push(`${prefix}${humanLabel(key)}: ${Array.isArray(value) ? value.join('; ') : value}`);
    }
  });
  (context.dependencyOutputs || []).forEach(dependency => {
    const values = Object.entries(dependency.output || {}).slice(0, 8).map(([key, value]) => `${humanLabel(key)}: ${Array.isArray(value) ? value.join('; ') : value}`);
    lines.push(`${dependency.title}: ${values.join(' | ')}`);
  });
  return lines.join('\n').slice(0, 8000);
}

function makeContract(id, definition) {
  const labels = Object.fromEntries(Object.keys(definition.schema).map((key, index) => [key, definition.labels[index]]));
  return Object.freeze({
    id, title: humanLabel(id), version: `${id}:v2`, contentType: definition.contentType,
    requiredContext: ['objective', 'strategySnapshot', 'strategicDirection'], requiredDependencies: definition.dependencies,
    outputSchema: definition.schema, sectionLabels: labels,
    buildPrompt(context) {
      const source = formatContext(context);
      const safety = id === 'amazon_keyword_guidance'
        ? 'Present search directions, keyword themes, and marketplace terms only as hypotheses to investigate. Do not claim or invent search volume, market size, competition levels, demand metrics, ranking difficulty, keyword scores, or any measured Amazon evidence.'
        : '';
      return [`Produce the customer-facing ${context.title}.`, 'Return the finished deliverable only; do not describe the task or quote instructions, schemas, contract metadata, or source context.', 'Use only established facts. Mark genuinely unknown proof or details as “To be confirmed” instead of inventing them.', safety, `Purpose: ${context.strategicDirection}`, source ? `Approved source context:\n${source}` : ''].filter(Boolean).join('\n\n');
    },
    normalizeOutput(results, context) {
      return results?.[0]?.structuredOutput !== undefined ? results[0].structuredOutput : defaultStructuredOutput(id, context, rawTexts(results));
    },
    validateOutput(output) {
      return validateSchema(output, definition.schema)
        && !violatesUnsupportedClaimSafety(output)
        && (id !== 'amazon_keyword_guidance' || !violatesMarketplaceEvidenceSafety(output));
    },
    presentOutput(output, rawResults) {
      const text = Object.entries(output).map(([key, value]) => `${labels[key] || humanLabel(key)}: ${Array.isArray(value) ? value.join('; ') : value}`).join('\n\n');
      return [{ text, tone: rawResults?.[0]?.tone || 'professional' }];
    },
    presentationSections(output) {
      return Object.keys(definition.schema).filter(key => output?.[key] !== undefined).map(key => ({ key, label: labels[key] || humanLabel(key), value: output[key], isList: Array.isArray(output[key]) }));
    }
  });
}

const contracts = Object.freeze(Object.fromEntries(Object.entries(DEFINITIONS).map(([id, definition]) => [id, makeContract(id, definition)])));
function getProductionContract(id) { return contracts[id] || null; }
function getProductionContractIds() { return Object.keys(contracts); }
module.exports = { getProductionContract, getProductionContractIds };
