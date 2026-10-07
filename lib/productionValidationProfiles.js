const READY_ASSET_FAMILIES = Object.freeze({
  consultation_conversion_page_copy: 'service_conversion',
  outreach_sequence: 'email',
  referral_campaign_kit: 'email',
  paid_ad_copy_set: 'paid_social',
  social_lead_campaign: 'paid_social',
  organic_content_campaign: 'organic',
  priority_search_article: 'search_editorial',
  lead_capture_page: 'landing_page',
  sales_call_script: 'sales_enablement',
  multi_channel_campaign_kit: 'paid_social',
  amazon_listing: 'marketplace_ecommerce',
  amazon_bullet_points: 'marketplace_ecommerce',
  amazon_a_plus: 'marketplace_ecommerce',
  ecommerce_product_page: 'marketplace_ecommerce',
  ecommerce_trust_faq: 'marketplace_ecommerce',
  ecommerce_conversion_copy: 'marketplace_ecommerce',
  abandoned_cart_email: 'launch_lifecycle',
  google_business_profile: 'local_web',
  service_page: 'landing_page',
  software_product_demo: 'product_education',
  saas_trial_emails: 'launch_lifecycle',
  launch_announcement: 'launch_lifecycle',
  educational_content: 'educational',
  social_launch_campaign: 'paid_social'
});

const ALLOWED_PLACEHOLDERS = Object.freeze({
  outreach_sequence: ['first name', 'recipient name', 'sender name', 'business name', 'company name', 'booking link', 'unsubscribe link', 'mailing address'],
  referral_campaign_kit: ['first name', 'recipient name', 'customer first name', 'partner first name', 'prospect first name', 'referrer first name', 'sender first name', 'sender name', 'business name', 'company name', 'booking link', 'unsubscribe link', 'mailing address'],
  abandoned_cart_email: ['first name', 'cart link', 'help link'],
  saas_trial_emails: ['first name', 'trial link', 'help link'],
  multi_channel_campaign_kit: ['first name', 'sender name', 'business name', 'company name', 'link', 'booking link'],
  lead_capture_page: ['business name', 'verified offer scope', 'verified response and scheduling process', 'verified price or pricing process'],
  sales_call_script: ['first name', 'verified aspect of the offer', 'confirmed next step', 'confirmed priority', 'next step', 'details'],
  service_page: ['business name', 'contact link']
});

const INTERNAL_IDENTIFIER = /\b(?:production_job_id|deliverable_id|contract_version|semanticRole|sourceFields|sourceField|sourceDeliverable|permittedUses|synthesisTrace|dependencyOutputs|evidenceLedger|SYNTHESIS_[A-Z0-9_]+|PRODUCTION_[A-Z0-9_]+|CONTRACT_[A-Z0-9_]+|READY_ASSET_[A-Z0-9_]+|MARKETPLACE_[A-Z0-9_]+|LIFECYCLE_[A-Z0-9_]+|PAID_SOCIAL_[A-Z0-9_]+)\b/i;
const GENERIC_FILLER = /^(?:lorem ipsum|insert (?:copy|text|content) here|write (?:copy|content) here|content goes here|sample (?:copy|text)|placeholder)$/i;
const MEASURED_CLAIM = /\b(?:\d+(?:\.\d+)?%|#\s*\d+|\d[\d,.]*\+?\s+(?:customers?|users?|reviews?|sales?|orders?|downloads?|views?|clicks?|followers?)|(?:high|low|growing|top|leading|best|most)\s+(?:search volume|conversion rate|engagement|demand|ranking|market share)|(?:search volume|conversion rate|engagement rate|market size|sales volume|review count|rating|rank(?:ing)?)\s+(?:is|of|at|above|below)\b)/i;
const CLAIM_QUALIFIER = /\b(?:if|when|may|might|could|consider|hypothesis|unverified|validate|verify|once established|if established|before claiming|do not claim|avoid claiming|requires? evidence)\b/i;
const INTERNAL_STRATEGY_COPY = /\b(?:positioning strategy|strategic direction|validation plan|testing plan|campaign objective|target audience is|internal (?:note|guidance|checklist)|marketer should|publisher should)\b/i;
const UNSUPPORTED_COMMERCE_CLAIM = /\b(?:certified|clinically|proven|guaranteed|non[- ]toxic|all[- ]natural|safe for everyone|eliminates?|cures?|prevents?|boosts?|relieves?|reduces?|improves?)\b/i;
const FABRICATED_LIFECYCLE_STATE = /\b(?:now available|now live|has launched|we(?:'ve| have) launched|your trial is ready|you left .{0,60} in your cart|only \d+ left|selling fast|ends? (?:today|tonight|soon)|limited time|hurry|act now|\d+(?:\.\d+)?% off)\b/i;
const FABRICATED_SOCIAL_SIGNAL = /\b(?:trending|viral|everyone is talking|thousands? of (?:likes|shares|views)|join \d[\d,]*|most popular|fans love|customers love)\b/i;
const UNSAFE_MARKDOWN = /```|<\/?(?:script|iframe|object|embed)\b/i;
const PUBLIC_PLANNING_LANGUAGE = /\b(?:recommended positioning direction|validate the direction|customer claim|investigate the product direction|confirmed product information|approved strategy|builder-provided context|planning foundation|invite the customer|use a low-commitment next step)\b/i;
const CUSTOMER_ACTION = /\b(?:explore|discover|learn|see|view|review|shop|visit|read|compare|choose)\b/i;

function profileForDeliverable(id, readyToUse) {
  if (!readyToUse) return null;
  const family = READY_ASSET_FAMILIES[id];
  if (!family) throw new Error(`Ready-to-use deliverable is missing a validation profile: ${id}`);
  return Object.freeze({
    policy: 'ready_asset_quality_v1',
    family,
    allowedPlaceholders: Object.freeze([...(ALLOWED_PLACEHOLDERS[id] || [])])
  });
}

function stringsFrom(value, field, result = []) {
  if (typeof value === 'string') result.push({ field, value });
  else if (Array.isArray(value)) value.forEach(item => stringsFrom(item, field, result));
  return result;
}

function publicStrings(output, contract) {
  return (contract.publicFieldKeys || [])
    .filter(field => contract.outputSchema?.[field] !== 'optional_string' || String(output?.[field] || '').trim())
    .flatMap(field => stringsFrom(output?.[field], field));
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return new Set(normalized(value).split(' ').filter(token => token.length > 3));
}

function overlap(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach(token => { if (b.has(token)) shared += 1; });
  return shared / Math.min(a.size, b.size);
}

function hasConfirmedSupport(value, context) {
  const claim = normalized(value);
  return (context?.evidenceLedger || []).some(entry => {
    if (entry.permittedUse !== 'public_claim') return false;
    const evidence = normalized(entry.value);
    return evidence.length >= 5 && (claim.includes(evidence) || evidence.includes(claim));
  });
}

function placeholderFailures(entries, profile) {
  const allowed = new Set(profile.allowedPlaceholders || []);
  const failures = [];
  entries.forEach(({ field, value }) => {
    const candidates = [
      ...(String(value).matchAll(/\[([^\]]+)\]/g)),
      ...(String(value).matchAll(/\{\{([^}]+)\}\}/g))
    ];
    candidates.forEach(match => {
      const name = normalized(match[1]);
      if (!allowed.has(name)) failures.push({ rule: 'unresolved_placeholder', field, excerpt: match[0].slice(0, 120) });
    });
  });
  return failures;
}

function duplicateFailures(entries, minimumLength = 24) {
  const failures = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[i].value.length < minimumLength || entries[j].value.length < minimumLength) continue;
      if (normalized(entries[i].value) === normalized(entries[j].value) || overlap(entries[i].value, entries[j].value) >= 0.88) {
        failures.push({ rule: 'near_duplicate_public_copy', field: `${entries[i].field},${entries[j].field}` });
        return failures;
      }
    }
  }
  return failures;
}

function baselineFailures(output, contract, context, profile) {
  const entries = publicStrings(output, contract);
  const failures = placeholderFailures(entries, profile);
  const total = entries.reduce((sum, item) => sum + item.value.trim().length, 0);
  if (!entries.length || entries.some(item => !item.value.trim())) failures.push({ rule: 'empty_public_content' });
  if (total < 80) failures.push({ rule: 'insufficient_public_substance', actual: total, minimum: 80 });
  entries.forEach(({ field, value }) => {
    const trimmed = value.trim();
    if (INTERNAL_IDENTIFIER.test(value)) failures.push({ rule: 'internal_identifier', field, excerpt: trimmed.slice(0, 180) });
    if (GENERIC_FILLER.test(trimmed)) failures.push({ rule: 'generic_filler', field, excerpt: trimmed.slice(0, 180) });
    if (UNSAFE_MARKDOWN.test(value)) failures.push({ rule: 'unsafe_markdown', field, excerpt: trimmed.slice(0, 180) });
    if (MEASURED_CLAIM.test(value) && !CLAIM_QUALIFIER.test(value) && !hasConfirmedSupport(value, context)) {
      failures.push({ rule: 'unsupported_measured_claim', field, excerpt: trimmed.slice(0, 180) });
    }
  });
  return failures;
}

function marketplaceFailures(output, contract, context, entries) {
  const failures = duplicateFailures(entries);
  entries.forEach(({ field, value }) => {
    if (INTERNAL_STRATEGY_COPY.test(value)) failures.push({ rule: 'internal_strategy_language', field, excerpt: value.slice(0, 180) });
    if (UNSUPPORTED_COMMERCE_CLAIM.test(value) && !CLAIM_QUALIFIER.test(value) && !hasConfirmedSupport(value, context)) {
      failures.push({ rule: 'unsupported_commerce_claim', field, excerpt: value.slice(0, 180) });
    }
  });
  if (['amazon_listing', 'amazon_bullet_points', 'amazon_a_plus'].includes(contract.id)) {
    const publicValues = entries.map(item => item.value);
    (context?.dependencyOutputs || []).filter(item => item.deliverableId === 'amazon_listing').forEach(dependency => {
      const upstream = Object.values(dependency.output || {}).flat().filter(value => typeof value === 'string');
      const reused = publicValues.flatMap(value => upstream.filter(source => value.length >= 60 && source.length >= 60 && normalized(value) === normalized(source))
        .map(source => ({ value, source })));
      const verbatimLongCopy = reused.some(pair => pair.value.length >= 80);
      if (reused.length >= 2 || verbatimLongCopy) {
        failures.push({ rule: 'dependency_copy_reuse' });
      }
    });
  }
  return failures;
}

function lifecycleFailures(entries, context, contract) {
  const failures = contract.id === 'launch_announcement' ? [] : duplicateFailures(entries);
  entries.forEach(({ field, value }) => {
    if (FABRICATED_LIFECYCLE_STATE.test(value) && !CLAIM_QUALIFIER.test(value) && !hasConfirmedSupport(value, context)) {
      failures.push({ rule: 'unsupported_lifecycle_state', field, excerpt: value.slice(0, 180) });
    }
  });
  return failures;
}

function launchCustomerCopyFailures(output, contract, context, entries) {
  if (!['launch_announcement', 'educational_content', 'social_launch_campaign'].includes(contract.id)) return [];
  const failures = [];
  entries.forEach(({ field, value }) => {
    if (PUBLIC_PLANNING_LANGUAGE.test(value)) failures.push({ rule: 'public_planning_language', field, excerpt: value.slice(0, 180) });
  });
  const publicText = entries.map(item => item.value).join(' ');
  const direction = String(context?.strategicDirection || '');
  const productContext = direction.match(/Builder-provided product context:\s*(.+?)\.\s*Treat this as unverified context/i)?.[1]
    || direction.match(/Builder-provided offer description:\s*(.+?)\.\s*Treat this as unverified context/i)?.[1]
    || '';
  const groundingTokens = normalized(productContext).split(' ').filter(token => token.length >= 5);
  if (groundingTokens.length && !groundingTokens.some(token => normalized(publicText).includes(token))) {
    failures.push({ rule: 'grounded_product_reference_missing' });
  }
  if (contract.id === 'launch_announcement') {
    if (String(output?.headline || '').trim().length < 12 || String(output?.body || '').trim().length < 160) failures.push({ rule: 'announcement_copy_insufficient' });
    if (!Array.isArray(output?.keyBenefits) || output.keyBenefits.length < 2) failures.push({ rule: 'announcement_benefits_insufficient' });
    if (!CUSTOMER_ACTION.test(String(output?.callToAction || ''))) failures.push({ rule: 'customer_facing_cta_missing', field: 'callToAction' });
  }
  if (contract.id === 'educational_content') {
    if (!Array.isArray(output?.keyLessons) || output.keyLessons.length < 3) failures.push({ rule: 'educational_lessons_insufficient' });
    if (!Array.isArray(output?.practicalTakeaways) || output.practicalTakeaways.length < 3) failures.push({ rule: 'educational_takeaways_insufficient' });
    if (!CUSTOMER_ACTION.test(String(output?.callToAction || ''))) failures.push({ rule: 'customer_facing_cta_missing', field: 'callToAction' });
  }
  if (contract.id === 'social_launch_campaign') {
    if (!Array.isArray(output?.posts) || output.posts.length < 3 || output.posts.some(post => String(post).trim().length < 80)) failures.push({ rule: 'social_posts_insufficient' });
    if (!Array.isArray(output?.hashtags) || output.hashtags.length < 2) failures.push({ rule: 'social_hashtags_insufficient' });
    if (!CUSTOMER_ACTION.test((output?.posts || []).join(' '))) failures.push({ rule: 'customer_facing_cta_missing', field: 'posts' });
  }
  return failures;
}

function paidSocialFailures(entries, context) {
  const failures = duplicateFailures(entries);
  entries.forEach(({ field, value }) => {
    if (INTERNAL_STRATEGY_COPY.test(value)) failures.push({ rule: 'internal_campaign_language', field, excerpt: value.slice(0, 180) });
    if (FABRICATED_SOCIAL_SIGNAL.test(value) && !CLAIM_QUALIFIER.test(value) && !hasConfirmedSupport(value, context)) {
      failures.push({ rule: 'unsupported_social_signal', field, excerpt: value.slice(0, 180) });
    }
  });
  return failures;
}

function serviceConversionFailures(output, entries, context) {
  const failures = duplicateFailures(entries);
  const text = entries.map(item => item.value).join(' ');
  if (/\b(?:shopper|add to cart|shipping|returns?|checkout|purchase behavior|product comprehension)\b/i.test(text)) failures.push({ rule: 'ecommerce_language_in_service_copy' });
  if (!/\b(?:consultation|appointment|call|assessment|quote)\b/i.test(text)) failures.push({ rule: 'consultation_action_missing' });
  const unsupported = /\b(?:\d+\+?\s+(?:years?|projects?|customers?|homeowners?)|\d(?:\.\d)?\s*stars?|award[- ]winning|licensed and insured|certified|guaranteed|same[- ]day|respond within|financing available|best in|#1)\b/i;
  entries.forEach(({ field, value }) => {
    if (unsupported.test(value) && !hasConfirmedSupport(value, context)) failures.push({ rule: 'unsupported_service_fact', field, excerpt: value.slice(0, 180) });
    if (INTERNAL_STRATEGY_COPY.test(value)) failures.push({ rule: 'internal_strategy_language', field, excerpt: value.slice(0, 180) });
  });
  if (!String(output?.primaryCallToAction || '').trim() || !String(output?.finalCallToAction || '').trim()) failures.push({ rule: 'consultation_cta_missing' });
  if (!Array.isArray(output?.processSteps) || output.processSteps.length < 3) failures.push({ rule: 'service_process_insufficient' });
  return failures;
}

function validateReadyAssetProfile(output, contract, context) {
  const profile = contract?.validationProfile;
  if (!contract?.readyToUse) return { valid: true, code: null };
  if (!profile?.family) return { valid: false, code: 'READY_ASSET_PROFILE_MISSING' };
  const entries = publicStrings(output, contract);
  const failures = baselineFailures(output, contract, context, profile);
  if (profile.family === 'marketplace_ecommerce') failures.push(...marketplaceFailures(output, contract, context, entries));
  if (profile.family === 'launch_lifecycle') failures.push(...lifecycleFailures(entries, context, contract));
  if (profile.family === 'paid_social') failures.push(...paidSocialFailures(entries, context));
  if (profile.family === 'service_conversion') failures.push(...serviceConversionFailures(output, entries, context));
  failures.push(...launchCustomerCopyFailures(output, contract, context, entries));
  if (!failures.length) return { valid: true, code: null };
  const prefix = profile.family === 'marketplace_ecommerce' ? 'MARKETPLACE'
    : profile.family === 'launch_lifecycle' ? 'LIFECYCLE'
      : profile.family === 'paid_social' ? 'PAID_SOCIAL'
        : profile.family === 'search_editorial' ? 'SEARCH_EDITORIAL'
          : profile.family === 'service_conversion' ? 'SERVICE_CONVERSION' : 'READY_ASSET';
  return { valid: false, code: `${prefix}_QUALITY_FAILED`, details: { failures: failures.slice(0, 12) } };
}

module.exports = {
  READY_ASSET_FAMILIES,
  profileForDeliverable,
  validateReadyAssetProfile
};
