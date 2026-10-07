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
  /\b(?:synthesisTrace|sourceDeliverable|sourceField|permittedUses|SYNTHESIS_[A-Z0-9_]+)\b/i,
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
  /\bclinically tested\b/i,
  /\b(?:superior|better) absorption\b/i,
  /\benhanced bioavailability\b/i,
  /\b(?:lowers?|reduces?) blood (?:sugar|glucose)\b/i,
  /\b(?:treats?|supports? (?:the )?treatment of) (?:diabetes|disease|illness|condition)\b/i,
  /\b(?:better|more effective) than (?:ordinary |other )?[a-z][a-z -]{2,50}\b/i,
  /\b(?:FDA|USDA)\s+(?:approved|certified)\b/i,
  /\bcertified organic\b/i,
  /\bthird[- ]party tested\b/i,
  /\bdoctor[- ]recommended\b/i,
  /\b(?:customers? love|highly rated)\b/i,
  /\b(?:cures?|prevents?)\s+(?:a |an |the )?[a-z][a-z -]{2,50}\b/i,
  /\b(?:proven|guaranteed)\s+(?:to|results?|returns?)\b/i,
  /\b\d+(?:\.\d+)?%\s+(?:effective|improvement|better|faster|return|roi)\b/i,
  /(?:^|\s)#1\b/i,
  /\bbest[- ]selling\b/i,
  /\b(?:rated\s+\d(?:\.\d+)?|five[- ]star rated)\b/i,
  /\btrusted by\s+\d[\d,]*\b/i
];
const UNSUPPORTED_PRODUCT_COMPOSITION_CLAIM = /\b(?:contains|made with|formulated with)\s+[a-z0-9][a-z0-9 ,&+/-]{2,80}\b/i;

const CLAIM_QUALIFIERS = /\b(?:not|no|without|avoid|do not|does not|must not|cannot|consider whether|unsubstantiated|unsupported|unverified|hypothesis|hypotheses|to investigate|to validate|requires? validation|once established|if established|before adoption)\b/i;
const META_OUTPUT_LANGUAGE = /^(?:here (?:is|are)|here's|i (?:have )?(?:created|prepared|generated)|as requested|the requested deliverable)\b/i;
const MINIMUM_OUTPUT_CHARACTERS = 80;
const CUSTOMER_POLICY_LANGUAGE = /\b(?:confirmed features|unsupported outcomes|builder[- ]provided facts?|claim substantiation|evidence state|validated attributes|unverified performance claims?)\b/i;
const PRODUCT_LAUNCH_CUSTOMER_COPY = new Set([
  'amazon_listing', 'amazon_bullet_points', 'amazon_keyword_guidance', 'amazon_a_plus',
  'ecommerce_product_page', 'ecommerce_trust_faq', 'ecommerce_conversion_copy',
  'product_image_guidance', 'launch_announcement', 'educational_content', 'social_launch_campaign'
]);
const { evaluateSubstantiveUsefulness } = require('./productionUsefulness');
const { validateClaimSupport } = require('./productionClaims');
const { evaluateCompositionFit } = require('./productionComposition');
const { inspectEditorialOutput } = require('./productionEditorial');
const { validateReadyAssetProfile } = require('./productionValidationProfiles');
const { validateSemanticCoherence } = require('./productionSemantics');
const { validateSynthesis } = require('./productionDependencySynthesis');
const { searchEditorialFailures } = require('./productionSearchEditorial');
const { validateArticleEvidence, validateResearchPack } = require('./productionResearchEvidence');
const { isCustomerReadablePlanningDocument } = require('./productionArtifactPolicy');
const PRODUCER_INSTRUCTION_LANGUAGE = [
  /\buse paid advertising to reach\b/i,
  /\bthis campaign is (?:built|designed|intended)\b/i,
  /\b(?:the|this) (?:ad|campaign|message|copy|section|page|content|article|draft) (?:should|must|needs|stays)\b/i,
  /\b(?:keep|test|measure|track|scale) (?:the |this |one )?(?:message|campaign|ad|copy|lead quality|conversion|spend)\b/i,
  /\b(?:before publishing|before (?:the )?ads? go live|before launch|after performance is validated)\b/i,
  /\b(?:should be added here|if you add testimonials|if no proof points|remove this section)\b/i,
  /\b(?:can I use this page for paid advertising|should we include reviews|what should we verify before publishing|does (?:this|the) page make performance promises)\b/i,
  /\b(?:presented as a service description|should only be added after|before (?:being )?used in customer-facing (?:materials|copy)|supporting evidence before|should be supported by evidence before|before (?:it is|they are) presented here)\b/i,
  /\b(?:available evidence is (?:still )?incomplete|claims? (?:are|is) not yet validated|validation-and-learning program|should be treated as (?:a )?(?:test|validation|learning|hypothesis))\b/i
];
const UNCONFIRMED_PUBLICATION_LANGUAGE = /\b(?:we|our team|the business) (?:published|launched|released|updated|are updating|is updating|have published|have launched|have released|have updated)\b|\b(?:our|the) (?:latest|new|newly published|newly released) (?:article|guide|post|content|page)\b|\bthis new (?:article|guide|post|content|page)\b/i;
const INVENTED_AUDIENCE_BEHAVIOR = [
  /\b(?:customers?|clients?|prospects?|readers?|owners?|businesses?|companies|they)\s+(?:often|usually|typically|generally|commonly|rarely)\s+(?:need|want|look(?:ing)?|seek(?:ing)?|struggle|prefer|expect|care|begin|face|find|have|do)\b/i,
  /\b(?:business|company) owners?\s+(?:often|usually|typically|generally|commonly|rarely)?\s*(?:need|want|look(?:ing)?|seek(?:ing)?|struggle|prefer|expect|care|begin|face|find|have|do)\b/i,
  /\b(?:questions?|concerns?|issues?|reviews?|decisions?|process(?:es)?)\s+(?:often|usually|typically|generally|commonly)\s+(?:includes?|involves?|arise|come up|begins?|requires?|focus(?:es)?|centers?)\b/i,
  /\b(?:for )?(?:many|most|some) (?:customers?|clients?|prospects?|readers?|owners?|businesses?|companies)\b/i,
  /\b(?:some|other) (?:customers?|clients?|prospects?|readers?|owners?|businesses?|companies)\s+(?:keep|rely|prefer|choose|need|want|use|handle|manage)\b/i,
  /\b(?:the )?(?:challenge|problem|priority|goal|need)\s+(?:is|becomes)\s+(?:often|usually|typically|generally|commonly)\b/i,
  /\b(?:good|better|clear|stable|consistent|professional)\s+[a-z -]{2,40}\s+(?:usually|often|generally|typically)?\s*(?:gives?|creates?|reduces?|improves?|makes?|restores?|helps?)\s+(?:you|owners?|businesses?|companies|customers?)\b/i
];
const UNRESOLVED_PUBLIC_PLACEHOLDER = /\[(?:link|url|booking link|business name|company name|insert[^\]]*)\]/i;
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

function unsupportedClaimMatches(value, options = { productComposition: true }) {
  const patterns = options.productComposition !== false
    ? [...UNSUPPORTED_CLAIM_LANGUAGE, UNSUPPORTED_PRODUCT_COMPOSITION_CLAIM]
    : UNSUPPORTED_CLAIM_LANGUAGE;
  const builderFactText = customerStrings(options.builderFacts || [], []).join(' ');
  const normalizedFacts = normalizedCustomerText(builderFactText);
  const groundedComposition = function(sentence) {
    const match = String(sentence).match(UNSUPPORTED_PRODUCT_COMPOSITION_CLAIM);
    if (!match || !normalizedFacts) return false;
    const tokens = normalizedCustomerText(match[0])
      .split(' ')
      .filter(token => token.length > 2 && !['contains', 'made', 'with', 'formulated'].includes(token));
    return tokens.length > 0 && tokens.filter(token => normalizedFacts.includes(token)).length / tokens.length >= 0.6;
  };
  return String(value || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(sentence => sentence && !CLAIM_QUALIFIERS.test(sentence))
    .flatMap(sentence => patterns
      .map((pattern, index) => pattern.test(sentence)
        && !(index === UNSUPPORTED_CLAIM_LANGUAGE.length && groundedComposition(sentence)) ? {
        rule: index === UNSUPPORTED_CLAIM_LANGUAGE.length ? 'product_composition' : `unsupported_claim_${index + 1}`,
        excerpt: sentence.trim().slice(0, 240)
      } : null)
      .filter(Boolean));
}

function containsUnsupportedClaim(value, options = { productComposition: true }) {
  return unsupportedClaimMatches(value, options).length > 0;
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

function meaningfulWords(value) {
  return normalizedCustomerText(value).split(' ').filter(word => word.length > 2);
}

function longNgrams(value, size = 9) {
  const words = meaningfulWords(value);
  const grams = [];
  for (let index = 0; index <= words.length - size; index += 1) grams.push(words.slice(index, index + size).join(' '));
  return grams;
}

function hasPathologicalLongPhraseRepetition(strings) {
  const occurrences = new Map();
  strings.filter(value => String(value).trim().length >= 45).forEach((value, fieldIndex) => {
    const local = new Map();
    longNgrams(value).forEach(gram => local.set(gram, (local.get(gram) || 0) + 1));
    local.forEach((count, gram) => {
      const entry = occurrences.get(gram) || { fields: new Set(), repeatedWithinField: false };
      entry.fields.add(fieldIndex);
      if (count > 1) entry.repeatedWithinField = true;
      occurrences.set(gram, entry);
    });
  });
  return Array.from(occurrences.values()).some(entry => entry.repeatedWithinField || entry.fields.size >= 3);
}

function actionCta(value) {
  return /^(?:learn|explore|see|view|review|shop|discover|read|get|start|compare|visit|choose)\b/i.test(String(value || '').trim());
}

function distinctStrings(values) {
  return new Set(values.map(normalizedCustomerText).filter(Boolean)).size;
}

function customerCopySubstanceFailure(output, contract) {
  const id = contract?.id;
  if (id === 'ecommerce_product_page') {
    const content = Array.isArray(output?.content) ? output.content : [];
    if (content.length < 7 || content.join(' ').length < 600 || distinctStrings(content) < 6 || !actionCta(content.at(-1))) return 'ECOMMERCE_SUBSTANCE';
  }
  if (id === 'amazon_listing') {
    const content = Array.isArray(output?.content) ? output.content : [];
    if (content.length < 5 || content.join(' ').length < 450 || distinctStrings(content) < 5 || String(content[0] || '').length > 180) return 'AMAZON_SUBSTANCE';
  }
  if (id === 'launch_announcement') {
    if (String(output?.body || '').length < 120 || !Array.isArray(output?.keyBenefits) || output.keyBenefits.length < 3
      || !actionCta(output?.callToAction) || normalizedCustomerText(output?.subjectLine) === normalizedCustomerText(output?.headline)) return 'LAUNCH_SUBSTANCE';
  }
  if (id === 'educational_content') {
    const lessons = Array.isArray(output?.keyLessons) ? output.keyLessons : [];
    const takeaways = Array.isArray(output?.practicalTakeaways) ? output.practicalTakeaways : [];
    const total = [output?.introduction, ...lessons, ...takeaways, output?.conclusion].join(' ').length;
    if (lessons.length < 4 || takeaways.length < 3 || distinctStrings(lessons) < 4 || total < 650 || !actionCta(output?.callToAction)) return 'EDUCATIONAL_SUBSTANCE';
  }
  if (id === 'social_launch_campaign') {
    const posts = Array.isArray(output?.posts) ? output.posts : [];
    const openings = posts.map(post => meaningfulWords(post).slice(0, 6).join(' '));
    if (posts.length < 3 || posts.some(post => String(post).length < 75) || distinctStrings(posts) < 3 || new Set(openings).size < 3) return 'SOCIAL_SUBSTANCE';
  }
  return null;
}

function paragraphTokens(value) {
  return new Set(normalizedCustomerText(value).split(' ').filter(token => token.length > 3));
}

function overlapRatio(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  left.forEach(token => { if (right.has(token)) shared += 1; });
  return shared / Math.min(left.size, right.size);
}

function hasRepetitiveOrganicCopy(output, contract) {
  if (contract?.id !== 'organic_content_campaign') return false;
  const paragraphs = (contract.publicFieldKeys || [])
    .flatMap(field => customerStrings(output?.[field], []))
    .flatMap(value => String(value).split(/\n\s*\n+/))
    .map(value => value.replace(/^#{1,6}\s+/, '').trim())
    .filter(value => value.length >= 120)
    .map(value => ({ normalized: normalizedCustomerText(value), tokens: paragraphTokens(value) }));
  for (let i = 0; i < paragraphs.length; i += 1) {
    for (let j = i + 1; j < paragraphs.length; j += 1) {
      if (paragraphs[i].normalized === paragraphs[j].normalized
        || overlapRatio(paragraphs[i].tokens, paragraphs[j].tokens) >= 0.82) return true;
    }
  }
  return false;
}

function containsProducerInstructions(output, contract) {
  const fields = contract?.publicFieldKeys || [];
  return fields.some(function(field) {
    return customerStrings(output?.[field], []).some(value => PRODUCER_INSTRUCTION_LANGUAGE.some(pattern => pattern.test(value)));
  });
}

function containsUnconfirmedPublicationStatus(output, contract) {
  if (contract?.id !== 'organic_content_campaign') return false;
  return (contract.publicFieldKeys || []).some(field => customerStrings(output?.[field], []).some(value => UNCONFIRMED_PUBLICATION_LANGUAGE.test(value)));
}

function containsInventedAudienceBehavior(output, contract) {
  if (contract?.id !== 'organic_content_campaign') return false;
  return (contract.publicFieldKeys || []).some(field => customerStrings(output?.[field], []).some(value => INVENTED_AUDIENCE_BEHAVIOR.some(pattern => pattern.test(value))));
}

function containsUnresolvedPublicPlaceholder(output, contract) {
  if (contract?.id !== 'organic_content_campaign') return false;
  return (contract.publicFieldKeys || []).some(field => customerStrings(output?.[field], []).some(value => UNRESOLVED_PUBLIC_PLACEHOLDER.test(value)));
}

function usesEvidenceAwareOrganicQuality(contract) {
  if (contract?.id !== 'organic_content_campaign') return false;
  const match = String(contract.version || '').match(/:v(\d+)$/);
  return Number(match?.[1] || 0) >= 7;
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
  const strings = (contract.readyToUse || contract.id === 'research_evidence_pack') && (contract.publicFieldKeys || []).length
    ? contract.publicFieldKeys
      .filter(field => contract.outputSchema?.[field] !== 'optional_string' || String(output?.[field] || '').trim())
      .flatMap(field => customerStrings(output?.[field], []))
    : customerStrings(output);
  const allStrings = customerStrings(output);
  if (!strings.length || strings.some(value => !value.trim())) return { valid: false, code: 'PRODUCTION_QUALITY_REQUIRED_CONTENT_MISSING' };
  if (SUBSTANTIVE_CONTRACTS.has(contract.id)
    && strings.reduce((total, value) => total + value.trim().length, 0) < MINIMUM_OUTPUT_CHARACTERS) {
    return { valid: false, code: 'PRODUCTION_QUALITY_INSUFFICIENT_SUBSTANCE' };
  }
  if (contract.id !== 'research_evidence_pack' && hasRepetitiveCustomerOutput(allStrings)) return { valid: false, code: 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT' };
  const legacyLifecycleFailure = strings.some(value => /\b(?:recommended positioning direction|validate the direction|invite the customer|confirmed product information|customer claim|investigate the product direction)\b/i.test(value));
  if (PRODUCT_LAUNCH_CUSTOMER_COPY.has(contract.id) && !legacyLifecycleFailure && hasPathologicalLongPhraseRepetition(strings)) return { valid: false, code: 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT' };
  if (PRODUCT_LAUNCH_CUSTOMER_COPY.has(contract.id) && strings.some(value => CUSTOMER_POLICY_LANGUAGE.test(value))) return { valid: false, code: 'PRODUCTION_QUALITY_POLICY_LANGUAGE' };
  if (hasRepetitiveOrganicCopy(output, contract)) return { valid: false, code: 'PRODUCTION_QUALITY_REPETITIVE_OUTPUT' };
  const evidenceAwareOrganic = usesEvidenceAwareOrganicQuality(contract);
  const customerReadablePlanning = isCustomerReadablePlanningDocument(contract);
  // Imperative language is leakage in publishable copy, but it is often the
  // substance of a planning document (for example, what to confirm or measure).
  if (!customerReadablePlanning && !evidenceAwareOrganic && containsProducerInstructions(output, contract)) return { valid: false, code: 'PRODUCTION_QUALITY_PRODUCER_INSTRUCTIONS' };
  if (containsUnconfirmedPublicationStatus(output, contract)) return { valid: false, code: 'PRODUCTION_QUALITY_UNCONFIRMED_PUBLICATION_STATUS' };
  if (!evidenceAwareOrganic && containsInventedAudienceBehavior(output, contract)) return { valid: false, code: 'PRODUCTION_QUALITY_INVENTED_AUDIENCE_BEHAVIOR' };
  if (containsUnresolvedPublicPlaceholder(output, contract)) return { valid: false, code: 'PRODUCTION_QUALITY_UNRESOLVED_PLACEHOLDER' };
  const editorialIssues = customerReadablePlanning ? [] : inspectEditorialOutput(output, contract);
  if (editorialIssues.length) {
    return { valid: false, code: 'PRODUCTION_QUALITY_EDITORIAL', details: { editorialIssues } };
  }
  for (const value of strings) {
    if (containsInternalContextLeak(value)) return { valid: false, code: 'PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK' };
    if (looksLikeSerializedContext(value)) return { valid: false, code: 'PRODUCTION_QUALITY_SERIALIZED_CONTEXT_LEAK' };
    const builderFacts = [
      context?.strategySnapshot?.builderProductContext?.value,
      context?.strategySnapshot?.builderDifferentiationDetails?.value,
      context?.strategySnapshot?.confirmedSalesChannel?.value,
      ...(context?.builderFacts || [])
    ].filter(Boolean);
    const unsupportedClaims = unsupportedClaimMatches(value, {
      productComposition: contract.id !== 'organic_content_campaign',
      builderFacts
    });
    if (unsupportedClaims.length) {
      return {
        valid: false,
        code: 'PRODUCTION_QUALITY_UNSUPPORTED_CLAIM',
        details: { unsupportedClaims: unsupportedClaims.slice(0, 8) }
      };
    }
    if (META_OUTPUT_LANGUAGE.test(value.trim())) return { valid: false, code: 'PRODUCTION_QUALITY_META_OUTPUT' };
  }
  if (contract.id === 'organic_content_campaign' && context?.compositionBrief) {
    const compositionFit = evaluateCompositionFit(output, context.compositionBrief);
    if (!compositionFit.valid) return { valid: false, code: 'PRODUCTION_QUALITY_DOMAIN_FIT', details: compositionFit };
  }
  const claimSupport = validateClaimSupport(output, contract, context);
  if (!claimSupport.valid) return { valid: false, code: 'PRODUCTION_QUALITY_CLAIM_PROVENANCE', details: claimSupport };
  const usefulness = evaluateSubstantiveUsefulness(output, contract, context);
  if (!usefulness.valid) return { valid: false, code: 'PRODUCTION_QUALITY_INSUFFICIENT_USEFULNESS', details: usefulness };
  if (contract.id === 'product_positioning' && !validateProductPositioningSemantics(output)) {
    return { valid: false, code: 'PRODUCTION_QUALITY_POSITIONING_SEMANTICS' };
  }
  const profileResult = validateReadyAssetProfile(output, contract, context);
  if (!profileResult.valid) return profileResult;
  const copySubstanceFailure = legacyLifecycleFailure ? null : customerCopySubstanceFailure(output, contract);
  if (copySubstanceFailure) return { valid: false, code: 'PRODUCTION_QUALITY_INSUFFICIENT_SUBSTANCE', details: { rule: copySubstanceFailure } };
  const semanticResult = validateSemanticCoherence(output, contract, context);
  if (!semanticResult.valid) return semanticResult;
  const synthesisResult = validateSynthesis(output, contract, context);
  if (!synthesisResult.valid) return synthesisResult;
  if (contract.id === 'priority_search_article') {
    const failures = searchEditorialFailures(output, context);
    if (failures.length) return { valid: false, code: 'SEARCH_EDITORIAL_QUALITY_FAILED', details: { failures: failures.slice(0, 12) } };
  }
  if (contract.id === 'research_evidence_pack') {
    const failures = validateResearchPack(output);
    if (failures.length) return { valid: false, code: 'RESEARCH_EVIDENCE_QUALITY_FAILED', details: { failures } };
  }
  if (contract.id === 'priority_search_article') {
    const failures = validateArticleEvidence(output, context);
    if (failures.length) return { valid: false, code: 'RESEARCH_ARTICLE_EVIDENCE_FAILED', details: { failures } };
  }
  return { valid: true, code: null };
}

function assertCustomerReadyOutput(output, contract, context) {
  const result = validateCustomerReadyOutput(output, contract, context);
  if (!result.valid) {
    const error = new Error('Production output did not meet customer-facing quality requirements');
    error.code = result.code;
    error.details = result.details || null;
    throw error;
  }
  return output;
}

module.exports = {
  assertCustomerReadyOutput,
  containsInternalContextLeak,
  containsProducerInstructions,
  containsUnconfirmedPublicationStatus,
  containsInventedAudienceBehavior,
  containsUnresolvedPublicPlaceholder,
  containsUnsupportedClaim,
  unsupportedClaimMatches,
  hasRepetitiveCustomerOutput,
  hasPathologicalLongPhraseRepetition,
  customerCopySubstanceFailure,
  hasRepetitiveOrganicCopy,
  looksLikeSerializedContext,
  validateProductPositioningSemantics,
  evaluateSubstantiveUsefulness,
  inspectEditorialOutput,
  validateCustomerReadyOutput
};
