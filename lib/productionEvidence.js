function humanLabel(key) {
  return String(key || '').replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());
}

function textValue(value) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join('; ');
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

const ROLE_POLICY = Object.freeze({
  confirmed_fact: Object.freeze({ provenance: 'user_confirmed', permittedUse: 'public_claim' }),
  inferred_fact: Object.freeze({ provenance: 'system_inference', permittedUse: 'context_only' }),
  strategic_recommendation: Object.freeze({ provenance: 'strategy_recommendation', permittedUse: 'direction_only' }),
  exploration_intent: Object.freeze({ provenance: 'builder_exploration', permittedUse: 'context_only' }),
  builder_provided_context: Object.freeze({ provenance: 'builder_supplied', permittedUse: 'context_only' }),
  builder_provided_product_context: Object.freeze({ provenance: 'builder_supplied', permittedUse: 'context_only' }),
  derived_risk: Object.freeze({ provenance: 'system_derived', permittedUse: 'internal_only' }),
  unresolved: Object.freeze({ provenance: 'unresolved', permittedUse: 'do_not_claim' })
});

function ledgerEntry({ id, label, value, semanticRole, provenance, permittedUse, source }) {
  const normalized = textValue(value);
  if (!normalized || normalized === 'Unknown') return null;
  const policy = ROLE_POLICY[semanticRole] || { provenance: provenance || 'unspecified', permittedUse: 'context_only' };
  return Object.freeze({
    id,
    label: label || humanLabel(id),
    value: normalized,
    semanticRole: semanticRole || 'unspecified',
    provenance: provenance || policy.provenance,
    permittedUse: permittedUse || policy.permittedUse,
    source: source || id
  });
}

function buildEvidenceLedger({ strategySnapshot = {}, brandContext = null, dependencyOutputs = [] } = {}) {
  const entries = [];
  Object.entries(strategySnapshot).forEach(([key, item]) => {
    const entry = ledgerEntry({
      id: `strategy.${key}`,
      label: humanLabel(key),
      value: item?.value,
      semanticRole: item?.semanticRole,
      provenance: item?.source || null,
      source: Array.isArray(item?.sourceFields) && item.sourceFields.length
        ? item.sourceFields.map(humanLabel).join(', ')
        : humanLabel(key)
    });
    if (entry) entries.push(entry);
  });
  if (brandContext) {
    [['businessName', 'Brand name', 'confirmed_fact'], ['voice', 'Brand voice', 'confirmed_fact'],
      ['uniqueValue', 'Builder-provided value context', 'builder_provided_context'],
      ['keyMessages', 'Builder-provided key-message context', 'builder_provided_context']]
      .forEach(([key, label, semanticRole]) => {
        const entry = ledgerEntry({ id: `brand.${key}`, label, value: brandContext[key], semanticRole, source: 'Brand context' });
        if (entry) entries.push(entry);
      });
  }
  dependencyOutputs.forEach(dependency => {
    Object.entries(dependency.output || {}).forEach(([key, value]) => {
      const entry = ledgerEntry({
        id: `dependency.${dependency.deliverableId}.${key}`,
        label: `${dependency.title || humanLabel(dependency.deliverableId)} — ${humanLabel(key)}`,
        value,
        semanticRole: 'generated_dependency',
        provenance: `generated:${dependency.contractVersion || dependency.deliverableId}`,
        permittedUse: 'direction_only',
        source: dependency.title || humanLabel(dependency.deliverableId)
      });
      if (entry) entries.push(entry);
    });
  });
  return Object.freeze(entries);
}

function renderEvidenceLedger(entries, limit = 8000) {
  const grouped = new Map();
  (entries || []).forEach(entry => {
    if (!grouped.has(entry.permittedUse)) grouped.set(entry.permittedUse, []);
    grouped.get(entry.permittedUse).push(entry);
  });
  const labels = {
    public_claim: 'CONFIRMED FACTS — may be stated in public copy',
    context_only: 'SUPPLIED CONTEXT — may guide relevance but is not proof',
    direction_only: 'RECOMMENDATIONS AND GENERATED PLANS — direction only, not facts',
    internal_only: 'INTERNAL RISKS — do not place in public copy',
    do_not_claim: 'UNRESOLVED — do not claim'
  };
  return Array.from(grouped.entries()).map(([use, items]) => [
    labels[use] || use.toUpperCase(),
    ...items.map(item => `- ${item.label}: ${item.value} [id: ${item.id}; source: ${item.source}]`)
  ].join('\n')).join('\n\n').slice(0, limit);
}

module.exports = { ROLE_POLICY, buildEvidenceLedger, renderEvidenceLedger };
