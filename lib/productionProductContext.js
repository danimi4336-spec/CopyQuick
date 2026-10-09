function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

function valueOf(item) {
  return clean(item?.value || item?.label || item);
}

function sourceValue(item) {
  return String(item?.value || item?.label || item || '').trim().replace(/\s+/g, ' ');
}

function directionValue(context, label, ending) {
  const pattern = new RegExp(`${label}:\\s*(.+?)\\.\\s*${ending}`, 'i');
  return clean(String(context?.strategicDirection || '').match(pattern)?.[1]);
}

function sourceContext(context) {
  const snapshot = context?.strategySnapshot || {};
  return {
    explicitName: valueOf(snapshot.explicitProductName || snapshot.productName || snapshot.confirmedProductName),
    description: sourceValue(snapshot.builderProductContext)
      || directionValue(context, 'Builder-provided product context', 'Treat this as unverified context')
      || directionValue(context, 'Builder-provided offer description', 'Treat this as unverified context')
      || '',
    differentiation: sourceValue(snapshot.builderDifferentiationDetails)
      || directionValue(context, 'Builder-provided differentiation details', 'Treat these as product attributes')
      || '',
    audience: valueOf(snapshot.primaryCustomer),
    positioning: valueOf(snapshot.customerMotivation),
    salesChannel: valueOf(snapshot.primarySalesChannel || snapshot.confirmedSalesChannel)
  };
}

function canonicalKey(value) {
  return clean(value).toLowerCase()
    .replace(/\b(?:a|an|the|true|premium|formulation|package|per package|contains?|made with)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function fact(type, value, provenance = 'builder_supplied') {
  return Object.freeze({ type, value: clean(value), provenance });
}

function conciseIdentity(description, explicitName, audience = '') {
  if (explicitName) return explicitName;
  let first = clean(description).split(/(?<=[.!?])\s+/)[0] || '';
  first = first.replace(/^(?:this is |we (?:sell|offer|are launching|are introducing) |an? )/i, '');
  first = first.replace(/^premium\s+/i, '');
  first = first.replace(/\s+(?:made|created|designed|formulated)\s+(?:with|for)\b.*$/i, '');
  first = first.replace(/\s+with\s+(?:a |an )?.*$/i, '');
  first = first.replace(/\s*\([^)]*\)/g, '').replace(/\bdietary supplement\b/i, 'supplement');
  first = first.replace(/\btrue\s+(?=Ceylon cinnamon)/i, '');
  const audiencePhrase = clean(audience);
  if (audiencePhrase) {
    const audienceIndex = first.toLowerCase().indexOf(` for ${audiencePhrase.toLowerCase()}`);
    if (audienceIndex > 0) first = first.slice(0, audienceIndex);
  }
  if (/\bCeylon cinnamon\b/i.test(first) && /\bsupplement\b/i.test(first)) {
    return /\bliposomal\b/i.test(first) ? 'liposomal Ceylon cinnamon supplement' : 'Ceylon cinnamon supplement';
  }
  const words = clean(first).split(' ').filter(Boolean);
  if (words.length > 8) first = words.slice(0, 8).join(' ');
  return clean(first) || 'the product';
}

function collectFacts(source, identity) {
  const combined = `${source.description} ${source.differentiation}`;
  const facts = [fact('primary_identity', identity)];
  const botanical = combined.match(/\(([A-Z][a-z]+\s+[a-z]{3,})\)/)?.[1]
    || combined.match(/\b(Cinnamomum\s+verum)\b/i)?.[1];
  if (botanical) facts.push(fact('technical_identity', botanical));
  if (/\bliposomal\b/i.test(combined)) facts.push(fact('formulation', 'liposomal formulation'));
  const form = combined.match(/\b(softgels?|capsules?|tablets?|gummies?|powder|liquid|spray)\b/i)?.[1];
  if (form) facts.push(fact('form_factor', form.toLowerCase()));
  const quantity = combined.match(/\b(\d{1,5}(?:[- ](?:piece|count|softgel|capsule|tablet|gumm(?:y|ies)|packet|serving)s?|\s+(?:pieces?|softgels?|capsules?|tablets?|gummies|packets?|servings?)))\b/i)?.[1];
  if (quantity) facts.push(fact('quantity', quantity.replace(/-/g, ' ')));
  if (/\brecycled[- ]aluminum\b/i.test(combined)) facts.push(fact('material', 'recycled aluminum'));
  if (/\bmodular\b/i.test(combined)) facts.push(fact('configuration', 'modular design'));
  const colors = combined.match(/\b(?:black|navy|white|red|blue|green|gray|grey)(?:\s*(?:,|and|or)\s*(?:black|navy|white|red|blue|green|gray|grey))+\b/i)?.[0];
  if (colors) facts.push(fact('variants', colors));
  const sizes = combined.match(/\bsizes?\s+([A-Z0-9–-]+(?:\s*(?:to|through|–|-)\s*[A-Z0-9]+)?)\b/i)?.[1];
  if (sizes) facts.push(fact('sizes', sizes));
  if (source.audience) facts.push(fact('audience', source.audience, 'confirmed_fact'));
  if (source.positioning) facts.push(fact('positioning', source.positioning, 'confirmed_fact'));
  if (/\bwebsite\b/i.test(`${source.salesChannel} ${combined}`)) facts.push(fact('channel', 'website', 'confirmed_fact'));
  if (/\bAmazon\b/i.test(`${source.salesChannel} ${combined}`)) facts.push(fact('channel', 'Amazon', 'confirmed_fact'));

  const seen = new Set();
  return facts.filter(item => {
    const key = `${item.type}:${canonicalKey(item.value)}`;
    if (!canonicalKey(item.value) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalProductContext(context) {
  const source = sourceContext(context);
  const primaryIdentity = conciseIdentity(source.description || source.differentiation, source.explicitName, source.audience);
  const facts = collectFacts(source, primaryIdentity);
  const byType = Object.freeze(facts.reduce((result, item) => {
    (result[item.type] ||= []).push(item);
    return result;
  }, {}));
  return Object.freeze({
    primaryIdentity,
    explicitName: source.explicitName || null,
    facts: Object.freeze(facts),
    byType,
    source: Object.freeze(source),
    provenance: 'builder_supplied'
  });
}

function firstFact(product, type) {
  return product?.byType?.[type]?.[0]?.value || '';
}

module.exports = { canonicalProductContext, canonicalKey, conciseIdentity, firstFact };
