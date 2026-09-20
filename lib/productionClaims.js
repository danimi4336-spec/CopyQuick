const { buildEvidenceLedger } = require('./productionEvidence');

function normalizedClaim(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_#>]/g, '')
    .replace(/[^a-z0-9?]+/g, ' ')
    .trim();
}

function publicClaimUnits(output, contract) {
  const units = [];
  for (const field of contract?.publicFieldKeys || []) {
    const values = Array.isArray(output?.[field]) ? output[field] : [output?.[field]];
    for (const value of values) {
      String(value || '').split(/\r?\n/).forEach(line => {
        const clean = line.replace(/^\s*(?:#{1,6}|[-*]|\d+[.)])\s+/, '').trim();
        if (!clean) return;
        const pieces = clean.match(/[^.!?]+[.!?]?/g) || [];
        pieces.map(piece => piece.trim()).filter(piece => piece.split(/\s+/).length >= 8).forEach(piece => {
          const normalized = normalizedClaim(piece);
          if (normalized && !units.some(unit => unit.normalized === normalized)) units.push({ field, text: piece, normalized });
        });
      });
    }
  }
  return units;
}

function parseClaimSupport(entries) {
  return (Array.isArray(entries) ? entries : []).map(entry => {
    const separator = String(entry || '').indexOf('::');
    if (separator < 1) return null;
    return {
      sourceId: String(entry).slice(0, separator).trim(),
      claim: String(entry).slice(separator + 2).trim(),
      normalized: normalizedClaim(String(entry).slice(separator + 2))
    };
  }).filter(Boolean);
}

function isConditionalGuidance(claim) {
  const text = String(claim || '').trim();
  return /\?\s*$/.test(text)
    || /\b(?:if|when|before|depending on|where applicable|may|might|can|could|consider)\b/i.test(text)
    || /^(?:begin|review|check|confirm|gather|compare|identify|organize|document|reconcile|prepare|record|separate|note|ask|list|define|clarify|verify|keep|look)\b/i.test(text);
}

function isGeneralGuidance(claim) {
  const text = String(claim || '');
  const regulatedLocalOrQuantified = /\b(?:Toronto|Ontario|HST|GST|tax|legal|law|deadline|percent|\d{2,})\b|%/i.test(text);
  const audienceAssertion = /\b(?:owners?|customers?|clients?|prospects?|readers?|searchers?)\b/i.test(text);
  const specificEntityAssertion = /\b(?:your|our|this|that|the)\s+(?:business|company|firm|service|offer)\b|\b(?:we|us|ours)\b/i.test(text);
  return !regulatedLocalOrQuantified && !audienceAssertion && !specificEntityAssertion;
}

function claimMatchesEvidence(claim, evidence) {
  const ignored = new Set(['about', 'after', 'before', 'between', 'business', 'company', 'from', 'have', 'into', 'more', 'that', 'their', 'these', 'this', 'through', 'with', 'your']);
  const claimTokens = new Set(normalizedClaim(claim).split(' ').filter(token => token.length > 3 && !ignored.has(token)));
  const evidenceTokens = [...new Set(normalizedClaim(evidence?.value).split(' ').filter(token => token.length > 3 && !ignored.has(token)))];
  const matched = evidenceTokens.filter(token => claimTokens.has(token));
  return matched.length >= Math.min(2, evidenceTokens.length);
}

function validateClaimSupport(output, contract, context) {
  if (contract?.id !== 'organic_content_campaign' || !contract?.claimProvenanceContract) {
    return Object.freeze({ valid: true, failures: Object.freeze([]), metrics: Object.freeze({}) });
  }
  const units = publicClaimUnits(output, contract);
  const support = parseClaimSupport(output?.claimSupport);
  const ledger = context?.evidenceLedger || buildEvidenceLedger({
    strategySnapshot: context?.strategySnapshot,
    brandContext: context?.brandContext,
    dependencyOutputs: context?.dependencyOutputs
  });
  const hasEvidenceContext = Boolean(context?.evidenceLedger || context?.strategySnapshot || context?.brandContext || context?.dependencyOutputs);
  const publicEvidence = new Map(ledger.filter(entry => entry.permittedUse === 'public_claim').map(entry => [entry.id, entry]));
  const failures = [];
  const validMappings = [];
  const invalidMappings = [];
  support.forEach(mapping => {
    const unit = units.find(candidate => candidate.normalized === mapping.normalized);
    const validSource = (publicEvidence.has(mapping.sourceId) && claimMatchesEvidence(mapping.claim, publicEvidence.get(mapping.sourceId)))
      || (!hasEvidenceContext && /^(?:strategy|brand)\.[A-Za-z0-9_.-]+$/.test(mapping.sourceId))
      || (mapping.sourceId === 'conditional_guidance' && isConditionalGuidance(mapping.claim))
      || (mapping.sourceId === 'general_guidance' && isGeneralGuidance(mapping.claim));
    if (unit && validSource) validMappings.push({ ...mapping, field: unit.field });
    else invalidMappings.push(mapping);
  });
  const covered = new Set(validMappings.map(mapping => mapping.normalized));
  const coverage = units.length ? covered.size / units.length : 0;
  const confirmedIds = [...new Set(validMappings.filter(mapping => publicEvidence.has(mapping.sourceId)
    || (!hasEvidenceContext && /^(?:strategy|brand)\./.test(mapping.sourceId))).map(mapping => mapping.sourceId))];
  if (invalidMappings.length) failures.push('remove claim mappings that use unknown evidence, non-public evidence, inexact excerpts, or unconditional generalizations');
  const minimumCoverage = Number(contract.claimProvenanceContract.minimumCoverage || 1);
  if (coverage < minimumCoverage) failures.push(`map ${Math.round(minimumCoverage * 100)}% of substantive public sentences to confirmed evidence or qualified guidance`);
  return Object.freeze({
    valid: failures.length === 0,
    failures: Object.freeze(failures),
    metrics: Object.freeze({
      claimUnitCount: units.length,
      validMappingCount: validMappings.length,
      invalidMappingCount: invalidMappings.length,
      coverage,
      confirmedEvidenceIds: Object.freeze(confirmedIds)
    })
  });
}

function reconcileClaimSupport(output, contract, context) {
  if (contract?.id !== 'organic_content_campaign' || !contract?.claimProvenanceContract) return output;
  const ledger = context?.evidenceLedger || buildEvidenceLedger({
    strategySnapshot: context?.strategySnapshot,
    brandContext: context?.brandContext,
    dependencyOutputs: context?.dependencyOutputs
  });
  const publicEvidence = ledger.filter(entry => entry.permittedUse === 'public_claim');
  const supplied = parseClaimSupport(output?.claimSupport);
  const claimSupport = publicClaimUnits(output, contract).map(unit => {
    const suppliedMapping = supplied.find(mapping => mapping.normalized === unit.normalized);
    const suppliedEvidence = publicEvidence.find(entry => entry.id === suppliedMapping?.sourceId);
    let sourceId = suppliedEvidence && claimMatchesEvidence(unit.text, suppliedEvidence) ? suppliedEvidence.id : null;
    if (!sourceId && suppliedMapping?.sourceId === 'conditional_guidance' && isConditionalGuidance(unit.text)) sourceId = 'conditional_guidance';
    if (!sourceId && suppliedMapping?.sourceId === 'general_guidance' && isGeneralGuidance(unit.text)) sourceId = 'general_guidance';
    if (!sourceId) sourceId = publicEvidence.find(entry => claimMatchesEvidence(unit.text, entry))?.id || null;
    if (!sourceId && isConditionalGuidance(unit.text)) sourceId = 'conditional_guidance';
    if (!sourceId && isGeneralGuidance(unit.text)) sourceId = 'general_guidance';
    return sourceId ? `${sourceId} :: ${unit.text}` : null;
  }).filter(Boolean);
  return { ...output, claimSupport };
}

module.exports = { claimMatchesEvidence, isConditionalGuidance, isGeneralGuidance, normalizedClaim, parseClaimSupport, publicClaimUnits, reconcileClaimSupport, validateClaimSupport };
