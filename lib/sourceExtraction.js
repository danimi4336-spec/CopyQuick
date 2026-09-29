const crypto = require('crypto');
const { safeCitationUrl } = require('./researchAdapter');

const EXTRACTION_LIMITS = Object.freeze({
  normalizedTextCharacters: 100000,
  candidateWindows: 3,
  windowCharacters: 1200,
  persistedPassages: 2,
  persistedPassageCharacters: 800
});

const clean = value => String(value || '').trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
const flat = value => clean(value).replace(/\s+/g, ' ');
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');

function canonicalExtractionUrl(value) {
  if (!safeCitationUrl(value)) return '';
  try {
    const url = new URL(String(value).trim());
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'msclkid'].includes(key.toLowerCase())) url.searchParams.delete(key);
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch (_) { return ''; }
}

function normalizeExtractedText(value, maximum = EXTRACTION_LIMITS.normalizedTextCharacters) {
  const raw = String(value || '');
  if (raw.length > maximum) {
    const error = new Error('Extracted source content exceeded the configured limit.');
    error.code = 'EXTRACTION_CONTENT_TOO_LARGE';
    throw error;
  }
  return clean(raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n'));
}

function extractionAnchors(need = {}, source = {}) {
  const phrases = [need.question, need.neutralQuery, need.population, need.jurisdiction, source.title,
    need.claimType === 'current_statistic' ? 'small business businesses employer firms nonemployer share percent number year United States' : ''].map(flat).filter(Boolean);
  const words = phrases.flatMap(value => value.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?%?/g) || [])
    .filter(token => /\d/.test(token) || token.length > 3)
    .filter(token => !['percent', 'percentage', 'united', 'states', 'businesses'].includes(token));
  return Object.freeze({ phrases: Object.freeze([...new Set(phrases)]), words: Object.freeze([...new Set(words)]) });
}

function anchorScore(text, anchors) {
  const normalized = flat(text).toLowerCase(); let score = 0;
  for (const phrase of anchors.phrases) if (normalized.includes(phrase.toLowerCase())) score += /\d/.test(phrase) ? 8 : 4;
  for (const word of anchors.words) if (normalized.includes(word)) score += /\d/.test(word) ? 5 : 1;
  return score;
}

function structuralBlockType(text) {
  const value = String(text || '').trim();
  if (/^(?:[-*•]|\d+[.)])\s+/.test(value)) return 'LIST_ITEM';
  if (/^[^|\n]{1,100}\s*\|\s*[^|\n]+$/.test(value) || /^[^:\n]{1,100}:\s+\S+/.test(value)) return 'TABLE_LIKE_ROW';
  if (/^#{1,6}\s+/.test(value) || (value.length <= 120 && !/[.!?]$/.test(value) && !/\b\d+(?:\.\d+)?\s*(?:%|percent|million|billion|thousand)\b/i.test(value))) return 'HEADING';
  return /[.!?]$/.test(value) ? 'PARAGRAPH' : 'UNKNOWN_TEXT';
}

function structuralBlocks(normalizedText, limits = EXTRACTION_LIMITS) {
  const text = normalizeExtractedText(normalizedText, limits.normalizedTextCharacters);
  const chunks = text.split(/\n+/).map(value => value.trim()).filter(Boolean);
  const values = chunks.length > 1 ? chunks : text.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  return Object.freeze(values.map((value, index) => Object.freeze({ index, type: structuralBlockType(value), text: flat(value.replace(/^#{1,6}\s+/, '').replace(/^(?:[-*•]|\d+[.)])\s+/, '')) })));
}

function plausibleNumericStatement(text) {
  return /\b(?:about|approximately|nearly|more than|less than|at least|up to)?\s*\d+(?:,\d{3})*(?:\.\d+)?\s*(?:%|percent(?:age)?|million|billion|thousand)(?!\w)/i.test(text);
}

function candidateWindows(normalizedText, need, source, limits = EXTRACTION_LIMITS) {
  const text = normalizeExtractedText(normalizedText, limits.normalizedTextCharacters);
  const blocks = structuralBlocks(text, limits);
  const units = blocks.length > 1 ? blocks : text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((value, index) => Object.freeze({ index, type: 'PARAGRAPH', text: flat(value) })).filter(item => item.text);
  const anchors = extractionAnchors(need, source); const candidates = [];
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]; const numeric = plausibleNumericStatement(unit.text);
    if (need.claimType === 'current_statistic' && !numeric) continue;
    const neighbors = [units[index - 1], units[index + 1]].filter(Boolean);
    const variants = [[unit], ...neighbors.map(neighbor => neighbor.index < unit.index ? [neighbor, unit] : [unit, neighbor])];
    for (const variant of variants) {
      const window = flat(variant.map(item => item.text).join(' '));
      if (window.length > limits.windowCharacters || window.length > limits.persistedPassageCharacters) continue;
      const directTopic = /\bsmall businesses?\b/i.test(`${need.question || ''} ${need.neutralQuery || ''}`) && /\bsmall businesses?\b/i.test(window) ? 6 : 0;
      const score = anchorScore(window, anchors) + (numeric ? 12 : 0) + directTopic + (completeMaterialPassage(window, source, need) ? 20 : 0);
      if (score > 0) candidates.push({ index: unit.index, text: window, score, blocks: variant.map(item => ({ index: item.index, type: item.type, text: item.text })) });
    }
  }
  return Object.freeze(candidates.sort((left, right) => right.score - left.score || left.text.length - right.text.length || left.index - right.index)
    .filter((item, index, all) => all.findIndex(other => other.text === item.text) === index)
    .slice(0, Math.max(limits.candidateWindows, 5)).map(item => Object.freeze({ ...item, blocks: Object.freeze((item.blocks || []).map(block => Object.freeze(block))) })));
}

function passageCandidates(window) {
  const sentences = flat(window).split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(flat).filter(Boolean); const result = [...sentences];
  for (let index = 0; index < sentences.length - 1; index += 1) result.push(`${sentences[index]} ${sentences[index + 1]}`);
  result.push(flat(window)); return [...new Set(result)];
}

function containsMaterial(haystack, value) {
  const expected = flat(value).toLowerCase().replace(/\bu\.?s\.?\b/g, 'united states').match(/[a-z0-9]+(?:\.[0-9]+)?%?/g) || [];
  const actual = new Set((flat(haystack).toLowerCase().replace(/\bu\.?s\.?\b/g, 'united states').match(/[a-z0-9]+(?:\.[0-9]+)?%?/g) || []));
  const material = expected.filter(token => /\d/.test(token) || token.length > 2).filter(token => !['the', 'that', 'were', 'are'].includes(token));
  return !material.length || material.every(token => actual.has(token));
}

function completeMaterialPassage(text, source, need = {}) {
  if (need.claimType !== 'current_statistic') return true;
  return /\b\d+(?:\.\d+)?\s*(?:%|percent(?:age)?|million|billion|thousand)(?!\w)/i.test(text)
    && /\b(?:19|20)\d{2}\b/.test(text)
    && /\b(?:business|businesses|firm|firms|establishment|establishments|employer|nonemployer)\b/i.test(text);
}

function groundedPassages(windows, need, source, limits = EXTRACTION_LIMITS) {
  const structural = windows.map(window => ({ window, complete: completeMaterialPassage(window.text, source, need) }))
    .filter(item => item.complete && windowPassages(item.window).map(block => block.text).join(' ').length <= limits.persistedPassageCharacters)
    .sort((left, right) => right.window.score - left.window.score || left.window.text.length - right.window.text.length);
  if (structural.length) return Object.freeze(windowPassages(structural[0].window).slice(0, limits.persistedPassages).map(item => Object.freeze(item)));
  const anchors = extractionAnchors(need, source);
  const ranked = windows.flatMap(window => passageCandidates(window.text).map(text => ({ text, index: window.index, score: anchorScore(text, anchors), complete: completeMaterialPassage(text, source, need) })))
    .filter(item => item.text.length <= limits.persistedPassageCharacters)
    .sort((left, right) => Number(right.complete) - Number(left.complete) || right.score - left.score || left.text.length - right.text.length);
  if (!ranked.length) return Object.freeze([]);
  const first = ranked[0];
  if (completeMaterialPassage(first.text, source, need)) return Object.freeze([Object.freeze(first)]);
  const second = ranked.find(item => item.index !== first.index && `${first.text} ${item.text}`.length <= limits.persistedPassageCharacters
    && completeMaterialPassage(`${first.text} ${item.text}`, source, need));
  return Object.freeze(second ? [Object.freeze(first), Object.freeze(second)] : [Object.freeze(first)]);
}

function windowPassages(window) {
  const blocks = Array.isArray(window?.blocks) && window.blocks.length ? window.blocks : [{ index: window.index, type: 'UNKNOWN_TEXT', text: window.text }];
  return blocks.map(block => ({ index: block.index, type: block.type, text: flat(block.text) }));
}

function parserWindows(normalizedText, need, source, limits = EXTRACTION_LIMITS) {
  return Object.freeze(candidateWindows(normalizedText, need, source, limits).slice(0, 3).map((window, index) => Object.freeze({
    id: `W${index + 1}`, index: window.index, text: window.text.slice(0, limits.windowCharacters),
    blockTypes: Object.freeze((window.blocks || []).map(block => block.type)), blockIndexes: Object.freeze((window.blocks || []).map(block => block.index))
  })));
}

function extractionDiagnostics(windows, need = {}) {
  const text = flat((windows || []).map(window => window.text).join(' '));
  const numericCount = (text.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:%|percent(?:age)?|million|billion|thousand)\b/gi) || []).length;
  const yearCount = (text.match(/\b(?:19|20)\d{2}\b/g) || []).length;
  const field = found => found ? 'FOUND' : 'MISSING';
  return Object.freeze({ fields: Object.freeze({ metric: field(/\b(?:number|share|percentage|total|business|firm|establishment)\b/i.test(text)), value: field(numericCount > 0),
    unit: field(/%|percent(?:age)?|million|billion|thousand/i.test(text)), population: field(/\b(?:business|businesses|firm|firms|establishment|establishments|employer|nonemployer)\b/i.test(text)),
    denominator: 'MISSING', period: field(yearCount > 0), geography: field(/\b(?:U\.?S\.?|United States)\b/i.test(text)), approximation: field(/\b(?:about|approximately|nearly|more than|less than|at least|up to)\b/i.test(text)) }),
  windowCount: (windows || []).length, blockTypes: Object.freeze([...new Set((windows || []).flatMap(window => window.blockTypes || []))]), candidateNumericCount: numericCount,
  candidateYearCount: yearCount, passageCombinationAttempted: (windows || []).some(window => (window.blockTypes || []).length > 1),
  passageCombinationResult: completeMaterialPassage(text, {}, need) ? 'COMPLETE' : 'INCOMPLETE' });
}

function verifyParserCandidates(payload, windows, need = {}, source = {}) {
  const registry = new Map((windows || []).map(window => [window.id, window])); const verified = []; const failures = [];
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates.slice(0, 5) : []; const names = ['metric', 'value', 'unit', 'population', 'denominator', 'period', 'geography', 'approximation'];
  for (const candidate of candidates) {
    if (candidate?.status !== 'COMPLETE' || candidate.derivationType !== 'DIRECT_SOURCE_STATEMENT') { failures.push('EXTRACTION_NO_COMPLETE_PROPOSITION'); continue; }
    const values = { metric: candidate.metric, value: candidate.value, unit: candidate.unit, population: candidate.population, denominator: candidate.denominator, period: candidate.period, geography: candidate.geography, approximation: candidate.approximation };
    const support = candidate.support || {}; let invalid = false; const used = new Set();
    for (const name of names) {
      const ids = Array.isArray(support[`${name}WindowIds`]) ? support[`${name}WindowIds`] : [];
      if (values[name] !== null && values[name] !== '' && !ids.length) { failures.push(`EXTRACTION_${name.toUpperCase()}_SUPPORT_MISSING`); invalid = true; continue; }
      if (ids.some(id => !registry.has(id))) { failures.push('EXTRACTION_SUPPORT_ID_INVALID'); invalid = true; continue; }
      ids.forEach(id => used.add(id)); const supportText = flat(ids.map(id => registry.get(id).text).join(' ')); const value = flat(values[name]); if (!value) continue;
      const stemmedSupport = (haystack, needle, ignored = []) => {
        const stem = token => token.endsWith('sses') ? token.slice(0, -2) : token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token; const excluded = new Set(ignored);
        const expected = (needle.toLowerCase().match(/[a-z0-9]+/g) || []).map(stem).filter(token => token.length > 2 && !excluded.has(token));
        const actual = new Set((haystack.toLowerCase().match(/[a-z0-9]+/g) || []).map(stem)); return expected.length > 0 && expected.every(token => actual.has(token));
      };
      const supported = name === 'unit' ? (value === 'percent' ? /%|percent(?:age)?/i.test(supportText) : new RegExp(`\\b${value}\\b`, 'i').test(supportText))
        : name === 'value' ? new RegExp(`(?:^|[^0-9])${value.replace(/,/g, '').replace('.', '\\.')}(?=$|[^0-9])`).test(supportText.replace(/,/g, ''))
          : name === 'approximation' ? new RegExp(`\\b${value.replace(/\s+/g, '\\s+')}\\b`, 'i').test(supportText)
            : name === 'metric' ? stemmedSupport(supportText, value, ['number', 'count', 'total', 'share', 'percentage', 'percent', 'of', 'the', 'that', 'were'])
              : name === 'population' ? stemmedSupport(supportText, value) : containsMaterial(supportText, value);
      if (!supported) { failures.push(`EXTRACTION_${name.toUpperCase()}_UNSUPPORTED`); invalid = true; }
    }
    if (used.size > 2) { failures.push('EXTRACTION_SUPPORT_TOO_DIFFUSE'); invalid = true; }
    const selected = [...used].map(id => registry.get(id)); const combined = flat(selected.map(window => window.text).join(' '));
    if (!selected.length || combined.length > EXTRACTION_LIMITS.persistedPassageCharacters) { failures.push('EXTRACTION_PASSAGE_TOO_LARGE'); invalid = true; }
    for (const mandatory of ['metric', 'value', 'unit', 'population', 'period', 'geography']) if (!flat(values[mandatory])) { failures.push(`EXTRACTION_${mandatory.toUpperCase()}_MISSING`); invalid = true; }
    const sourceApproximation = ['about', 'approximately', 'nearly', 'more than', 'less than', 'at least', 'up to'].find(value => combined.toLowerCase().includes(value));
    if (sourceApproximation && flat(values.approximation).toLowerCase() !== sourceApproximation) { failures.push('EXTRACTION_APPROXIMATION_UNSUPPORTED'); invalid = true; }
    if (invalid) continue;
    const passageNumber = id => selected.findIndex(window => window.id === id) + 1; const supportMap = {};
    for (const name of names) supportMap[name] = (support[`${name}WindowIds`] || []).map(passageNumber).filter(Boolean)[0] || 0;
    verified.push(Object.freeze({ propositionText: combined, metric: flat(candidate.metric), numericValue: flat(candidate.value).replace(/,/g, ''), numericUnit: flat(candidate.unit), population: flat(candidate.population), denominator: flat(candidate.denominator), period: flat(candidate.period), geography: flat(candidate.geography), approximation: flat(candidate.approximation).toLowerCase(), sourceRegistryKey: flat(source.sourceKey), derivationType: 'DIRECT_SOURCE_STATEMENT', sourcePassages: Object.freeze(selected.map((window, index) => Object.freeze({ passage: index + 1, type: (window.blockTypes || []).join('+') || 'UNKNOWN_TEXT' }))), supportMap: Object.freeze(supportMap), parserVerified: true }));
  }
  return Object.freeze({ candidates: Object.freeze(verified), failures: Object.freeze([...new Set(failures)]) });
}

function deriveEvidencePropositions(passage, need = {}, source = {}) {
  if (need.claimType !== 'current_statistic') return Object.freeze([]);
  const passages = Array.isArray(passage) ? passage.map((item, index) => ({ passage: index + 1, type: item.type || 'UNKNOWN_TEXT', text: flat(item.text) })) : [{ passage: 1, type: 'UNKNOWN_TEXT', text: flat(passage) }];
  const context = flat(passages.map(item => item.text).join(' '));
  const sentences = passages.flatMap(item => item.text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(flat).filter(Boolean).map(text => ({ ...item, text })));
  const derived = [];
  for (const sentenceEntry of sentences) {
    const sentence = sentenceEntry.text;
    const numeric = sentence.match(/\b(about|approximately|nearly|more than|less than|at least|up to)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|percent(?:age)?|million|billion|thousand)(?!\w)/i);
    const period = context.match(/\b((?:19|20)\d{2})\b/);
    if (!numeric || !period || !/\b(?:business|businesses|firm|firms|establishment|establishments|employer|nonemployer)\b/i.test(context)) continue;
    const approximation = flat(numeric[1]).toLowerCase(); const rawUnit = numeric[3].toLowerCase(); const unit = /%|percent/.test(rawUnit) ? 'percent' : rawUnit;
    const geography = /\b(?:U\.?S\.?|United States)\b/i.test(context) ? 'United States' : '';
    if (!geography) continue;
    let population = '';
    const afterNumeric = sentence.slice((numeric.index || 0) + numeric[0].length);
    const percentPopulation = afterNumeric.match(/^\s+of\s+(?:all\s+)?((?:U\.?S\.?\s+|United States\s+)?(?:small\s+)?(?:employer\s+|nonemployer\s+)?(?:businesses|firms|establishments))/i);
    if (percentPopulation) population = flat(percentPopulation[1]);
    if (!population) {
      const match = context.match(/\b((?:U\.?S\.?\s+|United States\s+)?(?:small\s+)?(?:employer\s+|nonemployer\s+)?(?:businesses|firms|establishments))\b/i);
      population = flat(match?.[1]);
    }
    if (!population) continue;
    const subject = /small business/i.test(context) ? 'small businesses' : population;
    const metric = unit === 'percent' ? `share of ${population} that were ${subject}` : `number of ${subject}`;
    const supportPassage = value => passages.find(item => containsMaterial(item.text, value))?.passage || 0;
    const supportMap = Object.freeze({ metric: supportPassage(population) || sentenceEntry.passage, value: sentenceEntry.passage, unit: sentenceEntry.passage,
      population: supportPassage(population), period: supportPassage(period[1]), geography: passages.find(item => /\b(?:U\.?S\.?|United States)\b/i.test(item.text))?.passage || 0,
      approximation: approximation ? sentenceEntry.passage : 0 });
    if (Object.entries(supportMap).some(([key, value]) => key !== 'approximation' && !value)) continue;
    derived.push(Object.freeze({ propositionText: context, metric, numericValue: numeric[2].replace(/,/g, ''), numericUnit: unit, population, denominator: '',
      period: period[1], geography, approximation, sourceRegistryKey: flat(source.sourceKey), derivationType: passages.length > 1 ? 'BOUNDED_MULTI_PASSAGE' : 'DIRECT_SOURCE_STATEMENT',
      sourcePassages: Object.freeze(passages.map(item => Object.freeze({ passage: item.passage, type: item.type }))), supportMap }));
  }
  return Object.freeze(derived.filter((item, index, all) => all.findIndex(other => other.numericValue === item.numericValue && other.metric === item.metric && other.period === item.period) === index).slice(0, 5));
}

function validateExtractionIdentity(requestedUrl, returnedUrl) {
  const requested = canonicalExtractionUrl(requestedUrl); const returned = canonicalExtractionUrl(returnedUrl);
  if (!requested || !returned || requested !== returned) {
    const error = new Error('The extraction result could not be bound to the registered source.'); error.code = 'EXTRACTION_SOURCE_MISMATCH'; throw error;
  }
  return Object.freeze({ requestedUrl: requested, returnedUrl: returned });
}

function buildGroundingResult({ source, need, extraction, limits = EXTRACTION_LIMITS }) {
  const identity = validateExtractionIdentity(source.canonicalUrl, extraction.returnedUrl);
  const normalizedText = normalizeExtractedText(extraction.normalizedText, limits.normalizedTextCharacters);
  if (!normalizedText) { const error = new Error('The extraction provider returned no usable source content.'); error.code = 'EXTRACTION_RESPONSE_INVALID'; throw error; }
  const windows = candidateWindows(normalizedText, need, source, limits); const passages = groundedPassages(windows, need, source, limits);
  const passage = passages.map(item => item.text).join(' ');
  if (!passage || passage.length > limits.persistedPassageCharacters || passages.length > limits.persistedPassages) {
    const error = new Error('The source did not yield a bounded evidence passage.'); error.code = 'EXTRACTION_GROUNDING_INSUFFICIENT'; throw error;
  }
  const evidenceDerivedPropositions = deriveEvidencePropositions(passages, need, source);
  return Object.freeze({ ...identity, title: flat(extraction.title), contentType: flat(extraction.contentType), retrievedAt: flat(extraction.retrievedAt),
    cacheStatus: flat(extraction.cacheStatus) || 'unknown', freshnessPolicy: flat(extraction.freshnessPolicy) || 'unknown', retrievalStatus: flat(extraction.retrievalStatus) || 'success',
    retrievalProvider: flat(extraction.provider), normalizedCharacterCount: normalizedText.length, passage,
    passageHash: hash(passage), contentHash: hash(normalizedText), windowLocations: Object.freeze(passages.map(item => item.index)),
    structuralBlockCount: structuralBlocks(normalizedText, limits).length, candidateWindowCount: windows.length,
    groundingStatus: 'grounded', evidenceDerivedPropositions, usage: Object.freeze({ ...(extraction.usage || {}) }) });
}

function createDeterministicExtractionAdapter({ results = {}, errors = {} } = {}) {
  const operations = [];
  return Object.freeze({ provider: 'deterministic_extraction', async retrieveSource(request) {
    const key = request?.sourceRegistryKey;
    if (!key || request.canonicalUrl !== request.registeredCanonicalUrl) { const error = new Error('An exact registered source URL is required.'); error.code = 'EXTRACTION_SOURCE_MISMATCH'; throw error; }
    if (errors[key]) { operations.push({ operation: 'source_extraction', sourceKey: key, outcome: errors[key], units: 0 }); const error = new Error('Fixture extraction failed.'); error.code = errors[key]; throw error; }
    const result = results[key]; operations.push({ operation: 'source_extraction', sourceKey: key, outcome: result ? 'completed' : 'EXTRACTION_PROVIDER_UNAVAILABLE', units: result ? 1 : 0,
      metadata: result ? { pageCount: 1, durationMs: result.durationMs || 1, cacheStatus: result.cacheStatus || 'fresh', estimatedCostUsd: result.estimatedCostUsd ?? 0 } : undefined });
    if (!result) { const error = new Error('Fixture extraction unavailable.'); error.code = 'EXTRACTION_PROVIDER_UNAVAILABLE'; throw error; }
    return Object.freeze({ provider: 'deterministic_extraction', requestedUrl: request.canonicalUrl, returnedUrl: result.returnedUrl || request.canonicalUrl,
      title: result.title || '', contentType: result.contentType || 'text/html', retrievalStatus: result.retrievalStatus || 'success',
      cacheStatus: result.cacheStatus || 'fresh', freshnessPolicy: result.freshnessPolicy || 'fresh', retrievedAt: result.retrievedAt || '2026-09-28T12:00:00.000Z', normalizedText: result.normalizedText || '', providerMetadata: {},
      usage: Object.freeze({ requestCount: 1, pageCount: 1, durationMs: result.durationMs || 1, estimatedCostUsd: result.estimatedCostUsd ?? 0 }) });
  }, operations: () => Object.freeze(operations.map(item => Object.freeze({ ...item }))) });
}

module.exports = { EXTRACTION_LIMITS, buildGroundingResult, candidateWindows, canonicalExtractionUrl, completeMaterialPassage, createDeterministicExtractionAdapter, deriveEvidencePropositions, extractionAnchors, extractionDiagnostics, groundedPassages, hash, normalizeExtractedText, parserWindows, plausibleNumericStatement, structuralBlocks, validateExtractionIdentity, verifyParserCandidates };
