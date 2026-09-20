function words(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
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

function evaluateOrganicUsefulness(output, context) {
  const article = String(output?.introduction || '');
  const sections = markdownSections(article);
  const developedSections = sections.filter(section => words(section.body).length >= 45);
  const concreteItems = (article.match(/^\s*(?:[-*]|\d+[.)])\s+\S.+$/gm) || []).length;
  const actionSentences = (article.match(/(?:^|[.!?]\s+)(?:review|check|confirm|gather|compare|identify|organize|document|reconcile|prepare|record|separate|note)\b/gi) || []).length;
  const conditionalBoundaries = (article.match(/\b(?:if|when|where applicable|depending on|depends on|may|can)\b/gi) || []).length;
  const coveragePatterns = {
    records: /\b(?:records?|documents?|receipts?|invoices?|bills?)\b/i,
    reconciliation: /\b(?:reconcil|balances?|bank|credit card)\w*/i,
    timing: /\b(?:year[- ]end|deadline|monthly|quarterly|period)\b/i,
    review: /\b(?:review|check|confirm|verify|prepare)\w*/i,
    nextStep: /\b(?:consultation|service|support|next step|bookkeeper)\w*/i
  };
  const coveredTopics = Object.entries(coveragePatterns).filter(([, pattern]) => pattern.test(article)).map(([key]) => key);
  const publicText = [output?.pillarTitle, article, output?.callToAction, ...(output?.distributionPosts || [])].join('\n');
  const ledger = context?.evidenceLedger || buildEvidenceLedger({
    strategySnapshot: context?.strategySnapshot,
    brandContext: context?.brandContext,
    dependencyOutputs: context?.dependencyOutputs
  });
  const groundedEntries = groundedInConfirmedEvidence(publicText, ledger);
  const availableConfirmedEvidence = ledger.filter(entry => entry.permittedUse === 'public_claim');
  const failures = [];
  if (developedSections.length < 5) failures.push('develop at least five sections with concrete explanations');
  if (concreteItems + actionSentences < 5) failures.push('include at least five concrete checks, decisions, or actions');
  if (conditionalBoundaries < 3) failures.push('state meaningful scope boundaries and conditions');
  if (coveredTopics.length < 4) failures.push('cover records, reconciliation, timing, review, and a relevant next step');
  if (availableConfirmedEvidence.length && groundedEntries.length < Math.min(2, availableConfirmedEvidence.length)) {
    failures.push('use the available confirmed facts from the evidence ledger');
  }
  return Object.freeze({
    valid: failures.length === 0,
    failures: Object.freeze(failures),
    metrics: Object.freeze({
      developedSectionCount: developedSections.length,
      concreteActionCount: concreteItems + actionSentences,
      conditionalBoundaryCount: conditionalBoundaries,
      coveredTopics: Object.freeze(coveredTopics),
      groundedEvidenceIds: Object.freeze(groundedEntries.map(entry => entry.id))
    })
  });
}

function evaluateSubstantiveUsefulness(output, contract, context) {
  if (contract?.id === 'organic_content_campaign') return evaluateOrganicUsefulness(output, context);
  return Object.freeze({ valid: true, failures: Object.freeze([]), metrics: Object.freeze({}) });
}

module.exports = { evaluateOrganicUsefulness, evaluateSubstantiveUsefulness, groundedInConfirmedEvidence, markdownSections };
const { buildEvidenceLedger } = require('./productionEvidence');
