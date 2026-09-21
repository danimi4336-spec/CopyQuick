function textValue(snapshot, key) {
  const value = snapshot?.[key]?.value;
  return typeof value === 'string' && value.trim() && value !== 'Unknown' ? value.trim() : '';
}

function cleanTopic(value) {
  return String(value || '')
    .replace(/^Validate supplied topics:\s*/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function topicCandidates(snapshot) {
  const focus = cleanTopic(textValue(snapshot, 'marketingFocus'));
  if (!focus || /build and validate a customer-question topic map/i.test(focus)) return [];
  return focus.split(/\s*;\s*|\n+/).map(cleanTopic).filter(Boolean);
}

const DOMAIN_PROFILES = Object.freeze([
  Object.freeze({
    id: 'landscaping_services', label: 'residential landscaping services',
    match: /landscap|lawn|yard|irrigation|garden|hardscap/i,
    vocabulary: ['property conditions', 'water use', 'maintenance expectations', 'planting and material choices', 'irrigation compatibility', 'seasonal timing'],
    decisions: ['the property conditions that shape the project', 'the desired balance between appearance and ongoing maintenance', 'water and irrigation considerations', 'the scope of installation or recurring service', 'timing, access, and maintenance responsibilities']
  }),
  Object.freeze({
    id: 'bookkeeping_services', label: 'small-business bookkeeping services',
    match: /bookkeep|accounting|reconciliation|financial report|year-end/i,
    vocabulary: ['record completeness', 'account reconciliation', 'reporting cadence', 'source documents', 'workflow ownership', 'year-end readiness'],
    decisions: ['the condition and completeness of current records', 'which accounts and periods require review', 'reporting and reconciliation expectations', 'the handoff of source documents and approvals', 'ongoing responsibilities and review cadence']
  }),
  Object.freeze({
    id: 'home_services', label: 'residential home services',
    match: /plumb|hvac|heating|cooling|electric|roof|remodel|renovat|contractor/i,
    vocabulary: ['property condition', 'project scope', 'materials and equipment', 'site access', 'timing', 'maintenance responsibilities'],
    decisions: ['the condition that needs attention', 'the boundaries of the proposed scope', 'materials, equipment, and access requirements', 'timing and disruption considerations', 'warranty and maintenance responsibilities']
  }),
  Object.freeze({
    id: 'professional_services', label: 'professional services',
    match: /consult|agency|legal|law firm|advis|professional service|marketing|seo/i,
    vocabulary: ['scope', 'working process', 'responsibilities', 'inputs', 'review cadence', 'decision criteria'],
    decisions: ['the problem and desired decision', 'the scope of support', 'required inputs and responsibilities', 'communication and review cadence', 'how progress will be assessed']
  })
]);

function inferDomain(snapshot, strategicDirection = '') {
  const source = [
    textValue(snapshot, 'confirmedOffer'),
    textValue(snapshot, 'primaryCustomer'),
    textValue(snapshot, 'primarySalesChannel'),
    textValue(snapshot, 'marketingFocus'),
    strategicDirection
  ].join(' ');
  return DOMAIN_PROFILES.find(profile => profile.match.test(source)) || Object.freeze({
    id: 'general_service', label: 'the confirmed service category',
    vocabulary: ['current situation', 'scope', 'options', 'constraints', 'responsibilities', 'next step'],
    decisions: ['the current situation', 'the outcome being considered', 'the available approaches', 'scope and responsibilities', 'how to evaluate the next step']
  });
}

function buildOrganicCompositionBrief(context = {}) {
  const snapshot = context.strategySnapshot || {};
  const topics = topicCandidates(snapshot);
  const fallbackTopic = cleanTopic(textValue(snapshot, 'customerMotivation')) || 'the confirmed customer priority';
  const primaryTopic = topics[0] || fallbackTopic;
  const supportingTopics = topics.slice(1);
  const domain = inferDomain(snapshot, context.strategicDirection);
  const audience = cleanTopic(textValue(snapshot, 'primaryCustomer')) || 'the confirmed audience';
  const offer = cleanTopic(textValue(snapshot, 'confirmedOffer')) || 'relevant professional support';
  const sectionPlan = [
    `What ${primaryTopic.toLowerCase()} means for this decision`,
    `Evaluate ${domain.decisions[0]}`,
    `Clarify ${domain.decisions[1]}`,
    supportingTopics[0] ? `How ${supportingTopics[0].toLowerCase()} relates to the primary topic` : `Compare the practical approaches`,
    supportingTopics[1] ? `Where ${supportingTopics[1].toLowerCase()} fits` : `Questions to ask about scope and responsibilities`,
    `Choose and verify the next step`
  ];
  return Object.freeze({
    primaryTopic,
    supportingTopics: Object.freeze(supportingTopics),
    domainId: domain.id,
    industryLabel: domain.label,
    audience,
    offer,
    domainVocabulary: Object.freeze([...domain.vocabulary]),
    decisionDimensions: Object.freeze([...domain.decisions]),
    sectionPlan: Object.freeze(sectionPlan),
    compositionRules: Object.freeze([
      'Build the article around the primary topic; do not concatenate every supplied topic into the title or repeat the full topic list in prose.',
      'Use supporting topics only where they clarify a distinct section or reader decision.',
      'Use domain terminology to make the explanation concrete, but do not invent local rules, technical specifications, performance outcomes, or business capabilities.',
      'Prefer reader-facing explanations, comparisons, questions, and conditional guidance over generic marketing-process advice.'
    ])
  });
}

function renderCompositionBrief(brief) {
  if (!brief) return '';
  return [
    `Industry/service domain: ${brief.industryLabel} (${brief.domainId})`,
    `Primary article topic: ${brief.primaryTopic}`,
    `Supporting topics: ${brief.supportingTopics.length ? brief.supportingTopics.join('; ') : 'none supplied'}`,
    `Confirmed audience: ${brief.audience}`,
    `Confirmed offer or safe offer boundary: ${brief.offer}`,
    `Domain vocabulary: ${brief.domainVocabulary.join('; ')}`,
    `Reader decision dimensions: ${brief.decisionDimensions.join('; ')}`,
    'Recommended section plan:',
    ...brief.sectionPlan.map((section, index) => `${index + 1}. ${section}`),
    'Composition rules:',
    ...brief.compositionRules.map(rule => `- ${rule}`)
  ].join('\n');
}

module.exports = { buildOrganicCompositionBrief, renderCompositionBrief, topicCandidates };
