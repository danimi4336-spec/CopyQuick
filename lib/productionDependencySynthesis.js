const SUPPORTED_CONCEPTS = Object.freeze([
  'primary_audience', 'customer_need', 'customer_motivation', 'customer_objection',
  'desired_outcome', 'buying_trigger', 'language_constraint', 'offer',
  'exploration_direction', 'positioning_direction', 'differentiation', 'proof_constraint',
  'positioning_pillar', 'messaging_implication', 'value_direction', 'campaign_objective',
  'campaign_angle', 'customer_facing_cta', 'channel_role', 'measurement_goal',
  'search_evidence_status', 'authority_direction', 'search_intent', 'topic_territory',
  'content_topic', 'reader_question', 'content_angle', 'content_scope', 'evidence_limit', 'unresolved_question'
]);

const CONSUMERS = Object.freeze({
  product_positioning: Object.freeze({
    required: ['primary_audience', 'customer_need'],
    optional: ['customer_objection', 'exploration_direction', 'proof_constraint', 'unresolved_question', 'language_constraint'],
    responsibility: 'Choose a positioning direction, differentiation status, proof requirements, strategic pillars, and messaging implications.'
  }),
  value_proposition: Object.freeze({
    required: ['primary_audience', 'customer_need', 'positioning_direction'],
    optional: ['customer_objection', 'desired_outcome', 'differentiation', 'proof_constraint'],
    responsibility: 'Transform the positioning into a customer-relevant reason to investigate or choose the direction over the status quo.'
  }),
  lead_capture_page: Object.freeze({
    required: ['primary_audience', 'offer', 'campaign_angle', 'customer_facing_cta'],
    optional: ['customer_objection', 'proof_constraint', 'campaign_objective'],
    responsibility: 'Build a complete persuasion path that leads to the established campaign action.'
  }),
  outreach_sequence: Object.freeze({
    required: ['primary_audience', 'offer', 'campaign_angle', 'customer_facing_cta'],
    optional: ['customer_objection', 'proof_constraint', 'campaign_objective'],
    responsibility: 'Build a progressive sequence of messages that earns the established campaign action.'
  }),
  paid_ad_copy_set: Object.freeze({
    required: ['primary_audience', 'offer', 'campaign_angle', 'customer_facing_cta'],
    optional: ['customer_objection', 'proof_constraint', 'channel_role'],
    responsibility: 'Create distinct attention, qualification, and action variants without changing the campaign anchors.'
  }),
  search_strategy: Object.freeze({
    required: ['search_evidence_status', 'topic_territory'],
    optional: ['primary_audience', 'unresolved_question'],
    responsibility: 'Choose an authority direction, topic territory, intent hypotheses, evidence constraints, and measurement direction.'
  }),
  priority_content_brief: Object.freeze({
    required: ['authority_direction', 'topic_territory', 'search_intent'],
    optional: ['primary_audience', 'proof_constraint', 'customer_facing_cta', 'unresolved_question'],
    responsibility: 'Specify one content opportunity with a topic, reader question, intent hypothesis, angle, scope, CTA status, and evidence limits.'
  }),
  priority_search_article: Object.freeze({
    required: ['primary_audience', 'content_topic', 'reader_question', 'search_intent', 'content_angle', 'content_scope', 'evidence_limit'],
    optional: ['offer', 'customer_facing_cta', 'topic_territory', 'authority_direction'],
    unresolvedAllowed: ['search_intent'],
    responsibility: 'Answer the selected reader question with domain-useful explanation, practical application, and an evidence-disciplined editorial structure.'
  })
});
const SYNTHESIS_MINIMUM_VERSION = Object.freeze({
  product_positioning: 4, value_proposition: 4, campaign_brief: 4,
  lead_capture_page: 5, outreach_sequence: 5, paid_ad_copy_set: 4,
  search_evidence_snapshot: 4, search_strategy: 4, priority_content_brief: 4, priority_search_article: 1
});

const OWNERS = Object.freeze({
  customer_profile: new Set(['primary_audience', 'customer_need', 'customer_motivation', 'customer_objection', 'desired_outcome', 'buying_trigger', 'language_constraint']),
  product_concept_brief: new Set(['exploration_direction', 'unresolved_question', 'proof_constraint']),
  product_positioning: new Set(['positioning_direction', 'differentiation', 'proof_constraint', 'positioning_pillar', 'messaging_implication']),
  campaign_brief: new Set(['campaign_objective', 'primary_audience', 'offer', 'campaign_angle', 'customer_facing_cta', 'customer_objection', 'proof_constraint', 'channel_role', 'measurement_goal', 'unresolved_question']),
  search_evidence_snapshot: new Set(['search_evidence_status', 'topic_territory', 'unresolved_question', 'proof_constraint']),
  search_strategy: new Set(['authority_direction', 'topic_territory', 'search_intent', 'proof_constraint', 'measurement_goal', 'unresolved_question']),
  priority_content_brief: new Set(['content_topic', 'reader_question', 'search_intent', 'content_angle', 'content_scope', 'customer_facing_cta', 'evidence_limit'])
});

const RANK = Object.freeze({
  confirmed_fact: 70, objective_confirmed: 65, generated_strategy: 50,
  generated_recommendation: 40, inferred_context: 30, hypothesis: 20,
  exploration_intent: 10, unresolved: 0
});

function clean(value) { return String(value ?? '').trim().replace(/\s+/g, ' '); }
function values(value) { return (Array.isArray(value) ? value : [value]).map(clean).filter(Boolean); }
function unresolvedValue(value) { return !clean(value) || /^(?:unknown|unresolved|not established|to be confirmed|i['’]?m not sure yet)$/i.test(clean(value)); }
function customerReadableDecisionValue(concept, value) {
  if (concept !== 'primary_audience') return value;
  return clean(value).replace(/\s+[—-]\s+inferred from the product description and requiring validation$/i, '');
}

function decision(concept, value, options = {}) {
  const normalized = clean(value);
  const unresolved = options.unresolved === true || options.provenance === 'unresolved' || unresolvedValue(normalized);
  return Object.freeze({
    concept,
    value: unresolved ? 'Not established' : normalized,
    provenance: unresolved ? 'unresolved' : (options.provenance || 'generated_strategy'),
    status: unresolved ? 'unresolved' : (options.status || 'active'),
    sourceDeliverable: options.sourceDeliverable || 'current_context',
    sourceField: options.sourceField || concept,
    permittedUses: Object.freeze(options.permittedUses || ['downstream_strategy']),
    unresolved,
    cardinality: options.cardinality || 'single'
  });
}

function fromFields(id, output, mappings) {
  return mappings.flatMap(([concept, field, provenance = 'generated_strategy', cardinality = 'single']) => {
    let entries = values(output?.[field]).map(value => customerReadableDecisionValue(concept, value));
    if (concept === 'topic_territory') entries = entries.flatMap(value => value.split(/\s*[,;]\s*/).filter(Boolean));
    if (!entries.length) return [decision(concept, '', { sourceDeliverable: id, sourceField: field, provenance, cardinality, unresolved: true })];
    return entries.map(value => decision(concept, value, { sourceDeliverable: id, sourceField: field, provenance, cardinality }));
  });
}

function extractDecisions(deliverableId, output) {
  if (!output || typeof output !== 'object') return Object.freeze([]);
  const mappings = {
    customer_profile: [
      ['primary_audience', 'primaryCustomer'], ['customer_need', 'needs', 'hypothesis', 'multi'],
      ['customer_motivation', 'motivations', 'hypothesis', 'multi'], ['customer_objection', 'objections', 'hypothesis', 'multi'],
      ['buying_trigger', 'buyingTriggers', 'hypothesis', 'multi'], ['language_constraint', 'languageStyle', 'generated_recommendation']
    ],
    product_concept_brief: [
      ['exploration_direction', 'directionsToExplore', 'exploration_intent', 'multi'],
      ['unresolved_question', 'openDecisions', 'unresolved', 'multi'], ['proof_constraint', 'evidenceBoundaries', 'generated_recommendation', 'multi']
    ],
    product_positioning: [
      ['positioning_direction', 'positioningStatement'],
      ['differentiation', 'differentiation'], ['proof_constraint', 'proofPoints', 'generated_recommendation', 'multi'],
      ['positioning_pillar', 'positioningPillars', 'generated_recommendation', 'multi'],
      ['messaging_implication', 'messagingImplications', 'generated_recommendation', 'multi']
    ],
    campaign_brief: [
      ['campaign_objective', 'campaignObjective'], ['primary_audience', 'primaryAudience'], ['offer', 'offer'],
      ['campaign_angle', 'campaignAngle'], ['customer_facing_cta', 'callToAction'],
      ['customer_objection', 'customerObjections', 'hypothesis', 'multi'], ['proof_constraint', 'proofConstraints', 'generated_recommendation', 'multi'],
      ['channel_role', 'channelRoles', 'generated_recommendation', 'multi'], ['measurement_goal', 'measurementGoal'],
      ['unresolved_question', 'unresolvedQuestions', 'unresolved', 'multi']
    ],
    search_evidence_snapshot: [
      ['search_evidence_status', 'evidenceStatus'], ['topic_territory', 'topicContext', 'inferred_context', 'multi'],
      ['proof_constraint', 'evidenceConstraints', 'generated_recommendation', 'multi'], ['unresolved_question', 'unresolvedQuestions', 'unresolved', 'multi']
    ],
    search_strategy: [
      ['authority_direction', 'authorityDirection'], ['topic_territory', 'topicTerritory', 'generated_strategy', 'multi'],
      ['search_intent', 'searchIntentHypotheses', 'hypothesis', 'multi'], ['proof_constraint', 'evidenceConstraints', 'generated_recommendation', 'multi'],
      ['measurement_goal', 'measurementDirection'], ['unresolved_question', 'unresolvedQuestions', 'unresolved', 'multi']
    ],
    priority_content_brief: [
      ['content_topic', 'specificTopic'], ['reader_question', 'readerQuestion'], ['search_intent', 'searchIntentHypothesis', 'hypothesis'],
      ['content_angle', 'contentAngle'], ['content_scope', 'scope'], ['customer_facing_cta', 'callToActionStatus'],
      ['evidence_limit', 'evidenceLimits', 'generated_recommendation', 'multi']
    ]
  };
  return Object.freeze(fromFields(deliverableId, output, mappings[deliverableId] || []).filter(item => SUPPORTED_CONCEPTS.includes(item.concept)));
}

function currentDecisions({ strategySnapshot = {}, semanticInsights = {} } = {}) {
  const result = [];
  const add = (concept, item, field) => {
    if (!item) return;
    const value = item.value;
    const unresolved = item.unresolved || item.semanticRole === 'unresolved' || unresolvedValue(value);
    const provenance = unresolved ? 'unresolved'
      : item.semanticRole === 'confirmed_fact' || item.provenance === 'confirmed_fact' ? 'objective_confirmed'
        : item.semanticRole === 'inferred_fact' || item.provenance === 'inferred_fact' ? 'inferred_context'
          : 'generated_recommendation';
    result.push(decision(concept, value, { sourceField: field, provenance, unresolved }));
  };
  add('primary_audience', semanticInsights.primaryCustomer || strategySnapshot.primaryCustomer, 'primaryCustomer');
  add('customer_need', semanticInsights.customerNeed, 'customerNeed');
  add('customer_motivation', semanticInsights.customerMotivation || strategySnapshot.customerMotivation, 'customerMotivation');
  add('offer', semanticInsights.confirmedOffer || strategySnapshot.confirmedOffer, 'confirmedOffer');
  add('customer_facing_cta', semanticInsights.customerFacingCta || strategySnapshot.confirmedPrimaryCta, 'confirmedPrimaryCta');
  add('measurement_goal', semanticInsights.measurementGoal, 'measurementGoal');
  add('topic_territory', semanticInsights.topicTerritory, 'topicTerritory');
  return result;
}

function sameValue(a, b) {
  const normalize = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalize(a) === normalize(b);
}

function resolveDecisions(items) {
  const grouped = new Map();
  items.forEach(item => {
    if (!grouped.has(item.concept)) grouped.set(item.concept, []);
    grouped.get(item.concept).push(item);
  });
  const decisions = [];
  const conflicts = [];
  grouped.forEach((group, concept) => {
    const ranked = group.slice().sort((a, b) => (RANK[b.provenance] || 0) - (RANK[a.provenance] || 0));
    const highestRank = RANK[ranked[0].provenance] || 0;
    const highest = ranked.filter(item => (RANK[item.provenance] || 0) === highestRank && !item.unresolved);
    const distinct = highest.filter((item, index) => highest.findIndex(candidate => sameValue(candidate.value, item.value)) === index);
    if (distinct.length > 1 && ranked[0].cardinality !== 'multi') conflicts.push({ concept, decisions: distinct });
    if (ranked[0].cardinality === 'multi') decisions.push(...ranked.filter((item, index) => ranked.findIndex(candidate => sameValue(candidate.value, item.value)) === index));
    else decisions.push(distinct[0] || ranked[0]);
  });
  return { decisions: Object.freeze(decisions), conflicts: Object.freeze(conflicts) };
}

function buildSynthesisContext({ dependentId, dependencyOutputs = [], strategySnapshot = {}, semanticInsights = {}, contractVersion }) {
  const contract = CONSUMERS[dependentId];
  const version = Number(String(contractVersion || '').match(/:v(\d+)$/)?.[1]);
  if (!contract || (version && version < (SYNTHESIS_MINIMUM_VERSION[dependentId] || 1))) return Object.freeze({ enabled: false, decisions: Object.freeze([]), conflicts: Object.freeze([]), missing: Object.freeze([]), summary: '' });
  const extracted = dependencyOutputs.flatMap(item => extractDecisions(item.deliverableId, item.output));
  const resolved = resolveDecisions([...extracted, ...currentDecisions({ strategySnapshot, semanticInsights })]);
  const allow = new Set([...contract.required, ...contract.optional]);
  const filtered = resolved.decisions.filter(item => allow.has(item.concept));
  const missing = contract.required.filter(concept => !filtered.some(item => item.concept === concept));
  const relevantConflicts = resolved.conflicts.filter(item => allow.has(item.concept));
  const summary = renderSynthesisSummary({ decisions: filtered, contract });
  return Object.freeze({
    enabled: true, dependentId, contract, decisions: Object.freeze(filtered),
    conflicts: Object.freeze(relevantConflicts), missing: Object.freeze(missing), summary,
    trace: Object.freeze(filtered.map(item => Object.freeze({ sourceDeliverable: item.sourceDeliverable, concept: item.concept, usedFor: dependentId })))
  });
}

function renderSynthesisSummary({ decisions = [], contract }) {
  const labels = { primary_audience: 'Audience', customer_need: 'Customer need', customer_objection: 'Customer objection', offer: 'Offer', exploration_direction: 'Exploration direction', positioning_direction: 'Positioning direction', differentiation: 'Differentiation status', proof_constraint: 'Proof constraint', campaign_objective: 'Campaign objective', campaign_angle: 'Campaign angle', customer_facing_cta: 'Call to action', channel_role: 'Channel role', search_evidence_status: 'Search evidence status', authority_direction: 'Authority direction', search_intent: 'Search intent hypothesis', topic_territory: 'Topic territory', content_topic: 'Content topic', reader_question: 'Reader question', content_angle: 'Content angle', content_scope: 'Content scope', evidence_limit: 'Evidence limit', unresolved_question: 'Unresolved question' };
  const lines = decisions.slice(0, 18).map(item => `${labels[item.concept] || item.concept}: ${item.value}${item.unresolved ? ' [unresolved]' : item.provenance === 'hypothesis' || item.provenance === 'exploration_intent' ? ' [hypothesis]' : item.provenance.startsWith('generated') ? ' [strategic direction]' : ''}`);
  return ['Approved synthesis decisions', ...lines, `Transformation required: ${contract?.responsibility || ''}`].join('\n').slice(0, 4000);
}

function decisionsFor(context, concept) {
  return (context?.synthesis?.decisions || []).filter(item => item.concept === concept);
}
function decisionValue(context, concept, fallback = '') { return decisionsFor(context, concept).find(item => !item.unresolved)?.value || fallback; }
function decisionValues(context, concept) { return decisionsFor(context, concept).filter(item => !item.unresolved).map(item => item.value); }

function normalizedOverlap(left, right) {
  const tokens = value => clean(value).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const a = tokens(left); const b = tokens(right);
  if (a.length < 14 || b.length < 14) return 0;
  const set = new Set(b); return a.filter(token => set.has(token)).length / Math.min(a.length, b.length);
}

function validateSynthesis(output, contract, context = {}) {
  const synthesis = context.synthesis;
  if (!synthesis?.enabled) return { valid: true };
  if (synthesis.conflicts.length) return { valid: false, code: 'SYNTHESIS_CONTRADICTION', details: { concepts: synthesis.conflicts.map(item => item.concept) } };
  if (synthesis.missing.length) return { valid: false, code: 'SYNTHESIS_REQUIRED_DECISION_MISSING', details: { concepts: synthesis.missing } };
  const unresolvedAllowed = new Set(synthesis.contract.unresolvedAllowed || []);
  const requiredUnresolved = synthesis.contract.required.filter(concept => !unresolvedAllowed.has(concept) && decisionsFor(context, concept).some(item => item.unresolved));
  if (contract.readyToUse && requiredUnresolved.length) return { valid: false, code: 'SYNTHESIS_UNRESOLVED_PROMOTED', details: { concepts: requiredUnresolved } };
  const publicValues = (contract.publicFieldKeys || Object.keys(contract.outputSchema || {})).flatMap(key => values(output?.[key]));
  const publicText = publicValues.join(' ');
  const upstream = (context.dependencyOutputs || []).flatMap(item => Object.values(item.output || {}).flatMap(values));
  if (upstream.some(value => clean(value).length >= 240 && publicValues.some(candidate => clean(candidate).length >= 240 && normalizedOverlap(candidate, value) >= 0.9))) {
    return { valid: false, code: 'SYNTHESIS_EXCESSIVE_PREREQUISITE_COPY' };
  }
  const anchors = synthesis.contract.required.filter(concept => !['proof_constraint'].includes(concept)).map(concept => decisionValue(context, concept)).filter(Boolean);
  const outputText = values(Object.values(output || {}).flat()).join(' ').toLowerCase();
  const represented = anchors.filter(value => clean(value).toLowerCase().split(/\s+/).filter(token => token.length > 4).some(token => outputText.includes(token)));
  if (anchors.length && represented.length < Math.ceil(anchors.length / 2)) return { valid: false, code: 'SYNTHESIS_TRANSFORMATION_INSUFFICIENT' };
  return { valid: true };
}

module.exports = {
  CONSUMERS, OWNERS, SUPPORTED_CONCEPTS, SYNTHESIS_MINIMUM_VERSION, buildSynthesisContext, decisionValue, decisionValues,
  extractDecisions, renderSynthesisSummary, resolveDecisions, validateSynthesis
};
