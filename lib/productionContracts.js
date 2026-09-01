const DEFINITIONS = {
  customer_profile: { contentType: 'sales_message', dependencies: [], schema: { summary: 'string', primaryCustomer: 'string', needs: 'array', motivations: 'array', objections: 'array', buyingTriggers: 'array', languageStyle: 'string' }, labels: ['Profile Summary', 'Primary Customer', 'Needs', 'Motivations', 'Objections', 'Buying Triggers', 'Language & Communication Style'] },
  product_concept_brief: { contentType: 'sales_message', dependencies: ['customer_profile'], schema: { conceptSummary: 'string', directionsToExplore: 'array', customerAndNeed: 'string', openDecisions: 'array', evidenceBoundaries: 'array', nextDefinitionSteps: 'array' }, labels: ['Working Concept', 'Directions to Explore', 'Customer & Need', 'Open Decisions', 'Evidence Boundaries', 'Next Definition Steps'] },
  product_positioning: { contentType: 'sales_message', dependencies: ['customer_profile'], schema: { positioningStatement: 'string', marketPosition: 'string', differentiation: 'string', proofPoints: 'array', positioningPillars: 'array', messagingImplications: 'array' }, labels: ['Positioning Statement', 'Market Position', 'Core Differentiation', 'Reasons to Believe', 'Positioning Pillars', 'Messaging Implications'] },
  value_proposition: { contentType: 'sales_message', dependencies: ['customer_profile', 'product_positioning'], schema: { primaryValueProposition: 'string', customerProblemOrDesire: 'string', promisedOutcome: 'string', reasonsToBelieve: 'array', differentiators: 'array', supportingMessages: 'array' }, labels: ['Primary Value Proposition', 'Customer Problem or Desire', 'Promised Outcome', 'Reasons to Believe', 'Differentiators', 'Supporting Messages'] },
  validation_plan: { contentType: 'sales_message', dependencies: ['customer_profile', 'product_concept_brief', 'product_positioning', 'value_proposition'], schema: { validationObjective: 'string', hypotheses: 'array', customerQuestions: 'array', conceptTests: 'array', evidenceToCollect: 'array', decisionCriteria: 'array', nextActions: 'array' }, labels: ['Validation Objective', 'Hypotheses to Test', 'Customer Questions', 'Concept Tests', 'Evidence to Collect', 'Decision Criteria', 'Next Actions'] },
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
const PLACEHOLDER_FREE_DELIVERABLES = new Set([
  'amazon_listing',
  'amazon_bullet_points',
  'customer_profile',
  'product_concept_brief',
  'product_positioning',
  'value_proposition',
  'validation_plan',
  'core_messaging',
  'amazon_keyword_guidance'
]);
const MEASURED_EVIDENCE_FREE_DELIVERABLES = new Set([
  'product_concept_brief',
  'validation_plan',
  'amazon_keyword_guidance'
]);
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

function dependencyValues(context, id, key) {
  const value = context?.dependencyOutputs?.find(item => item.deliverableId === id)?.output?.[key];
  if (Array.isArray(value)) return value.filter(nonEmptyString);
  return nonEmptyString(value) ? [value] : [];
}

function groundedValue(context, key) {
  const item = context?.strategySnapshot?.[key];
  return nonEmptyString(item?.value) && item.value !== 'Unknown' ? item.value : null;
}

function explorationDirections(context) {
  const match = String(context?.strategicDirection || '').match(/Exploration intent:\s*([^·]+)/i);
  if (!match) return [];
  const value = match[1].trim().replace(/[.]$/, '');
  if (!value || /remains open/i.test(value)) return [];
  return value.split(/\s*;\s*/).map(item => item.trim()).filter(nonEmptyString);
}

function builderProductContext(context) {
  const match = String(context?.strategicDirection || '').match(/Builder-provided product context:\s*(.+?)\.\s*Treat this as unverified context/i);
  return match?.[1]?.trim() || null;
}

function defaultStructuredOutput(id, context, texts) {
  const safe = texts.filter(text => !/create the approved|completed prerequisite outputs|approved source context/i.test(text));
  const at = index => safe[index % Math.max(1, safe.length)] || 'To be confirmed';
  if (id === 'customer_profile') {
    const customer = groundedValue(context, 'primaryCustomer') || 'The priority customer segment';
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const style = groundedValue(context, 'communicationStyle') || 'Clear, credible, and reassuring';
    const inferred = strategyRole(context, 'primaryCustomer') === 'inferred_fact';
    return {
      summary: `${customer} is the current ${inferred ? 'inferred' : 'established'} audience for a product direction centered on ${motivation}. Treat this as a working customer hypothesis and validate the priorities below before launch investment.`,
      primaryCustomer: `${customer}${inferred ? ' — inferred from the product description and requiring validation' : ''}`,
      needs: [
        `A credible, easy-to-understand way to pursue ${motivation} without unsupported promises.`,
        'Clear information about intended use, product quality, and the evidence supporting any benefit statement.'
      ],
      motivations: [
        `${motivation} is the confirmed product direction; validate how strongly it motivates this audience.`,
        'Confidence that the product is transparent, appropriate, and supported by trustworthy information.'
      ],
      objections: [
        'Unclear product evidence, quality standards, or substantiation may reduce trust.',
        'A broad audience definition may feel generic until a more specific use context is validated.'
      ],
      buyingTriggers: [
        `A clear explanation of how the product direction relates to ${motivation}, without implying a certain outcome.`,
        'Transparent quality information, credible proof, and language that makes limitations clear.'
      ],
      languageStyle: `${style}. Explain evidence and uncertainty plainly; avoid inflated efficacy or medical language.`
    };
  }
  if (id === 'product_concept_brief') {
    const customer = groundedValue(context, 'primaryCustomer')
      || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the current priority customer');
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const directions = explorationDirections(context);
    const workingDirections = directions.length ? directions : ['Define the product direction with prospective customers'];
    return {
      conceptSummary: `A working product concept for the current audience (${customer}), centered on the intended outcome (${motivation}). This brief defines directions to explore; it does not establish a finished formula, efficacy, or product claim.`,
      directionsToExplore: workingDirections,
      customerAndNeed: `Validate how people in the current audience (${customer}) describe and prioritize the intended outcome (${motivation}), using their language rather than assuming a medical need or promised result.`,
      openDecisions: [
        'Product format, formulation, and ingredients remain open unless separately established.',
        'Competitive differentiation and customer-facing price position still require validation.',
        'Any benefit statement requires appropriate evidence before it can become a product claim.'
      ],
      evidenceBoundaries: [
        'Exploration choices are preferences to investigate, not confirmed product characteristics.',
        'No efficacy, clinical substantiation, certification, market demand, or competitive advantage is assumed.'
      ],
      nextDefinitionSteps: [
        'Interview prospective customers about the need, current alternatives, and decision criteria.',
        'Compare the selected concept directions for relevance, credibility, and responsible product-development feasibility.',
        'Document only the product facts and evidence that are actually established.'
      ]
    };
  }
  if (id === 'product_positioning') {
    const customer = groundedValue(context, 'primaryCustomer')
      || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the priority customer');
    const market = groundedValue(context, 'marketPosition');
    const difference = groundedValue(context, 'competitiveApproach');
    const motivation = groundedValue(context, 'customerMotivation');
    const dependencyNeed = dependencyValue(context, 'customer_profile', 'needs', '');
    const need = motivation
      || (dependencyNeed && dependencyNeed !== 'To be confirmed' ? dependencyNeed.replace(/[.!?]+$/, '') : null)
      || 'the customer’s priority';
    const recommended = strategyRole(context, 'marketPosition') === 'strategic_recommendation';
    const positioningStatement = market
      ? `For ${customer} seeking ${motivation || need}, explore ${market} as ${recommended ? 'a recommended positioning direction' : 'the established market position'}. Anchor the story in ${need} and validate the direction before treating it as a customer claim.`
      : `For ${customer}, center the positioning hypothesis on ${need}. Confirm the market frame and competitive alternative before treating this direction as final.`;
    const differentiation = difference
      ? `${difference} is a strategic approach to validate; it is not established product proof.`
      : 'Competitive differentiation remains open and must be established through customer and market validation.';
    return {
      positioningStatement,
      marketPosition: market ? `${market}${recommended ? ' — recommended direction to validate' : ''}` : 'Open decision — market position requires validation',
      differentiation,
      proofPoints: [
        `Validate whether ${customer} prioritize ${need}.`,
        market ? `Test whether “${market}” is clear, relevant, and distinct to the intended customer.` : 'Compare credible market-position options before selecting one.',
        'Document substantiated product evidence before making benefit or performance claims.'
      ],
      positioningPillars: [
        `Customer focus: ${customer}`,
        `Priority need: ${need}`,
        market ? `Market direction: ${market}` : 'Market direction: to be validated'
      ],
      messagingImplications: [
        `Lead with the customer priority—${need}—without implying an unverified outcome.`,
        difference ? `Use ${difference} as a credibility theme only after supporting evidence is established.` : 'Avoid uniqueness claims until a defensible difference is confirmed.',
        'Keep exploratory directions, formulation details, and efficacy claims explicitly provisional until validated.'
      ]
    };
  }
  if (id === 'value_proposition') {
    const customer = groundedValue(context, 'primaryCustomer') || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the priority customer');
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const market = groundedValue(context, 'marketPosition');
    return {
      primaryValueProposition: `For ${customer}, explore a product concept that makes ${motivation} easier to understand and evaluate through transparent information, credible quality signals, and claims limited to established evidence.`,
      customerProblemOrDesire: `${customer} may want support related to ${motivation}, but need clarity and trust before deciding whether a product is relevant. Validate this problem framing with prospective customers.`,
      promisedOutcome: `A clearer, more confident way to evaluate a ${motivation} product direction—not a promise of a health result.`,
      reasonsToBelieve: [
        'Substantiated product and quality evidence, once established.',
        'Transparent explanation of intended use, limitations, and the basis for every benefit statement.',
        'Customer validation showing that the proposed direction is relevant and understandable.'
      ],
      differentiators: [
        market ? `${market} is the recommended market direction to test, not a confirmed competitive position.` : 'A market position must be validated before uniqueness can be claimed.',
        'Credibility and transparency can become differentiators only when supported by real product proof.'
      ],
      supportingMessages: [
        `Built around the customer interest in ${motivation}, with evidence established before promotion.`,
        'Clear about what is known, what remains a hypothesis, and what must be validated next.'
      ]
    };
  }
  if (id === 'validation_plan') {
    const customer = groundedValue(context, 'primaryCustomer')
      || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the current priority customer');
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const directions = dependencyValues(context, 'product_concept_brief', 'directionsToExplore');
    const concept = directions.length ? directions.join('; ') : 'the working product direction';
    return {
      validationObjective: `Determine whether people in the current audience (${customer}) recognize a meaningful need related to the intended outcome (${motivation}) and whether the working concept directions merit further product development.`,
      hypotheses: [
        `People in the current audience (${customer}) can describe a meaningful priority related to the intended outcome (${motivation}) in their own words.`,
        `At least one working direction—${concept}—is understandable and relevant enough to investigate further.`,
        'A credible position can be developed without relying on unsubstantiated claims or invented differentiation.'
      ],
      customerQuestions: [
        `How do you currently think about or address the intended outcome (${motivation})?`,
        'What makes an option in this category feel credible, relevant, or inappropriate?',
        'Which parts of this concept are clear, confusing, valuable, or unnecessary?'
      ],
      conceptTests: [
        'Present the directions as separate concept hypotheses and record customer language and preferences.',
        'Compare comprehension and relevance without presenting a finished product or promising an outcome.',
        'Test the provisional positioning and value language for clarity before producing launch assets.'
      ],
      evidenceToCollect: [
        'Repeated customer language, priorities, objections, and current alternatives.',
        'Concept comprehension and preference patterns from appropriately selected prospective customers.',
        'Product-development and substantiation requirements identified by qualified specialists.'
      ],
      decisionCriteria: [
        'A clearly described customer priority is repeated across credible conversations.',
        'One concept direction is consistently understood without unsupported prompting.',
        'The next product-development step can be stated without inventing formula, efficacy, demand, or differentiation.'
      ],
      nextActions: [
        'Recruit a small, relevant set of prospective customers for structured discovery conversations.',
        'Record evidence separately from assumptions and revise the concept brief only from validated learning.',
        'Defer listing, imagery, and launch campaigns until sufficient product facts and proof exist.'
      ]
    };
  }
  if (id === 'amazon_keyword_guidance') {
    const customer = groundedValue(context, 'primaryCustomer') || 'the intended customer';
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended product outcome';
    const market = groundedValue(context, 'marketPosition') || 'the proposed market direction';
    return {
      summary: `Working Amazon search hypotheses for ${customer} around ${motivation}. These themes are starting points for marketplace research, not measured demand, competition, ranking, or search-volume evidence.`,
      content: [
        `Core intent hypothesis: shoppers exploring ${motivation}.`,
        `Audience hypothesis: terms combining ${motivation} with language used by ${customer}.`,
        `Positioning hypothesis: phrases related to ${market}, tested for clarity before adoption.`,
        'Problem-language research: collect the exact non-medical words prospective customers use to describe their need or desired experience.',
        'Trust-language research: investigate quality, transparency, format, and evidence terms without implying certifications or proof that do not exist.',
        'Validation next step: review Amazon autocomplete, relevant listings, customer questions, and compliant category language before selecting keywords.'
      ]
    };
  }
  if (id === 'amazon_listing') {
    const product = builderProductContext(context);
    if (!product) return { summary: 'To be confirmed', content: ['To be confirmed'] };
    const customer = groundedValue(context, 'primaryCustomer') || 'the confirmed audience';
    const motivation = groundedValue(context, 'customerMotivation') || 'the confirmed product purpose';
    const market = groundedValue(context, 'marketPosition');
    return {
      summary: `Working Amazon listing draft based on the builder-provided product context: ${product}. Verify every product fact and applicable marketplace requirement before publishing.`,
      content: [
        `Product description draft: ${product}.`,
        `Audience context: written for ${customer} around the established product direction (${motivation}), without promising a customer outcome.`,
        market ? `Positioning direction to validate: ${market}.` : 'Positioning remains an open decision and should not be invented in the listing.',
        'Evidence boundary: add only verified product attributes, usage details, substantiated claims, and required disclosures before publication.'
      ]
    };
  }
  if (id === 'amazon_bullet_points') {
    const product = builderProductContext(context);
    if (!product) return { summary: 'To be confirmed', content: ['To be confirmed'] };
    const customer = groundedValue(context, 'primaryCustomer') || 'the confirmed audience';
    const motivation = groundedValue(context, 'customerMotivation') || 'the confirmed product purpose';
    return {
      summary: `Working Amazon bullet-point directions for ${product}. These drafts organize established context and must be verified before publication.`,
      content: [
        `PRODUCT CONTEXT — ${product}.`,
        `AUDIENCE — Present the confirmed product facts clearly for ${customer}.`,
        `PURPOSE — Explain the intended direction (${motivation}) without promising efficacy or a certain result.`,
        'PROOF — Insert only substantiated quality, formulation, certification, and performance details.',
        'PURCHASE CLARITY — Confirm format, quantity, usage, warnings, and other required listing information before publishing.'
      ]
    };
  }
  if (id === 'core_messaging') {
    const customer = groundedValue(context, 'primaryCustomer')
      || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the intended customer');
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const market = groundedValue(context, 'marketPosition');
    const value = dependencyValue(context, 'value_proposition', 'primaryValueProposition', '');
    const position = dependencyValue(context, 'product_positioning', 'positioningStatement', '');
    const supportingMessages = dependencyValues(context, 'value_proposition', 'supportingMessages');
    const reasonsToBelieve = dependencyValues(context, 'value_proposition', 'reasonsToBelieve');
    const implications = dependencyValues(context, 'product_positioning', 'messagingImplications');
    const style = groundedValue(context, 'communicationStyle') || 'Clear, credible, and reassuring';
    return {
      coreMessage: value || position || `Help ${customer} evaluate a product direction related to ${motivation} through clear information, credible evidence, and appropriately limited claims.`,
      messagePillars: [
        `Customer relevance: connect the message to ${motivation} for ${customer} without promising an outcome.`,
        market ? `Market direction: use ${market} as a positioning hypothesis until customer and competitive validation support it.` : 'Market clarity: explain the intended role of the product before claiming a distinct position.',
        'Credibility: support every benefit statement with confirmed product facts and substantiated evidence.'
      ],
      supportingPoints: supportingMessages.length >= 2 ? supportingMessages : [
        `Explain what the product is intended to help ${customer} evaluate or pursue regarding ${motivation}.`,
        'Separate established product facts from hypotheses, recommendations, and details still requiring validation.',
        ...implications.slice(0, 1)
      ],
      toneGuidance: `${style}. Be specific about what is known and avoid medical, efficacy, superiority, or certainty language unless it is substantiated.`,
      proofThemes: reasonsToBelieve.length >= 2 ? reasonsToBelieve : [
        'Confirmed product attributes and quality information.',
        'Transparent explanation of intended use, limitations, and evidence.',
        'Customer validation demonstrating that the message is relevant and understandable.'
      ],
      callsToAction: [
        'Invite the customer to review the confirmed product information.',
        'Use a low-commitment next step until the product definition, evidence, and offer are finalized.'
      ]
    };
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
        : id === 'product_concept_brief'
          ? 'Treat product directions as exploration intent only. Do not convert them into ingredients, formulation facts, efficacy, certifications, substantiated claims, or a finished-product specification.'
          : id === 'validation_plan'
            ? 'Produce a plan for gathering evidence, not research findings. Do not invent interview results, demand, market size, search volume, competition metrics, efficacy, or substantiation.'
        : '';
      return [`Produce the customer-facing ${context.title}.`, 'Return the finished deliverable only; do not describe the task or quote instructions, schemas, contract metadata, or source context.', 'Use only established facts. Mark genuinely unknown proof or details as “To be confirmed” instead of inventing them.', safety, `Purpose: ${context.strategicDirection}`, source ? `Approved source context:\n${source}` : ''].filter(Boolean).join('\n\n');
    },
    normalizeOutput(results, context) {
      return results?.[0]?.structuredOutput !== undefined ? results[0].structuredOutput : defaultStructuredOutput(id, context, rawTexts(results));
    },
    generateOutput(context) {
      return defaultStructuredOutput(id, context, []);
    },
    validateOutput(output) {
      return validateSchema(output, definition.schema)
        && (!PLACEHOLDER_FREE_DELIVERABLES.has(id) || !/\bTo be confirmed\b/i.test(JSON.stringify(output)))
        && (!MEASURED_EVIDENCE_FREE_DELIVERABLES.has(id) || !violatesMarketplaceEvidenceSafety(output));
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
