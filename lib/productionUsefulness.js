const { buildEvidenceLedger } = require('./productionEvidence');
const { buildOrganicCompositionBrief } = require('./productionComposition');

function words(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

const DIMENSION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'how', 'in', 'is', 'of', 'on', 'or',
  'the', 'that', 'their', 'this', 'to', 'what', 'when', 'where', 'which', 'with'
]);

function conceptTokens(value) {
  return [...new Set(words(value).filter(token => token.length > 2 && !DIMENSION_STOP_WORDS.has(token)))];
}

function coversDecisionDimension(articleTokens, dimension) {
  const tokens = conceptTokens(dimension);
  if (!tokens.length) return false;
  const matched = tokens.filter(token => articleTokens.has(token)).length;
  return matched >= Math.min(2, tokens.length) && matched / tokens.length >= 0.4;
}

function coveredDecisionDimensions(article, compositionBrief) {
  const dimensions = compositionBrief?.decisionDimensions || [];
  const articleTokens = new Set(conceptTokens(article));
  if (dimensions.length) return dimensions.filter(dimension => coversDecisionDimension(articleTokens, dimension));
  const genericDimensions = [
    'the current situation', 'scope and responsibilities', 'available approaches',
    'review and verification', 'the next step'
  ];
  return genericDimensions.filter(dimension => coversDecisionDimension(articleTokens, dimension));
}

function legacyCoveredTopics(article) {
  const coveragePatterns = {
    records: /\b(?:records?|documents?|receipts?|invoices?|bills?)\b/i,
    reconciliation: /\b(?:reconcil|balances?|bank|credit card)\w*/i,
    timing: /\b(?:year[- ]end|deadline|monthly|quarterly|period)\b/i,
    review: /\b(?:review|check|confirm|verify|prepare)\w*/i,
    nextStep: /\b(?:consultation|service|support|next step|bookkeeper)\w*/i
  };
  return Object.entries(coveragePatterns).filter(([, pattern]) => pattern.test(article)).map(([key]) => key);
}

function markdownSections(markdown) {
  const sections = [];
  let current = { heading: 'Opening', body: [] };
  String(markdown || '').split(/\r?\n/).forEach(line => {
    const heading = line.match(/^#{2,3}\s+(.+)/);
    if (heading) {
      if (current.body.join(' ').trim()) sections.push({ heading: current.heading, body: current.body.join('\n').trim() });
      current = { heading: heading[1].trim(), body: [] };
    } else current.body.push(line);
  });
  if (current.body.join(' ').trim()) sections.push({ heading: current.heading, body: current.body.join('\n').trim() });
  return sections;
}

function groundedInConfirmedEvidence(publicText, ledger) {
  const outputTokens = new Set(words(publicText).filter(token => token.length > 2));
  return (ledger || []).filter(entry => entry.permittedUse === 'public_claim').filter(entry => {
    const evidenceTokens = [...new Set(words(entry.value).filter(token => token.length > 2))];
    if (!evidenceTokens.length) return false;
    const matched = evidenceTokens.filter(token => outputTokens.has(token)).length;
    return matched / evidenceTokens.length >= 0.45;
  });
}

function evaluateOrganicUsefulness(output, contract, context) {
  const article = String(output?.introduction || '');
  const sections = markdownSections(article);
  const developedSections = sections.filter(section => words(section.body).length >= 45);
  const concreteItems = (article.match(/^\s*(?:[-*]|\d+[.)])\s+\S.+$/gm) || []).length;
  const actionVerbs = article.match(/(?:^|[.!?]\s+)(begin|review|check|confirm|gather|compare|identify|organize|document|reconcile|prepare|record|separate|note|ask|list|define|clarify|verify|keep|look|translate|decide|select|establish|choose|use|distinguish|plan|consider|include|connect|measure|revisit)\b/gi) || [];
  const distinctActionVerbs = new Set(actionVerbs.map(value => value.trim().toLowerCase().split(/\s+/).pop()));
  const actionSentences = actionVerbs.length;
  const conditionalBoundaries = (article.match(/\b(?:if|when|where applicable|depending on|depends on|may|can)\b/gi) || []).length;
  const hasDomainContext = Boolean(context?.compositionBrief || context?.strategySnapshot);
  const compositionBrief = hasDomainContext
    ? (context.compositionBrief || buildOrganicCompositionBrief(context))
    : null;
  const coveredTopics = compositionBrief
    ? coveredDecisionDimensions(article, compositionBrief)
    : legacyCoveredTopics(article);
  const publicText = [output?.pillarTitle, article, output?.callToAction, ...(output?.distributionPosts || [])].join('\n');
  const ledger = context?.evidenceLedger || buildEvidenceLedger({
    strategySnapshot: context?.strategySnapshot,
    brandContext: context?.brandContext,
    dependencyOutputs: context?.dependencyOutputs
  });
  const groundedEntries = groundedInConfirmedEvidence(publicText, ledger);
  const availableConfirmedEvidence = ledger.filter(entry => entry.permittedUse === 'public_claim');
  const policy = contract?.usefulnessContract || {};
  const minimumDevelopedSections = policy.minimumDevelopedSections || 5;
  const minimumConcreteActions = policy.minimumConcreteActions || 5;
  const minimumScopeBoundaries = policy.minimumScopeBoundaries || 3;
  const minimumTopicDimensions = policy.minimumTopicDimensions || 4;
  const minimumConfirmedEvidenceReferences = Math.min(
    policy.minimumConfirmedEvidenceReferences || 2,
    availableConfirmedEvidence.length
  );
  const failures = [];
  if (developedSections.length < minimumDevelopedSections) failures.push(`develop at least ${minimumDevelopedSections} sections with concrete explanations`);
  if (concreteItems + actionSentences < minimumConcreteActions) failures.push(`include at least ${minimumConcreteActions} concrete checks, decisions, or actions`);
  if (distinctActionVerbs.size < 5) failures.push('use at least five distinct decision actions rather than repeating generic advice');
  if (conditionalBoundaries < minimumScopeBoundaries) failures.push('state meaningful scope boundaries and conditions');
  if (coveredTopics.length < minimumTopicDimensions) {
    failures.push('cover the industry-specific reader decision dimensions from the composition brief');
  }
  if (availableConfirmedEvidence.length && groundedEntries.length < minimumConfirmedEvidenceReferences) {
    failures.push('use the available confirmed facts from the evidence ledger');
  }
  return Object.freeze({
    valid: failures.length === 0,
    failures: Object.freeze(failures),
    metrics: Object.freeze({
      developedSectionCount: developedSections.length,
      concreteActionCount: concreteItems + actionSentences,
      distinctDecisionActionCount: distinctActionVerbs.size,
      conditionalBoundaryCount: conditionalBoundaries,
      coveredTopics: Object.freeze(coveredTopics),
      groundedEvidenceIds: Object.freeze(groundedEntries.map(entry => entry.id))
    })
  });
}

function evaluateSubstantiveUsefulness(output, contract, context) {
  if (contract?.id === 'organic_content_campaign') return evaluateOrganicUsefulness(output, contract, context);
  return Object.freeze({ valid: true, failures: Object.freeze([]), metrics: Object.freeze({}) });
}

module.exports = { evaluateOrganicUsefulness, evaluateSubstantiveUsefulness, groundedInConfirmedEvidence, markdownSections };
