const crypto = require('crypto');

const FIELD_POLICIES = Object.freeze({
  businessType: ['business_type', 'business', 'stable', false],
  industry: ['industry', 'business', 'stable', false],
  brand: ['brand_name', 'business', 'stable', false],
  brandVoice: ['brand_voice', 'business', 'stable', false],
  brandValues: ['brand_values', 'business', 'stable', true],
  brandConstraints: ['brand_constraints', 'business', 'stable', true],
  serviceMarket: ['geography', 'business', 'review_periodically', true],
  geographicMarket: ['geography', 'business', 'review_periodically', true],
  category: ['category', 'offer', 'stable', false],
  targetAudience: ['target_audience', 'offer', 'review_periodically', false],
  intendedOutcome: ['customer_need', 'offer', 'review_periodically', true],
  customerMotivation: ['customer_motivation', 'offer', 'review_periodically', true],
  currentAcquisitionChannel: ['current_channel', 'offer', 'review_periodically', true],
  salesChannel: ['current_channel', 'offer', 'review_periodically', true],
  trafficSource: ['current_channel', 'offer', 'review_periodically', true],
  currentOffer: ['confirmed_offer_fact', 'offer', 'stable', true],
  serviceDefinition: ['confirmed_offer_fact', 'offer', 'stable', true],
  websiteContext: ['confirmed_offer_fact', 'offer', 'stable', true],
  existingProductDefinition: ['confirmed_offer_fact', 'offer', 'stable', true],
  conceptMaturity: ['product_maturity', 'offer', 'current_state', false],
  launchStage: ['launch_stage', 'offer', 'current_state', false]
});

const CONCEPT_TO_FIELDS = Object.freeze({
  business_type: ['businessType'], industry: ['industry'], brand_name: ['brand'],
  brand_voice: ['brandVoice'], brand_values: ['brandValues'], brand_constraints: ['brandConstraints'],
  geography: ['serviceMarket', 'geographicMarket'], category: ['category'], target_audience: ['targetAudience'],
  customer_need: ['intendedOutcome', 'customerNeed'], customer_motivation: ['customerMotivation'],
  current_channel: ['currentAcquisitionChannel', 'salesChannel', 'trafficSource'],
  confirmed_offer_fact: ['currentOffer', 'serviceDefinition', 'websiteContext', 'existingProductDefinition'],
  product_maturity: ['conceptMaturity'], launch_stage: ['launchStage']
});

const CONCEPT_CARDINALITY = Object.freeze({
  business_type: 'single', industry: 'single', brand_name: 'single', brand_voice: 'single',
  category: 'single', target_audience: 'single', customer_need: 'multi', customer_motivation: 'multi',
  current_channel: 'multi', confirmed_offer_fact: 'multi', geography: 'multi',
  product_maturity: 'single', launch_stage: 'single'
});

const OBJECTIVE_MEMORY_FIELDS = Object.freeze({
  promote_service: Object.freeze({
    confirmed_offer_fact: 'serviceDefinition',
    geography: 'serviceMarket'
  }),
  improve_search_rankings: Object.freeze({
    confirmed_offer_fact: 'websiteContext',
    geography: 'geographicMarket'
  }),
  increase_conversion_rates: Object.freeze({
    confirmed_offer_fact: 'currentOffer',
    current_channel: 'trafficSource'
  }),
  get_more_customers: Object.freeze({
    confirmed_offer_fact: 'currentOffer',
    current_channel: 'currentAcquisitionChannel'
  }),
  launch_product: Object.freeze({
    confirmed_offer_fact: 'existingProductDefinition',
    current_channel: 'salesChannel'
  })
});

const GENERIC_OFFER_REFERENCES = new Set([
  'this service', 'our service', 'the service', 'this product', 'our product',
  'the product', 'the offer', 'this offer', 'our offer', 'service', 'product',
  'offer', 'consulting'
]);

function ownerId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('A valid memory owner is required.');
  return id;
}
function memoryAvailable(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_memory_records'").get());
}

function text(value) { return String(value ?? '').trim().replace(/\s+/g, ' '); }
function canonical(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function valueOf(field) { return field?.label || field?.value; }
function unresolved(field) { return !field || field.value === null || field.value === 'unsure' || field.source === 'unknown'; }
function genericOfferReference(value) { return GENERIC_OFFER_REFERENCES.has(canonical(value)); }
function substantiveOfferDescription(value) {
  const normalized = canonical(value);
  if (!normalized || genericOfferReference(normalized)) return false;
  const words = normalized.split(' ').filter(word => word.length > 2);
  return words.length >= 2;
}
function nowIso(now) { return (now || new Date()).toISOString(); }
function reviewAfter(freshness, now) {
  if (freshness === 'stable') return null;
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + (freshness === 'current_state' ? 30 : 180));
  return date.toISOString();
}
function subjectKey(label) {
  const normalized = canonical(label).slice(0, 100);
  return normalized || crypto.createHash('sha256').update(text(label)).digest('hex').slice(0, 20);
}

function namedOfferIdentity(description = '') {
  const value = text(description);
  const match = value.match(/\b(?:product|service|platform|software|app|application|course|brand)\s+(?:is\s+)?(?:called|named)\s+([^,.!?;]{2,100})/i);
  if (match) {
    const name = match[1]
      .split(/\s+(?:and\s+(?:it|we|will)|which|that|will\s+be|is\s+(?:sold|available)|for\s+sale)\b/i)[0]
      .trim();
    return name ? subjectKey(name) : null;
  }
  const bareName = value.replace(/[.!?]+$/, '').trim();
  const words = bareName.split(/\s+/);
  const titleStyle = words.length >= 2 && words.length <= 8
    && words.every(word => /^(?:[A-Z][A-Za-z0-9'’-]*|&|and|of|the)$/.test(word));
  return titleStyle && /\b(?:Organizer|Supplement|Software|Platform|App|Application|Course|Service)\b/.test(bareName)
    ? subjectKey(bareName) : null;
}

function semanticOfferIdentity(description = '') {
  const value = canonical(description);
  const identities = [
    ['desk organizer', /\bdesk organizer\b/],
    ['accounting software', /\baccounting software\b/],
    ['project management software', /\bproject management (?:software|app|platform)\b/],
    ['skincare product', /\b(?:skincare|skin care) (?:product|line|serum|cream)\b/],
    ['online course', /\bonline course\b/],
    ['meal planning service', /\bmeal planning service\b/]
  ];
  return identities.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

function ensureSubject(db, { userId, scopeType, label, canonicalKey, now }) {
  const id = ownerId(userId);
  const timestamp = nowIso(now);
  const key = canonicalKey || (scopeType === 'business' ? 'primary-business' : subjectKey(label));
  db.prepare(`INSERT INTO business_memory_subjects
    (user_id, scope_type, canonical_key, label, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(user_id, scope_type, canonical_key) DO UPDATE SET
      label=excluded.label, status='active', updated_at=excluded.updated_at`)
    .run(id, scopeType, key, text(label) || (scopeType === 'business' ? 'My Business' : 'Current Offer'), timestamp, timestamp);
  return db.prepare(`SELECT * FROM business_memory_subjects
    WHERE user_id=? AND scope_type=? AND canonical_key=? AND status='active'`).get(id, scopeType, key);
}

function offerLabel(understanding = {}, answers = {}) {
  for (const key of ['currentOffer', 'serviceDefinition', 'websiteContext', 'existingProductDefinition']) {
    if (!unresolved(understanding[key]) && !genericOfferReference(valueOf(understanding[key]))) return text(valueOf(understanding[key])).slice(0, 240);
  }
  const description = text(answers.initial_description).slice(0, 240);
  return (!genericOfferReference(description) ? description : '')
    || (!unresolved(understanding.category) ? text(valueOf(understanding.category)).slice(0, 240) : '')
    || 'Current Offer';
}

function offerIdentity(understanding = {}, answers = {}) {
  const rawDescription = text(answers.initial_description);
  const description = canonical(rawDescription);
  const named = namedOfferIdentity(rawDescription);
  if (named) return named;
  if (/residential remodeling|home remodeling/.test(description)) return 'residential remodeling';
  const supplement = description.match(/(?:herbal\s+)?(?:dietary\s+)?([a-z]+(?:\s+[a-z]+)?)\s+supplement/);
  if (supplement) return subjectKey(`${supplement[1]} supplement`);
  const semantic = semanticOfferIdentity(rawDescription);
  if (semantic) return semantic;
  const strong = ['currentOffer', 'serviceDefinition', 'websiteContext', 'existingProductDefinition'].find(key => !unresolved(understanding[key]));
  return subjectKey(strong ? valueOf(understanding[strong]) : offerLabel(understanding, answers));
}

function ownedSubject(db, { userId, subjectId, scopeType }) {
  if (!subjectId) return null;
  return db.prepare(`SELECT * FROM business_memory_subjects
    WHERE id=? AND user_id=? AND scope_type=? AND status='active'`).get(Number(subjectId), ownerId(userId), scopeType) || null;
}

function subjectsForObjective(db, { userId, understanding = {}, answers = {}, subjectIds = {}, now }) {
  const business = ownedSubject(db, { userId, subjectId: subjectIds.business, scopeType: 'business' })
    || ensureSubject(db, { userId, scopeType: 'business', label: 'My Business', canonicalKey: 'primary-business', now });
  const label = offerLabel(understanding, answers);
  const offer = ownedSubject(db, { userId, subjectId: subjectIds.offer, scopeType: 'offer' })
    || ensureSubject(db, { userId, scopeType: 'offer', label, canonicalKey: offerIdentity(understanding, answers), now });
  return { business, offer };
}

function insertMemory(db, candidate, { replace = false } = {}) {
  const existing = db.prepare(`SELECT * FROM business_memory_records
    WHERE user_id=? AND subject_id=? AND concept=? AND status='active' ORDER BY id DESC`).all(candidate.userId, candidate.subjectId, candidate.concept);
  const same = existing.find(row => row.canonical_value === candidate.canonicalValue);
  if (same) return { outcome: 'same_value', record: same };
  if (existing.length && !candidate.multiValue && !replace) return { outcome: 'conflict', existing };
  const transaction = db.transaction(() => {
    const info = db.prepare(`INSERT INTO business_memory_records
      (user_id, subject_id, concept, value_json, canonical_value, label, provenance, confidence,
       status, freshness_class, observed_at, review_after, source_objective, source_reference_type,
       source_reference_id, source_field, confirmed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(candidate.userId, candidate.subjectId, candidate.concept, JSON.stringify(candidate.value),
        candidate.canonicalValue, candidate.label, candidate.provenance, candidate.confidence,
        candidate.status, candidate.freshness, candidate.observedAt, candidate.reviewAfter,
        candidate.sourceObjective || null, candidate.sourceReferenceType, candidate.sourceReferenceId || null,
        candidate.sourceField || null, candidate.confirmedAt || null, candidate.observedAt, candidate.observedAt);
    const record = db.prepare('SELECT * FROM business_memory_records WHERE id=? AND user_id=?').get(info.lastInsertRowid, candidate.userId);
    if (replace) db.prepare(`UPDATE business_memory_records SET status='superseded', superseded_by_id=?, updated_at=?
      WHERE user_id=? AND subject_id=? AND concept=? AND status='active' AND id<>?`)
      .run(record.id, candidate.observedAt, candidate.userId, candidate.subjectId, candidate.concept, record.id);
    return record;
  });
  return { outcome: existing.length ? (candidate.multiValue ? 'addition' : 'replaced') : 'inserted', record: transaction() };
}

function candidateFromField({ userId, subjectId, fieldKey, field, policy, objective, referenceId, now }) {
  if (unresolved(field) || field.semanticRole === 'exploration_intent') return null;
  const [concept, , freshness, multiValue] = policy;
  const isConfirmed = field.source === 'user_confirmed';
  const confidence = Number(field.confidence || 0);
  if (!isConfirmed && !(freshness === 'stable' && confidence >= 0.9)) return null;
  const label = text(valueOf(field));
  if (!label || (concept === 'confirmed_offer_fact' && genericOfferReference(label))) return null;
  const observedAt = nowIso(now);
  return {
    userId, subjectId, concept, value: field.value, label, canonicalValue: canonical(label),
    provenance: isConfirmed ? 'confirmed_fact' : 'inferred_fact', confidence: isConfirmed ? 1 : confidence,
    status: isConfirmed ? 'active' : 'pending_review', freshness, multiValue,
    observedAt, reviewAfter: reviewAfter(freshness, observedAt), sourceObjective: objective,
    sourceReferenceType: 'approved_build_plan', sourceReferenceId: referenceId,
    sourceField: fieldKey, confirmedAt: isConfirmed ? observedAt : null
  };
}

function promoteObjectiveMemory(db, { userId, objective, understanding = {}, answers = {}, referenceId, subjectIds = {}, correctionFields = [], now }) {
  const id = ownerId(userId);
  if (!memoryAvailable(db)) return { subjects: { business: null, offer: null }, results: [] };
  const subjects = subjectsForObjective(db, { userId: id, understanding, answers, subjectIds, now });
  const results = [];
  for (const [fieldKey, policy] of Object.entries(FIELD_POLICIES)) {
    const candidate = candidateFromField({ userId: id, subjectId: subjects[policy[1]].id, fieldKey, field: understanding[fieldKey], policy, objective, referenceId, now });
    if (candidate) {
      const replace = correctionFields.includes(fieldKey) && CONCEPT_CARDINALITY[candidate.concept] === 'single';
      results.push({ field: fieldKey, ...insertMemory(db, candidate, { replace }) });
    }
  }
  const description = text(answers.initial_description);
  const explicit = [];
  if (/residential remodeling|remodeling company/i.test(description)) explicit.push(['industry', 'Residential remodeling', subjects.business.id, 'stable', false]);
  const state = description.match(/\bin\s+(Virginia|Maryland|California|Texas|Florida|New York|North Carolina|South Carolina)\b/i);
  if (state) explicit.push(['geography', state[1], subjects.business.id, 'review_periodically', true]);
  const services = description.match(/(?:specialize|specialise)\s+in\s+([^.!]+)/i);
  if (services) explicit.push(['confirmed_offer_fact', services[1], subjects.offer.id, 'stable', true]);
  const providedServices = description.match(/\bwe provide\s+([^.!]+?)(?=\s+for\s+homeowners?\b|[.!]|$)/i);
  const hasDetailedOffer = ['currentOffer', 'serviceDefinition', 'websiteContext', 'existingProductDefinition']
    .some(key => !unresolved(understanding[key]) && substantiveOfferDescription(valueOf(understanding[key])));
  if (providedServices && !hasDetailedOffer && substantiveOfferDescription(providedServices[1])) {
    explicit.push(['confirmed_offer_fact', providedServices[1], subjects.offer.id, 'stable', true]);
  }
  const audience = explicitAudienceFromDescription(description);
  if (audience) explicit.push(['target_audience', audience, subjects.offer.id, 'review_periodically', false]);
  for (const channel of explicitCurrentChannelsFromDescription(description)) {
    explicit.push(['current_channel', channel, subjects.offer.id, 'review_periodically', true]);
  }
  for (const [concept, label, subjectId, freshness, multiValue] of explicit) {
    const observedAt = nowIso(now);
    results.push({ field: 'initial_description', ...insertMemory(db, {
      userId: id, subjectId, concept, value: label, label: text(label), canonicalValue: canonical(label),
      provenance: 'confirmed_fact', confidence: 1, status: 'active', freshness, multiValue,
      observedAt, reviewAfter: reviewAfter(freshness, observedAt), sourceObjective: objective,
      sourceReferenceType: 'approved_build_plan', sourceReferenceId: referenceId,
      sourceField: 'initial_description', confirmedAt: observedAt
    }) });
  }
  return { subjects, results };
}

function normalizedAudience(value) {
  const label = text(value).trim();
  if (!label || /\b(?:might|maybe|may|could|should|try|potential|possible)\b/i.test(label)) return '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function explicitAudienceFromDescription(description) {
  const value = text(description);
  if (/\b(?:maybe|perhaps|possibly)\s+(?:our|my) audience\b/i.test(value)
    || /\b(?:i think|we think)\s+(?:our|my) audience\b/i.test(value)
    || /\b(?:might|may|could|should)\s+(?:be|target|serve|include)\b[^.!?;]{0,80}\b(?:audience|customers?|homeowners?|businesses?)\b/i.test(value)) return '';
  const patterns = [
    /\bour audience is\s+([^.!?;]{3,140})/i,
    /\bour ideal customers? (?:are|is)\s+([^.!?;]{3,140})/i,
    /\bwe serve\s+([^.!?;]{3,140})/i,
    /\bmost of our customers? (?:are|is)\s+([^.!?;]{3,140})/i,
    /\bwe primarily work with\s+([^.!?;]{3,140})/i,
    /\b(?:serving|designed for|for)\s+(homeowners?\b[^,.!?;]{0,100}|customers?\s+who\b[^,.!?;]{0,90}|businesses?\s+that\b[^,.!?;]{0,90})/i
  ];
  for (const pattern of patterns) {
    const audience = normalizedAudience(value.match(pattern)?.[1]);
    if (audience) return audience;
  }
  return '';
}

const CHANNEL_LABELS = Object.freeze({
  referral: 'Referrals', referrals: 'Referrals',
  'organic search': 'Organic Search', email: 'Email',
  'google ads': 'Google Ads', 'paid advertising': 'Paid Advertising',
  'social media': 'Social Media'
});

function channelLabels(value) {
  return text(value).toLowerCase().split(/\s+and\s+|\s*,\s*/).map(item => CHANNEL_LABELS[item.trim()]).filter(Boolean);
}

function explicitCurrentChannelsFromDescription(description) {
  const value = text(description);
  const found = [];
  const add = source => channelLabels(source).forEach(channel => { if (!found.includes(channel)) found.push(channel); });
  const replacement = value.match(/\b(?:but\s+)?(?:now|today|currently)\s+we\s+(?:use|rely on|get (?:most )?(?:customers?|business|leads?) (?:from|through))\s+([^.!?;]{3,80})/i);
  if (replacement) add(replacement[1]);
  const historical = /\b(?:used to|last year|before\s+\d{4})\b/i.test(value);
  if (!historical) {
    const patterns = [
      /\bmost of (?:our|my) (?:current )?(?:work|business|customers?|leads?)\s+(?:currently\s+)?comes?\s+(?:primarily\s+)?from\s+([^.!?;]{3,80})/i,
      /\bmost (?:of )?(?:our|my)?\s*(?:current )?(?:customers?|business|leads?)\s+comes?\s+from\s+([^.!?;]{3,80})/i,
      /\bwe currently get most (?:of our )?(?:customers?|business|leads?)\s+(?:from|through)\s+([^.!?;]{3,80})/i,
      /\b([^.!?;]{3,40})\s+(?:are|is) (?:our|my) main source of (?:customers?|business|leads?)/i,
      /\b(?:our|my) current acquisition is (?:mostly|primarily|largely)\s+([^.!?;]{3,80})/i,
      /\bwe rely (?:primarily|mostly|largely) on\s+([^.!?;]{3,80}?)(?:\s+today|\s+currently|[.!?;]|$)/i
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) add(match[1]);
    }
  }
  return found;
}

function parseRecord(row) {
  let value = row.label;
  try { value = JSON.parse(row.value_json); } catch (_) { /* use label */ }
  return { ...row, value, stale: Boolean(row.review_after && Date.parse(row.review_after) <= Date.now()) };
}

function activeMemory(db, { userId, includePending = false, subjectId = null }) {
  const id = ownerId(userId);
  if (!memoryAvailable(db)) return [];
  const statuses = includePending ? "('active','pending_review')" : "('active')";
  const rows = db.prepare(`SELECT r.*, s.scope_type, s.label AS subject_label, s.canonical_key
    FROM business_memory_records r JOIN business_memory_subjects s ON s.id=r.subject_id AND s.user_id=r.user_id
    WHERE r.user_id=? AND r.status IN ${statuses} AND s.status='active'
      AND (? IS NULL OR r.subject_id=?) ORDER BY r.id`).all(id, subjectId, subjectId);
  return rows.map(parseRecord);
}

function listOfferSubjects(db, { userId }) {
  if (!memoryAvailable(db)) return [];
  return db.prepare(`SELECT s.id, s.label, s.canonical_key,
      COUNT(CASE WHEN r.status IN ('active','pending_review') THEN 1 END) AS fact_count
    FROM business_memory_subjects s
    LEFT JOIN business_memory_records r ON r.subject_id=s.id AND r.user_id=s.user_id
    WHERE s.user_id=? AND s.scope_type='offer' AND s.status='active'
    GROUP BY s.id HAVING fact_count > 0 ORDER BY s.updated_at DESC, s.id DESC`).all(ownerId(userId)).map(subject => ({
      ...subject,
      displayLabel: subject.canonical_key && !/^current-offer$/.test(subject.canonical_key)
        ? subject.canonical_key.replace(/\b\w/g, letter => letter.toUpperCase())
        : subject.label
    }));
}

function describedOfferIdentity(initialDescription = '') {
  const named = namedOfferIdentity(initialDescription);
  if (named) return named;
  const description = canonical(initialDescription);
  if (/residential remodeling|home remodeling/.test(description)) return 'residential remodeling';
  if (/accounting software/.test(description)) return 'accounting software';
  if (/\b(?:saas|software (?:company|platform|application|app))\b/.test(description)) return 'software';
  if (/\becommerce (?:business|store|company)\b/.test(description)) return 'ecommerce';
  const supplement = description.match(/(?:herbal )?(?:dietary )?([a-z]+(?: [a-z]+)?) supplement/);
  if (supplement) return subjectKey(`${supplement[1]} supplement`);
  return semanticOfferIdentity(initialDescription);
}

function identityWords(value) {
  return canonical(value).split(' ').filter(word => word.length > 2);
}

function offerIdentityCompatible(offer, describedIdentity) {
  if (!offer || !describedIdentity) return false;
  if (offer.canonical_key === describedIdentity) return true;
  const describedWords = identityWords(describedIdentity);
  const offerWords = new Set(identityWords(offer.canonical_key));
  if (describedWords.length > 0 && describedWords.every(word => offerWords.has(word))) return true;
  if (!/^current-offer$/.test(offer.canonical_key)) return false;
  const labelWords = new Set(identityWords(offer.label));
  return describedWords.length > 0 && describedWords.every(word => labelWords.has(word));
}

function resolveObjectiveSubjects(db, { userId, initialDescription = '', selectedOfferId = null, newOffer = false }) {
  if (!memoryAvailable(db)) return { business: null, offer: null, offers: [], selection: 'none' };
  const business = db.prepare(`SELECT * FROM business_memory_subjects
    WHERE user_id=? AND scope_type='business' AND status='active' ORDER BY id LIMIT 1`).get(ownerId(userId)) || null;
  const offers = listOfferSubjects(db, { userId });
  if (newOffer) return { business, offer: null, offers, selection: 'new' };
  if (selectedOfferId) {
    const offer = offers.find(item => item.id === Number(selectedOfferId));
    return offer ? { business, offer, offers, selection: 'explicit' } : { business, offer: null, offers, invalid: true };
  }
  const description = canonical(initialDescription);
  const named = namedOfferIdentity(initialDescription);
  if (named) {
    const namedWords = identityWords(named);
    const compatible = offers.filter(offer => offer.canonical_key === named
      || (/^current-offer$/.test(offer.canonical_key)
        && namedWords.every(word => new Set(identityWords(offer.label)).has(word))));
    if (compatible.length === 1) return { business, offer: compatible[0], offers, selection: 'description' };
    if (compatible.length === 0) return { business, offer: null, offers, selection: 'new' };
    return { business, offer: null, offers, requiresSelection: true };
  }
  const described = describedOfferIdentity(initialDescription);
  if (described) {
    const compatible = offers.filter(offer => offerIdentityCompatible(offer, described));
    if (compatible.length === 1) return { business, offer: compatible[0], offers, selection: 'description' };
    if (compatible.length === 0) return { business, offer: null, offers, selection: 'new' };
    return { business, offer: null, offers, requiresSelection: true };
  }
  const exact = offers.filter(offer => offer.canonical_key.split(' ').filter(word => word.length > 3).every(word => description.includes(word)));
  if (exact.length === 1) return { business, offer: exact[0], offers, selection: 'description' };
  if (offers.length === 1) return { business, offer: offers[0], offers, selection: 'automatic' };
  if (offers.length > 1) return { business, offer: null, offers, requiresSelection: true };
  return { business, offer: null, offers, selection: 'none' };
}

function memoryUnderstanding(db, { userId, objective, initialDescription = '', subjectId = null }) {
  const records = activeMemory(db, { userId, includePending: true });
  const description = canonical(initialDescription);
  const compatible = records.filter(record => {
    if (record.scope_type === 'business') return true;
    if (subjectId) return record.subject_id === Number(subjectId);
    const words = record.canonical_key.split(' ').filter(word => word.length > 3);
    return words.length > 0 && words.every(word => description.includes(word));
  }).sort((left, right) => left.concept === right.concept && CONCEPT_CARDINALITY[left.concept] === 'single'
    ? right.id - left.id : left.id - right.id);
  const understanding = {};
  const sources = {};
  compatible.forEach(record => {
    if (record.status !== 'active' || record.stale || (record.provenance === 'inferred_fact' && record.confidence < 0.9)) return;
    const fields = CONCEPT_TO_FIELDS[record.concept] || [];
    const fieldKey = OBJECTIVE_MEMORY_FIELDS[objective]?.[record.concept] || fields[0];
    if (!fieldKey || understanding[fieldKey]) return;
    if (record.concept === 'confirmed_offer_fact' && fieldKey === 'serviceDefinition'
      && !substantiveOfferDescription(record.label)) return;
    if (record.concept === 'confirmed_offer_fact' && genericOfferReference(record.label)) return;
    understanding[fieldKey] = {
      value: record.value, label: record.label, confidence: record.confidence,
      source: record.provenance === 'confirmed_fact' ? 'remembered_confirmed' : 'remembered_inferred',
      semanticRole: record.provenance, memoryRecordId: record.id
    };
    if (record.concept === 'current_channel' && objective !== 'launch_product'
      && fieldKey !== 'currentAcquisitionChannel' && !understanding.currentAcquisitionChannel) {
      understanding.currentAcquisitionChannel = understanding[fieldKey];
      sources.currentAcquisitionChannel = { objective: record.source_objective, label: record.source_objective ? record.source_objective.replace(/_/g, ' ') : 'Brand Brain' };
    }
    sources[fieldKey] = { objective: record.source_objective, label: record.source_objective ? record.source_objective.replace(/_/g, ' ') : 'Brand Brain' };
  });
  return { understanding, sources, records: compatible };
}

function explicitCurrentInput(objective, initialDescription = '') {
  if (!/\bGoogle Ads\b/i.test(initialDescription)) return {};
  const field = objective === 'increase_conversion_rates' ? 'trafficSource' : 'currentAcquisitionChannel';
  return { [field]: { value: 'paid_advertising', label: 'Google Ads', confidence: 1, source: 'user_confirmed' } };
}

function mergeCurrentWithMemory(current = {}, remembered = {}) {
  const understanding = { ...current };
  const conflicts = [];
  Object.entries(remembered.understanding || {}).forEach(([field, memoryField]) => {
    const currentField = current[field];
    if (unresolved(currentField)) {
      understanding[field] = memoryField;
      return;
    }
    if (canonical(valueOf(currentField)) !== canonical(valueOf(memoryField))) {
      conflicts.push({
        field,
        currentValue: valueOf(currentField),
        rememberedValue: valueOf(memoryField),
        recordId: memoryField.memoryRecordId,
        source: remembered.sources?.[field] || null
      });
    }
  });
  return { understanding, conflicts, sources: remembered.sources || {} };
}

function reconcileMemory(db, { userId, recordId, action, value, label, now }) {
  const id = ownerId(userId);
  if (!memoryAvailable(db)) return { valid: false, code: 'MEMORY_NOT_AVAILABLE' };
  const record = db.prepare(`SELECT r.* FROM business_memory_records r
    JOIN business_memory_subjects s ON s.id=r.subject_id AND s.user_id=r.user_id
    WHERE r.id=? AND r.user_id=?`).get(Number(recordId), id);
  if (!record) return { valid: false, code: 'MEMORY_NOT_FOUND' };
  const timestamp = nowIso(now);
  if (action === 'remove') {
    db.prepare("UPDATE business_memory_records SET status='removed', updated_at=? WHERE id=? AND user_id=?").run(timestamp, record.id, id);
    return { valid: true, outcome: 'removed' };
  }
  if (!['replace', 'add', 'keep', 'objective_only'].includes(action)) return { valid: false, code: 'MEMORY_ACTION_INVALID' };
  if (action === 'keep') {
    db.prepare('UPDATE business_memory_records SET observed_at=?, review_after=?, updated_at=? WHERE id=? AND user_id=?')
      .run(timestamp, reviewAfter(record.freshness_class, timestamp), timestamp, record.id, id);
    return { valid: true, outcome: action };
  }
  if (action === 'objective_only') return { valid: true, outcome: action };
  const nextLabel = text(label || value);
  if (!nextLabel) return { valid: false, code: 'MEMORY_VALUE_REQUIRED' };
  return { valid: true, ...insertMemory(db, {
    userId: id, subjectId: record.subject_id, concept: record.concept, value: value || nextLabel,
    label: nextLabel, canonicalValue: canonical(nextLabel), provenance: 'confirmed_fact', confidence: 1,
    status: 'active', freshness: record.freshness_class, multiValue: action === 'add', observedAt: timestamp,
    reviewAfter: reviewAfter(record.freshness_class, timestamp), sourceObjective: record.source_objective,
    sourceReferenceType: 'explicit_reconciliation', sourceReferenceId: String(record.id), sourceField: record.source_field,
    confirmedAt: timestamp
  }, { replace: action === 'replace' }) };
}

function resetMemory(db, { userId, subjectId = null, now }) {
  const id = ownerId(userId);
  if (!memoryAvailable(db)) return 0;
  const timestamp = nowIso(now);
  return db.prepare(`UPDATE business_memory_records SET status='removed', updated_at=?
    WHERE user_id=? AND status IN ('active','pending_review') AND (? IS NULL OR subject_id=?)`)
    .run(timestamp, id, subjectId, subjectId).changes;
}

function backfillLegacyBrandBrain(db, { userId, now }) {
  const id = ownerId(userId);
  if (!memoryAvailable(db)) return [];
  const brain = db.prepare('SELECT * FROM brand_brain WHERE user_id=? ORDER BY id DESC LIMIT 1').get(id);
  if (!brain) return [];
  const subject = ensureSubject(db, { userId: id, scopeType: 'business', label: brain.business_name || 'My Business', canonicalKey: 'primary-business', now });
  const mappings = { business_name: 'brand_name', industry: 'industry', brand_voice_custom: 'brand_voice', unique_value: 'unique_value', competitors: 'competitors', key_messages: 'key_messages' };
  const results = [];
  for (const [field, concept] of Object.entries(mappings)) {
    const label = text(brain[field] || (field === 'brand_voice_custom' && brain.brand_voice !== 'professional' ? brain.brand_voice : ''));
    if (!label) continue;
    const timestamp = nowIso(now);
    results.push(insertMemory(db, { userId: id, subjectId: subject.id, concept, value: label, label,
      canonicalValue: canonical(label), provenance: 'confirmed_fact', confidence: 1, status: 'active',
      freshness: 'stable', multiValue: false, observedAt: timestamp, reviewAfter: null,
      sourceObjective: null, sourceReferenceType: 'legacy_brand_brain', sourceReferenceId: String(brain.id),
      sourceField: field, confirmedAt: timestamp }));
  }
  return results;
}

function syncBrandBrainMemory(db, { userId, values = {}, now }) {
  const id = ownerId(userId);
  if (!memoryAvailable(db)) return [];
  const subject = ensureSubject(db, { userId: id, scopeType: 'business', label: values.business_name || 'My Business', canonicalKey: 'primary-business', now });
  const mappings = { business_name: 'brand_name', industry: 'industry', brand_voice_custom: 'brand_voice', unique_value: 'unique_value', competitors: 'competitors', key_messages: 'key_messages' };
  const results = [];
  for (const [field, concept] of Object.entries(mappings)) {
    const label = text(values[field] || (field === 'brand_voice_custom' && values.brand_voice !== 'professional' ? values.brand_voice : ''));
    if (!label) continue;
    const existing = db.prepare("SELECT id FROM business_memory_records WHERE user_id=? AND subject_id=? AND concept=? AND status='active' ORDER BY id DESC LIMIT 1").get(id, subject.id, concept);
    const timestamp = nowIso(now);
    const candidate = { userId: id, subjectId: subject.id, concept, value: label, label, canonicalValue: canonical(label), provenance: 'confirmed_fact', confidence: 1, status: 'active', freshness: 'stable', multiValue: false, observedAt: timestamp, reviewAfter: null, sourceObjective: null, sourceReferenceType: 'brand_brain_edit', sourceReferenceId: null, sourceField: field, confirmedAt: timestamp };
    results.push(existing ? insertMemory(db, candidate, { replace: true }) : insertMemory(db, candidate));
  }
  return results;
}

function brandBrainProjection(db, { userId }) {
  if (!memoryAvailable(db)) return { current: [], learned: [], needsReview: [], history: [], confirmedCoverage: 0 };
  const records = activeMemory(db, { userId, includePending: true });
  const current = records.filter(item => item.status === 'active' && !item.stale);
  const needsReview = records.filter(item => item.status === 'pending_review' || item.stale);
  const history = db.prepare(`SELECT r.*, s.label AS subject_label FROM business_memory_records r
    JOIN business_memory_subjects s ON s.id=r.subject_id AND s.user_id=r.user_id
    WHERE r.user_id=? AND r.status IN ('superseded','removed') ORDER BY r.updated_at DESC LIMIT 50`).all(ownerId(userId)).map(parseRecord);
  const confirmed = current.filter(item => item.provenance === 'confirmed_fact');
  const labels = { confirmed_offer_fact: 'What you offer', target_audience: 'Primary audience', current_channel: 'Current channel', business_type: 'Business type', brand_name: 'Business name', product_maturity: 'Product maturity', launch_stage: 'Launch stage' };
  const present = item => ({ ...item, displayConcept: labels[item.concept] || item.concept.replace(/_/g, ' '), freshnessMeaning: item.stale ? 'Review recommended' : (item.source_objective ? 'Previously confirmed' : 'Confirmed') });
  return { current: current.map(present), learned: confirmed.filter(item => item.source_objective).map(present), needsReview: needsReview.map(present), history: history.map(present),
    confirmedCoverage: Math.min(100, Math.round((new Set(confirmed.map(item => item.concept)).size / 8) * 100)) };
}

function productionMemoryContext(db, { userId, subjectId = null }) {
  return activeMemory(db, { userId, subjectId }).filter(record => !record.stale && ['brand_name', 'brand_voice', 'brand_values', 'brand_constraints', 'target_audience', 'confirmed_offer_fact', 'category'].includes(record.concept)).map(record => ({ concept: record.concept, value: record.label, provenance: record.provenance }));
}

function boundedProductionMemory(db, { userId, subjectIds = {} }) {
  const ids = [subjectIds.business, subjectIds.offer].filter(id => Number.isSafeInteger(Number(id)));
  const records = ids.flatMap(subjectId => productionMemoryContext(db, { userId, subjectId: Number(subjectId) }));
  const context = {};
  const names = { brand_name: 'businessName', brand_voice: 'voice', brand_values: 'brandValues', brand_constraints: 'brandConstraints', target_audience: 'targetAudience', confirmed_offer_fact: 'offerFacts', category: 'category' };
  records.forEach(record => {
    const key = names[record.concept];
    if (!key) return;
    context[key] = context[key] ? `${context[key]}; ${record.value}`.slice(0, 1000) : String(record.value).slice(0, 1000);
  });
  return Object.keys(context).length ? context : null;
}

module.exports = {
  CONCEPT_CARDINALITY, FIELD_POLICIES, activeMemory, backfillLegacyBrandBrain, brandBrainProjection, ensureSubject, listOfferSubjects, memoryAvailable, explicitCurrentInput,
  memoryUnderstanding, mergeCurrentWithMemory, productionMemoryContext, boundedProductionMemory, promoteObjectiveMemory, reconcileMemory, resetMemory,
  explicitAudienceFromDescription, explicitCurrentChannelsFromDescription,
  resolveObjectiveSubjects, syncBrandBrainMemory,
  subjectsForObjective
};
