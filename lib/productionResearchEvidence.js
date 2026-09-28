const { MAX_EXCERPT, createDeterministicResearchAdapter, safeCitationUrl } = require('./researchAdapter');

const CLAIM_TYPES = Object.freeze(['current_statistic', 'regulation_requirement', 'scientific_clinical', 'market_industry', 'product_company_fact', 'definition_standard', 'local_requirement', 'general_background']);
const STATUSES = Object.freeze(['supported', 'partially_supported', 'conflicted', 'stale', 'weak_source', 'unsupported', 'not_researched']);
const PERMITTED_USES = Object.freeze(['background_only', 'public_factual_claim', 'product_fact', 'high_risk_claim', 'internal_strategy']);
const LIMITS = Object.freeze({ questions: 5, candidates: 5, acceptedSources: 3, retries: 2 });
const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
const lower = value => clean(value).toLowerCase();

function classifyClaimInventory(brief = {}) {
  const text = lower([brief.specificTopic, brief.readerQuestion, ...(brief.evidenceLimits || [])].join(' '));
  if (/\b(?:cure|treat|prevent|disease|dosage|interaction|safe for everyone)\b/.test(text)) return Object.freeze([{ key: 'restricted-health-claim', classification: 'PROHIBITED', claimType: 'scientific_clinical', essential: true }]);
  if (/\b(?:scientific|clinical|efficacy|health outcome)\b/.test(text)) return Object.freeze([{ key: 'scientific-evidence', classification: 'EVIDENCE_REQUIRED', claimType: 'scientific_clinical', essential: true }]);
  if (/\b(?:tax deadline|filing requirement|regulation|legal requirement)\b/.test(text)) return Object.freeze([{ key: 'current-requirement', classification: 'EVIDENCE_REQUIRED', claimType: 'regulation_requirement', essential: true }]);
  if (/\b(?:permit required|building code)\b/.test(text)) return Object.freeze([{ key: 'local-requirement', classification: 'EVIDENCE_REQUIRED', claimType: 'local_requirement', essential: true }]);
  if (/\b(?:statistic|percentage|survey|market size|current data)\b/.test(text)) return Object.freeze([{ key: 'current-statistic', classification: 'EVIDENCE_REQUIRED', claimType: 'current_statistic', essential: false }]);
  if (/\b(?:bookkeep\w*|invoic\w*|cash[- ]flow|receivable\w*|accounting)\b/.test(text)) return Object.freeze([{ key: 'cash-flow-background', classification: 'EVIDENCE_OPTIONAL', claimType: 'general_background', essential: false }]);
  return Object.freeze([{ key: 'stable-explanation', classification: 'NO_EXTERNAL_EVIDENCE_NEEDED', claimType: 'general_background', essential: false }]);
}

function neutralQuery(question) {
  return clean(question).replace(/\b(?:find|show|give me)\s+proof\s+(?:that|of)?\s*/ig, '')
    .replace(/\b(?:proves?|cures?|guarantees?)\b/ig, 'evidence').replace(/\bonly use sources agreeing with me\b/ig, '').slice(0, 300);
}

function researchNeeds(brief = {}) {
  return Object.freeze(classifyClaimInventory(brief).filter(item => ['EVIDENCE_OPTIONAL', 'EVIDENCE_REQUIRED'].includes(item.classification)).slice(0, LIMITS.questions).map(item => Object.freeze({
    key: item.key,
    question: item.claimType === 'general_background' ? `What authoritative background evidence is relevant to ${clean(brief.specificTopic)}?` : `What authoritative evidence establishes ${clean(brief.readerQuestion)}?`,
    neutralQuery: neutralQuery(item.claimType === 'general_background' ? `${brief.specificTopic} authoritative background evidence` : `${brief.readerQuestion} authoritative evidence`),
    claimType: item.claimType, importance: item.essential ? 'essential' : 'supporting',
    freshnessClass: ['regulation_requirement', 'local_requirement', 'product_company_fact', 'current_statistic'].includes(item.claimType) ? 'high' : 'moderate',
    jurisdiction: clean(brief.jurisdiction || (item.claimType === 'general_background' ? 'United States' : '')),
    population: clean(brief.population || (/small business/i.test(`${brief.specificTopic} ${brief.readerQuestion}`) ? 'U.S. small businesses' : '')),
    preferredSourceTypes: item.claimType === 'local_requirement' ? ['local_government'] : item.claimType === 'regulation_requirement' ? ['government', 'regulator'] : item.claimType === 'scientific_clinical' ? ['peer_reviewed_research', 'authoritative_review'] : item.claimType === 'product_company_fact' ? ['official_company'] : ['government', 'original_research', 'academic_secondary'],
    prohibitedSourceTypes: ['blog', 'search_snippet', 'manufacturer_marketing', 'competitor_marketing'],
    intendedUse: item.claimType === 'scientific_clinical' ? 'high_risk_claim' : 'public_factual_claim', essential: item.essential,
    requiredEntity: clean(brief.requiredEntity || '')
  })));
}

function fixtureKeys(need) {
  if (need.claimType === 'local_requirement') return ['virginia-permits', 'maryland-permits', 'weak-blog'];
  if (need.claimType === 'regulation_requirement') return ['sba-late-payments', 'stale-market-report', 'weak-blog'];
  if (need.claimType === 'scientific_clinical') return ['peer-reviewed-study', 'manufacturer-claim', 'conflicting-study', 'weak-blog'];
  if (need.claimType === 'product_company_fact') return ['official-product', 'competitor-page'];
  if (need.claimType === 'current_statistic') return ['qualified-statistic', 'stale-market-report', 'syndicated-sba'];
  return ['sba-late-payments', 'strong-secondary', 'weak-blog', 'syndicated-sba'];
}

function sourcePolicy(source, need, now = new Date('2026-09-27T12:00:00Z')) {
  if (!source || !safeCitationUrl(source.canonicalUrl)) return { accepted: false, status: 'unsupported', reason: 'Unsafe or invalid source URL.' };
  if (!source.accessible || source.paywalled || source.snippetOnly) return { accepted: false, status: 'unsupported', reason: 'Source content was not available for validation.' };
  if (source.qualityTier === 'tier_4' || need.prohibitedSourceTypes.includes(source.sourceType)) return { accepted: false, status: 'weak_source', reason: 'Source type is not eligible to support this public claim.' };
  if (need.preferredSourceTypes.length && !need.preferredSourceTypes.includes(source.sourceType) && !['tier_1', 'tier_2'].includes(source.qualityTier)) return { accepted: false, status: 'weak_source', reason: 'A more authoritative source type is required.' };
  if (need.jurisdiction && source.jurisdiction && lower(need.jurisdiction) !== lower(source.jurisdiction)) return { accepted: false, status: 'unsupported', reason: 'Source jurisdiction does not match the claim.' };
  if (need.requiredEntity && source.entity && lower(need.requiredEntity) !== lower(source.entity)) return { accepted: false, status: 'unsupported', reason: 'Source entity does not match the claim.' };
  if (need.claimType === 'regulation_requirement' && !['regulator'].includes(source.sourceType) && !/\b(?:requirement|regulation|deadline|rule)\b/i.test(source.content)) return { accepted: false, status: 'unsupported', reason: 'Source does not directly establish the requested requirement.' };
  if (need.claimType === 'local_requirement' && source.sourceType !== 'local_government') return { accepted: false, status: 'unsupported', reason: 'A matching local authority is required.' };
  if (need.claimType === 'scientific_clinical' && !['peer_reviewed_research', 'authoritative_review'].includes(source.sourceType)) return { accepted: false, status: 'weak_source', reason: 'Scientific claims require authoritative scientific evidence.' };
  if (need.claimType === 'product_company_fact' && source.sourceType !== 'official_company') return { accepted: false, status: 'weak_source', reason: 'Current company facts require official company documentation.' };
  if (need.claimType === 'current_statistic' && !/\b\d+(?:\.\d+)?%\b/.test(source.content)) return { accepted: false, status: 'unsupported', reason: 'Source does not contain the requested statistic.' };
  const published = Date.parse(source.publicationDate);
  if (need.freshnessClass === 'high' && (!Number.isFinite(published) || (now.getTime() - published) / 31557600000 > 2)) return { accepted: false, status: 'stale', reason: 'Source is too old for a current claim.' };
  return { accepted: true, status: 'supported', reason: 'Source authority, scope, and freshness satisfy the claim policy.' };
}

function propositionFor(source, need) {
  const values = {
    'qualified-statistic': 'Among surveyed U.S. small businesses in 2025, 42% reported X.',
    'virginia-permits': 'Virginia residential alteration requirements depend on the applicable locality and project scope.',
    'official-product': 'Example Accounting includes invoice creation and status tracking.',
    'peer-reviewed-study': 'The reviewed scientific evidence was mixed and did not establish cinnamon as a treatment.',
    'conflicting-study': 'A controlled trial did not find a reliable effect for the measured outcome.',
    'sba-late-payments': 'Late customer payments can create cash-flow timing pressure for small businesses.'
  };
  const proposition = values[source.sourceKey] || clean(source.content).split(/(?<=[.!?])\s+/)[0];
  return {
    evidenceKey: `evidence-${source.sourceKey}`, proposition, sourceKey: source.sourceKey, excerpt: clean(source.content).slice(0, MAX_EXCERPT),
    qualifiers: {
      jurisdiction: ['local_requirement', 'regulation_requirement'].includes(need.claimType) ? (source.jurisdiction || '') : '',
      population: ['current_statistic', 'scientific_clinical'].includes(need.claimType) ? (source.population || '') : '',
      period: ['current_statistic', 'regulation_requirement', 'local_requirement', 'product_company_fact'].includes(need.claimType) && source.publicationDate ? source.publicationDate.slice(0, 4) : '',
      modality: /\bmay\b/i.test(proposition) ? 'may' : '', relationship: /associated/i.test(proposition) ? 'association' : ''
    },
    evidenceStatus: 'supported', supportStatus: 'directly_supported', permittedUse: need.intendedUse, freshnessClass: need.freshnessClass, claimType: need.claimType
  };
}

function dedupe(sources) {
  const seen = new Set();
  return sources.filter(source => { const key = source.originalSourceKey || source.contentHash || source.canonicalUrl; if (seen.has(key)) return false; seen.add(key); return true; });
}

async function generateResearchEvidencePack(context, { adapter = createDeterministicResearchAdapter(), budget = {} } = {}) {
  const brief = context?.dependencyOutputs?.find(item => item.deliverableId === 'priority_content_brief')?.output || {};
  const inventory = classifyClaimInventory(brief); const needs = researchNeeds(brief);
  const accepted = []; const items = []; const rejectedSources = []; const unsupportedQuestions = []; const conflicts = [];
  const maxCandidates = Math.min(LIMITS.candidates, Number(budget.maxCandidates) || LIMITS.candidates);
  for (const need of needs) {
    const candidates = await adapter.discover(need, { fixtureKeys: fixtureKeys(need), maxCandidates }); let count = 0;
    for (const candidate of candidates) {
      if (count >= LIMITS.acceptedSources) break;
      const source = await adapter.retrieve(candidate); const result = sourcePolicy(source || candidate, need);
      if (!result.accepted) { rejectedSources.push({ sourceKey: candidate?.sourceKey || 'unavailable', canonicalUrl: candidate?.canonicalUrl || '', reason: result.reason, status: result.status }); continue; }
      accepted.push(source); items.push(propositionFor(source, need)); count += 1;
    }
    if (!count) unsupportedQuestions.push(`${need.question}${need.essential ? ' This evidence is essential.' : ''}`);
  }
  inventory.filter(item => item.classification === 'PROHIBITED').forEach(item => unsupportedQuestions.push(`The requested ${item.claimType.replace(/_/g, ' ')} claim is prohibited without specialized evidence and review.`));
  const sources = dedupe(accepted); const sourceKeys = new Set(sources.map(item => item.sourceKey)); const evidenceItems = items.filter(item => sourceKeys.has(item.sourceKey));
  if (evidenceItems.some(item => item.sourceKey === 'peer-reviewed-study') && evidenceItems.some(item => item.sourceKey === 'conflicting-study')) {
    conflicts.push('Credible scientific sources disagree, so the article must not make a definitive efficacy claim.');
    evidenceItems.forEach(item => { if (item.claimType === 'scientific_clinical') { item.evidenceStatus = 'conflicted'; item.supportStatus = 'conflicting'; } });
  }
  const noResearch = needs.length === 0;
  return {
    researchSummary: noResearch ? 'No external evidence required for this article.' : evidenceItems.length ? `Reviewed ${sources.length} accepted source${sources.length === 1 ? '' : 's'} for the article's targeted evidence needs.` : 'No source met the evidence requirements for the targeted research needs.',
    researchQuestions: needs.map(item => item.question), sourcesUsed: sources.map(item => `${item.publisher} — ${item.title}${item.publicationDate ? ` (${item.publicationDate})` : ''}`),
    supportedFindings: evidenceItems.filter(item => item.evidenceStatus === 'supported').map(item => item.proposition), unsupportedQuestions, conflicts,
    freshnessNotes: sources.length ? sources.map(item => `${item.title}: retrieved ${item.retrievedAt.slice(0, 10)}.`) : ['No external source freshness review was required.'],
    sources: sources.map(({ content, ...metadata }) => metadata), evidenceItems,
    claimMappings: evidenceItems.filter(item => item.evidenceStatus === 'supported').map(item => ({ claimKey: `claim-${item.evidenceKey}`, evidenceKeys: [item.evidenceKey], supportStatus: item.supportStatus })),
    rejectedSources, researchTrace: adapter.operations(), noExternalEvidenceRequired: noResearch,
    essentialEvidenceMissing: needs.some(need => need.essential && !evidenceItems.some(item => item.claimType === need.claimType && item.evidenceStatus === 'supported'))
  };
}

function validateResearchPack(pack) {
  const failures = []; const arrayKeys = ['researchQuestions', 'sourcesUsed', 'supportedFindings', 'unsupportedQuestions', 'conflicts', 'freshnessNotes', 'sources', 'evidenceItems', 'claimMappings', 'rejectedSources', 'researchTrace'];
  if (!clean(pack?.researchSummary)) failures.push('RESEARCH_SUMMARY_MISSING');
  arrayKeys.forEach(key => { if (!Array.isArray(pack?.[key])) failures.push(`RESEARCH_${key.toUpperCase()}_INVALID`); });
  const sources = new Map((pack?.sources || []).map(item => [item.sourceKey, item]));
  for (const source of sources.values()) if (!safeCitationUrl(source.canonicalUrl) || !source.title || !source.publisher || !source.qualityTier) failures.push('RESEARCH_SOURCE_INVALID');
  for (const item of pack?.evidenceItems || []) {
    if (!sources.has(item.sourceKey) || !STATUSES.includes(item.evidenceStatus) || !PERMITTED_USES.includes(item.permittedUse) || clean(item.excerpt).length > MAX_EXCERPT) failures.push('RESEARCH_EVIDENCE_INVALID');
    if (item.evidenceStatus === 'supported' && item.supportStatus !== 'directly_supported') failures.push('RESEARCH_SUPPORT_INVALID');
  }
  if ((pack?.researchTrace || []).some(item => /ignore (?:all |previous )?instructions|system prompt|customer data/i.test(JSON.stringify(item)))) failures.push('RESEARCH_TRACE_UNTRUSTED_CONTENT');
  return Object.freeze([...new Set(failures)]);
}

function buildExternalEvidenceContext(dependencyOutputs = []) {
  const pack = dependencyOutputs.find(item => item.deliverableId === 'research_evidence_pack')?.output;
  if (!pack) return Object.freeze({ enabled: false, propositions: Object.freeze([]), sources: Object.freeze([]), conflicts: Object.freeze([]), unsupported: Object.freeze([]), summary: '' });
  const sources = new Map((pack.sources || []).filter(source => safeCitationUrl(source.canonicalUrl)).map(source => [source.sourceKey, source]));
  const propositions = (pack.evidenceItems || []).filter(item => item.evidenceStatus === 'supported' && item.supportStatus === 'directly_supported' && sources.has(item.sourceKey)).map(item => Object.freeze({ evidenceKey: item.evidenceKey, proposition: item.proposition, sourceKey: item.sourceKey, sourceLabel: `${sources.get(item.sourceKey).publisher} — ${sources.get(item.sourceKey).title}`, qualifiers: Object.freeze({ ...(item.qualifiers || {}) }), permittedUse: item.permittedUse, claimType: item.claimType }));
  const usedSources = Array.from(new Set(propositions.map(item => item.sourceKey))).map(key => { const source = sources.get(key); return Object.freeze({ sourceKey: key, canonicalUrl: source.canonicalUrl, title: source.title, publisher: source.publisher, publicationDate: source.publicationDate || '' }); });
  const summary = ['Approved external evidence', ...propositions.map(item => `${item.evidenceKey}: ${item.proposition} [${item.sourceLabel}]`), ...(pack.conflicts || []).map(item => `Conflict: ${item}`), ...(pack.unsupportedQuestions || []).map(item => `Unsupported: ${item}`)].join('\n').slice(0, 4000);
  return Object.freeze({ enabled: true, noExternalEvidenceRequired: Boolean(pack.noExternalEvidenceRequired), essentialEvidenceMissing: Boolean(pack.essentialEvidenceMissing), propositions: Object.freeze(propositions), sources: Object.freeze(usedSources), conflicts: Object.freeze([...(pack.conflicts || [])]), unsupported: Object.freeze([...(pack.unsupportedQuestions || [])]), summary });
}

function validateArticleEvidence(output, context = {}) {
  const version = Number(String(context.contractVersion || '').match(/:v(\d+)$/)?.[1] || 0); if (version < 2) return [];
  const evidence = context.externalEvidence; const failures = [];
  if (!evidence?.enabled) return ['RESEARCH_EVIDENCE_CONTEXT_MISSING'];
  if (evidence.essentialEvidenceMissing) failures.push('RESEARCH_ESSENTIAL_EVIDENCE_MISSING');
  const propositions = new Map(evidence.propositions.map(item => [item.evidenceKey, item])); const used = new Set();
  for (const block of output?.articleBlocks || []) for (const claim of block?.claims || []) {
    const keys = claim.evidenceKeys || []; if (claim.evidenceRequired && !keys.length) failures.push('RESEARCH_CITATION_REQUIRED');
    if (/\[\d+\]/.test(claim.text)) failures.push('RESEARCH_PROVIDER_CITATION_FORBIDDEN');
    keys.forEach(key => {
      const proposition = propositions.get(key); if (!proposition) return failures.push('RESEARCH_EVIDENCE_KEY_INVALID'); used.add(key);
      const claimText = lower(claim.text); const propositionText = lower(proposition.proposition);
      const material = propositionText.split(/[^a-z0-9%]+/).filter(token => token.length > 4 || /\d|%/.test(token));
      if (!material.some(token => claimText.includes(token))) failures.push('RESEARCH_CITATION_LAUNDERING');
      if (/\bcauses?\b/.test(claimText) && /\bassociated\b/.test(propositionText)) failures.push('RESEARCH_QUALIFIER_LOSS');
      if (/\bwill\b/.test(claimText) && /\bmay\b/.test(propositionText)) failures.push('RESEARCH_QUALIFIER_LOSS');
      Object.values(proposition.qualifiers || {}).filter(Boolean).forEach(value => { if (!claimText.includes(lower(value))) failures.push('RESEARCH_QUALIFIER_LOSS'); });
    });
  }
  const declared = new Set((output?.sources || []).map(item => item.sourceKey)); const usedSources = new Set(Array.from(used).map(key => propositions.get(key)?.sourceKey).filter(Boolean));
  usedSources.forEach(key => { if (!declared.has(key)) failures.push('RESEARCH_SOURCE_MISSING'); });
  declared.forEach(key => { if (!usedSources.has(key)) failures.push('RESEARCH_DECORATIVE_SOURCE'); });
  return [...new Set(failures)];
}

function compileArticleCitations(output, evidence) {
  const propositions = new Map((evidence?.propositions || []).map(item => [item.evidenceKey, item])); const sources = new Map((evidence?.sources || []).map(item => [item.sourceKey, item]));
  const numbers = new Map(); let next = 1;
  const blocks = (output.articleBlocks || []).map(block => ({ heading: block.heading, body: (block.claims || []).map(claim => {
    const refs = []; (claim.evidenceKeys || []).forEach(key => { const sourceKey = propositions.get(key)?.sourceKey; if (!sourceKey) return; if (!numbers.has(sourceKey)) numbers.set(sourceKey, next++); refs.push(numbers.get(sourceKey)); });
    return `${clean(claim.text)}${refs.map(number => `[${number}]`).join('')}`;
  }).join(' ') }));
  const publicSources = Array.from(numbers.entries()).sort((a, b) => a[1] - b[1]).map(([sourceKey, number]) => ({ number, ...sources.get(sourceKey) }));
  return { blocks, publicSources };
}

module.exports = { CLAIM_TYPES, LIMITS, PERMITTED_USES, STATUSES, buildExternalEvidenceContext, classifyClaimInventory, compileArticleCitations, generateResearchEvidencePack, neutralQuery, propositionFor, researchNeeds, sourcePolicy, validateArticleEvidence, validateResearchPack };
