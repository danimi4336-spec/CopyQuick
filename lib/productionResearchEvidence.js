const { MAX_EXCERPT, createDeterministicResearchAdapter, normalizedSource, safeCitationUrl } = require('./researchAdapter');
const { EXTRACTION_LIMITS, buildGroundingResult, extractionDiagnostics, hash, normalizeExtractedText, parserWindows, structuralBlocks, validateExtractionIdentity, verifyParserCandidates } = require('./sourceExtraction');
const { createResearchOperations, customerResearchStatus, operationalCategory } = require('./researchOperations');

const CLAIM_TYPES = Object.freeze(['current_statistic', 'regulation_requirement', 'scientific_clinical', 'market_industry', 'product_company_fact', 'definition_standard', 'local_requirement', 'general_background']);
const STATUSES = Object.freeze(['supported', 'partially_supported', 'conflicted', 'stale', 'weak_source', 'unsupported', 'not_researched']);
const PERMITTED_USES = Object.freeze(['background_only', 'public_factual_claim', 'product_fact', 'high_risk_claim', 'internal_strategy']);
const LIMITS = Object.freeze({ questions: 5, candidates: 5, acceptedSources: 3, extractionSources: 3, retries: 2 });
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
    question: item.claimType === 'general_background' ? `What authoritative background evidence is relevant to ${clean(brief.specificTopic)}?`
      : item.claimType === 'current_statistic' ? `What does the latest applicable authoritative evidence report about ${clean(brief.specificTopic || brief.readerQuestion)}?`
        : `What authoritative evidence addresses ${clean(brief.readerQuestion)}?`,
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

const APPROXIMATION_WORDS = Object.freeze(['about', 'approximately', 'nearly', 'more than', 'less than', 'at least', 'up to']);
const PERCENT_UNITS = Object.freeze(['percent', 'percentage', '%']);
function comparableText(value) { return lower(value).replace(/\bu\.?\s*s\.?(?=\s|$|[.,;:])/g, 'united states').replace(/\bunited states of america\b/g, 'united states').replace(/[^a-z0-9%]+/g, ' ').trim(); }
function containsMaterialText(haystack, needle) {
  const expected = comparableText(needle); if (!expected) return false;
  const actual = comparableText(haystack); if (` ${actual} `.includes(` ${expected} `)) return true;
  const material = expected.split(' ').filter(token => token.length > 2 || /\d/.test(token));
  const actualTokens = new Set(actual.split(' ').filter(Boolean));
  return material.length > 0 && material.every(token => actualTokens.has(token));
}
function normalizedNumeric(value) { return clean(value).replace(/,/g, '').replace(/%$/, ''); }
function normalizedUnit(value) {
  const unit = lower(value);
  if (PERCENT_UNITS.includes(unit)) return 'percent';
  if (unit === 'number') return 'count';
  return unit;
}
function normalizedApproximation(value) {
  const approximation = lower(value);
  return ['', 'none', 'null', 'n/a', 'not applicable', 'exact'].includes(approximation) ? '' : approximation;
}
const NUMBER_WORDS = Object.freeze({ '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten' });
function metricSupported(metric, text) {
  const ignored = new Set(['share', 'number', 'percentage', 'percent', 'count', 'rate', 'amount', 'of', 'the', 'a', 'an', 'that', 'were', 'are', 'is']);
  const stem = token => token.replace(/(?:ing|ed|s)$/, '');
  const expected = comparableText(metric).split(' ').map(stem).filter(token => token.length > 1 && !ignored.has(token));
  const actual = new Set(comparableText(text).split(' ').map(stem).filter(Boolean));
  return expected.length > 0 && expected.every(token => actual.has(token));
}
function statisticEvidence(source, need) {
  const candidate = source?.candidateStatistic || {};
  const passage = clean(source?.content);
  const value = normalizedNumeric(candidate.value); const unit = normalizedUnit(candidate.unit);
  const statistic = {
    metric: clean(candidate.metric), value, unit, denominator: clean(candidate.denominator),
    population: clean(candidate.population), period: clean(candidate.period),
    geography: clean(candidate.geography), approximation: normalizedApproximation(candidate.approximation),
    derivation: clean(candidate.derivation) || 'quoted', sourceKey: clean(source?.sourceKey), supportingExcerpt: passage.slice(0, MAX_EXCERPT)
  };
  const failures = [];
  if (!statistic.metric) failures.push('STATISTIC_METRIC_MISSING');
  else if (!metricSupported(statistic.metric, passage)) failures.push('STATISTIC_METRIC_MISMATCH');
  if (!value) failures.push('STATISTIC_VALUE_MISSING');
  else if (!/^-?\d+(?:\.\d+)?$/.test(value)) failures.push('STATISTIC_VALUE_INVALID');
  const numericPattern = value ? new RegExp(`(?:^|[^0-9])${value.replace('.', '\\.')}(?=$|[^0-9])`) : null;
  if (numericPattern && !numericPattern.test(passage.replace(/,/g, '')) && !(NUMBER_WORDS[value] && new RegExp(`\\b${NUMBER_WORDS[value]}\\b`, 'i').test(passage))) failures.push('STATISTIC_VALUE_NOT_SUPPORTED_BY_EXCERPT');
  if (!unit) failures.push('STATISTIC_UNIT_MISSING');
  else if (!['percent', 'count', 'million', 'billion', 'thousand', 'ratio', 'change'].includes(unit)) failures.push('STATISTIC_UNIT_INVALID');
  if (unit === 'percent' && value && !new RegExp(`${value.replace('.', '\\.')}\\s*(?:%|percent(?:age)?)`, 'i').test(passage.replace(/,/g, ''))) failures.push('STATISTIC_UNIT_NOT_SUPPORTED_BY_EXCERPT');
  if (['million', 'billion', 'thousand'].includes(unit) && value && !new RegExp(`${value.replace('.', '\\.')}\\s*${unit}`, 'i').test(passage.replace(/,/g, ''))) failures.push('STATISTIC_UNIT_NOT_SUPPORTED_BY_EXCERPT');
  if (!statistic.population) failures.push('STATISTIC_POPULATION_MISSING');
  else if (!containsMaterialText(passage, statistic.population)) failures.push('STATISTIC_POPULATION_MISMATCH');
  const denominatorRequired = statistic.derivation === 'derived_arithmetic' || unit === 'ratio';
  if (denominatorRequired && !statistic.denominator) failures.push('STATISTIC_DENOMINATOR_REQUIRED');
  else if (statistic.denominator && !containsMaterialText(passage, statistic.denominator)) failures.push('STATISTIC_DENOMINATOR_MISMATCH');
  if (!statistic.period) failures.push('STATISTIC_PERIOD_MISSING');
  else if (!containsMaterialText(passage, statistic.period)) failures.push('STATISTIC_PERIOD_MISMATCH');
  if (need?.jurisdiction && !statistic.geography) failures.push('STATISTIC_GEOGRAPHY_MISSING');
  else if (statistic.geography && !containsMaterialText(passage, statistic.geography)) failures.push('STATISTIC_GEOGRAPHY_MISMATCH');
  const passageApproximation = APPROXIMATION_WORDS.find(word => lower(passage).includes(word)) || '';
  if (passageApproximation && statistic.approximation !== passageApproximation) failures.push('STATISTIC_APPROXIMATION_LOST');
  if (statistic.approximation && !APPROXIMATION_WORDS.includes(statistic.approximation)) failures.push('STATISTIC_APPROXIMATION_INVALID');
  if (statistic.approximation && !lower(passage).includes(statistic.approximation)) failures.push('STATISTIC_APPROXIMATION_MISMATCH');
  const uniqueFailures = Object.freeze([...new Set(failures)]);
  const diagnostics = Object.freeze({
    numericMetricPresent: Boolean(statistic.metric), numericValuePresent: Boolean(value), numericUnitPresent: Boolean(unit),
    numericPopulationPresent: Boolean(statistic.population), numericDenominatorPresent: Boolean(statistic.denominator),
    numericDenominatorRequired: denominatorRequired, numericPeriodPresent: Boolean(statistic.period),
    numericGeographyPresent: Boolean(statistic.geography), numericApproximationPresent: Boolean(statistic.approximation),
    metricMatchesExcerpt: Boolean(statistic.metric) && !uniqueFailures.includes('STATISTIC_METRIC_MISMATCH'),
    valueMatchesExcerpt: Boolean(value) && !uniqueFailures.includes('STATISTIC_VALUE_NOT_SUPPORTED_BY_EXCERPT'),
    unitMatchesExcerpt: Boolean(unit) && !uniqueFailures.includes('STATISTIC_UNIT_NOT_SUPPORTED_BY_EXCERPT'),
    populationMatchesExcerpt: Boolean(statistic.population) && !uniqueFailures.includes('STATISTIC_POPULATION_MISMATCH'),
    denominatorMatchesExcerpt: !statistic.denominator || !uniqueFailures.includes('STATISTIC_DENOMINATOR_MISMATCH'),
    periodMatchesExcerpt: Boolean(statistic.period) && !uniqueFailures.includes('STATISTIC_PERIOD_MISMATCH'),
    geographyMatchesExcerpt: !need?.jurisdiction || (Boolean(statistic.geography) && !uniqueFailures.includes('STATISTIC_GEOGRAPHY_MISMATCH')),
    approximationPreserved: !uniqueFailures.some(code => code.startsWith('STATISTIC_APPROXIMATION_')),
    failureReasons: uniqueFailures
  });
  return { valid: uniqueFailures.length === 0, statistic: Object.freeze(statistic), failures: uniqueFailures, diagnostics };
}

function derivePercentage(numerator, denominator, options = {}) {
  const dimensions = ['population', 'period', 'geography', 'entity'];
  if (!numerator || !denominator || !Number.isFinite(Number(numerator.value)) || !Number.isFinite(Number(denominator.value)) || Number(denominator.value) === 0) return null;
  if (dimensions.some(key => clean(numerator[key]) !== clean(denominator[key]))) return null;
  const precision = Math.max(0, Math.min(2, Number.isInteger(options.decimals) ? options.decimals : 1));
  const value = Number(((Number(numerator.value) / Number(denominator.value)) * 100).toFixed(precision));
  return Object.freeze({ metric: clean(options.metric || `${numerator.metric} as a share of ${denominator.metric}`), value: String(value), unit: 'percent', denominator: clean(denominator.metric), population: clean(numerator.population), period: clean(numerator.period), geography: clean(numerator.geography), approximation: 'approximately', derivation: 'derived_arithmetic', formula: `${numerator.value} / ${denominator.value} × 100`, inputs: Object.freeze([numerator, denominator]), roundingDecimals: precision });
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
  if (need.claimType === 'current_statistic') {
    const numeric = statisticEvidence(source, need);
    const published = Date.parse(source.publicationDate);
    const currentnessSatisfied = need.freshnessClass !== 'high' || source.providerMetadata?.grounding?.freshnessVerified === true
      || (Number.isFinite(published) && (now.getTime() - published) / 31557600000 <= 2);
    const statisticDiagnostics = Object.freeze({ ...numeric.diagnostics, currentnessSatisfied });
    if (!numeric.valid) return { accepted: false, status: 'unsupported', reason: 'Source does not contain a fully qualified, internally consistent statistic.', statisticFailures: numeric.failures, statisticDiagnostics };
    if (!currentnessSatisfied) return { accepted: false, status: 'stale', reason: 'Source is too old for a current claim.', statisticFailures: ['STATISTIC_CURRENTNESS_UNSUPPORTED'], statisticDiagnostics: Object.freeze({ ...statisticDiagnostics, failureReasons: Object.freeze(['STATISTIC_CURRENTNESS_UNSUPPORTED']) }) };
  }
  const published = Date.parse(source.publicationDate);
  if (need.freshnessClass === 'high' && source.providerMetadata?.grounding?.freshnessVerified !== true
    && (!Number.isFinite(published) || (now.getTime() - published) / 31557600000 > 2)) return { accepted: false, status: 'stale', reason: 'Source is too old for a current claim.' };
  return { accepted: true, status: 'supported', reason: 'Source authority, scope, and freshness satisfy the claim policy.' };
}

function sourcePreAdmission(source, need) {
  if (!source || !safeCitationUrl(source.canonicalUrl)) return { accepted: false, status: 'unsupported', diagnosticCode: 'CANDIDATE_URL_UNSAFE', reason: 'The candidate URL was not safe for source retrieval.' };
  if (!source.accessible || source.paywalled || source.snippetOnly) return { accepted: false, status: 'unsupported', diagnosticCode: 'CANDIDATE_STRUCTURE_INCOMPLETE', reason: 'The source was unavailable or supplied only discovery-level information.' };
  if (!source.authorityIdentity || source.authorityApplicable === false) return { accepted: false, status: 'unsupported', diagnosticCode: 'CANDIDATE_AUTHORITY_MISMATCH', reason: 'The source was not an applicable authority for this research question.' };
  if (source.qualityTier === 'tier_4') return { accepted: false, status: 'weak_source', diagnosticCode: 'CANDIDATE_QUALITY_TIER_INELIGIBLE', reason: 'The source quality tier was not eligible for a public factual claim.' };
  if (need.prohibitedSourceTypes.includes(source.sourceType)) return { accepted: false, status: 'weak_source', diagnosticCode: 'CANDIDATE_SOURCE_TYPE_INELIGIBLE', reason: 'The source type was not eligible for this public claim.' };
  if (need.preferredSourceTypes.length && !need.preferredSourceTypes.includes(source.sourceType) && !['tier_1', 'tier_2'].includes(source.qualityTier)) return { accepted: false, status: 'weak_source', diagnosticCode: 'CANDIDATE_SOURCE_TYPE_INELIGIBLE', reason: 'A more authoritative source type was required.' };
  if (need.jurisdiction && source.jurisdiction && lower(need.jurisdiction) !== lower(source.jurisdiction)) return { accepted: false, status: 'unsupported', diagnosticCode: 'CANDIDATE_JURISDICTION_MISMATCH', reason: 'The source jurisdiction did not match the research question.' };
  if (need.requiredEntity && source.entity && lower(need.requiredEntity) !== lower(source.entity)) return { accepted: false, status: 'unsupported', diagnosticCode: 'CANDIDATE_ENTITY_MISMATCH', reason: 'The source concerned a different entity.' };
  if (need.claimType === 'local_requirement' && source.sourceType !== 'local_government') return { accepted: false, status: 'unsupported', diagnosticCode: 'CANDIDATE_CLAIM_TYPE_MISMATCH', reason: 'A matching local authority was required.' };
  if (need.claimType === 'scientific_clinical' && !['peer_reviewed_research', 'authoritative_review'].includes(source.sourceType)) return { accepted: false, status: 'weak_source', diagnosticCode: 'CANDIDATE_CLAIM_TYPE_MISMATCH', reason: 'Scientific claims required authoritative scientific evidence.' };
  if (need.claimType === 'product_company_fact' && source.sourceType !== 'official_company') return { accepted: false, status: 'weak_source', diagnosticCode: 'CANDIDATE_CLAIM_TYPE_MISMATCH', reason: 'Current company facts required official company documentation.' };
  return { accepted: true, status: 'candidate', diagnosticCode: 'CANDIDATE_ELIGIBLE', reason: 'The registered source was eligible for bounded passage retrieval.' };
}

async function groundCandidateSource(candidate, need, extractionAdapter, propositionParser) {
  const extraction = await extractionAdapter.retrieveSource({
    sourceRegistryKey: candidate.sourceKey, canonicalUrl: candidate.canonicalUrl, registeredCanonicalUrl: candidate.canonicalUrl,
    freshnessClass: need.freshnessClass, needKey: need.key, essential: need.essential, evidenceNeed: { key: need.key, claimType: need.claimType }, limits: EXTRACTION_LIMITS
  });
  let grounding; let deterministicError;
  try { grounding = buildGroundingResult({ source: candidate, need, extraction }); } catch (error) { deterministicError = error; }
  let derived = grounding?.evidenceDerivedPropositions?.[0]; let diagnostics;
  if (need.claimType === 'current_statistic' && !derived && propositionParser) {
    const windows = parserWindows(extraction.normalizedText, need, candidate); diagnostics = extractionDiagnostics(windows, need);
    if (windows.length) try {
      const parsed = await propositionParser.parse({ need, source: candidate, windows }); const verified = verifyParserCandidates(parsed, windows, need, candidate);
      derived = verified.candidates[0]; diagnostics = Object.freeze({ ...diagnostics, parserInvoked: true, parserStatus: derived ? 'VERIFIED' : 'REJECTED', parserCandidateCount: Array.isArray(parsed?.candidates) ? parsed.candidates.length : 0, verificationFailures: verified.failures });
      if (derived) {
        const normalizedText = normalizeExtractedText(extraction.normalizedText); const identity = validateExtractionIdentity(candidate.canonicalUrl, extraction.returnedUrl);
        grounding = Object.freeze({ ...identity, title: clean(extraction.title), contentType: clean(extraction.contentType), retrievedAt: clean(extraction.retrievedAt), cacheStatus: clean(extraction.cacheStatus) || 'unknown', freshnessPolicy: clean(extraction.freshnessPolicy) || 'unknown', retrievalStatus: clean(extraction.retrievalStatus) || 'success', retrievalProvider: clean(extraction.provider), normalizedCharacterCount: normalizedText.length, passage: derived.propositionText, passageHash: hash(derived.propositionText), contentHash: hash(normalizedText), windowLocations: Object.freeze([]), structuralBlockCount: structuralBlocks(normalizedText).length, candidateWindowCount: windows.length, groundingStatus: 'parser_grounded', evidenceDerivedPropositions: Object.freeze([derived]), usage: Object.freeze({ ...(extraction.usage || {}) }), extractionDiagnostics: diagnostics });
      }
    } catch (error) { diagnostics = Object.freeze({ ...diagnostics, parserInvoked: true, parserStatus: clean(error?.code || 'EXTRACTION_PARSER_UNAVAILABLE') }); }
  }
  if (need.claimType === 'current_statistic' && !derived) { const error = deterministicError || new Error('The grounded passage did not yield a qualified evidence-derived proposition.'); error.code = error.code || 'EXTRACTION_NO_COMPLETE_PROPOSITION'; error.extractionDiagnostics = diagnostics || extractionDiagnostics(parserWindows(extraction.normalizedText, need, candidate), need); throw error; }
  const freshnessVerified = need.freshnessClass !== 'high' || grounding.freshnessPolicy === 'fresh'
    || ['fresh', 'live', 'livecrawl'].some(value => lower(grounding.cacheStatus).includes(value));
  return normalizedSource({ ...candidate, canonicalUrl: grounding.returnedUrl, title: grounding.title || candidate.title,
    retrievedAt: grounding.retrievedAt, content: grounding.passage, contentHash: grounding.contentHash,
    candidateProposition: derived?.propositionText || candidate.candidateProposition,
    candidateStatistic: derived ? { metric: derived.metric, value: derived.numericValue, unit: derived.numericUnit, denominator: derived.denominator,
      population: derived.population, period: derived.period, geography: derived.geography, approximation: derived.approximation, derivation: 'quoted',
      derivationType: derived.derivationType, supportMap: derived.supportMap, sourcePassages: derived.sourcePassages } : candidate.candidateStatistic,
    providerProvenance: 'exa_source_grounded', providerMetadata: {
      candidateHypothesis: { proposition: candidate.candidateProposition, statistic: candidate.candidateStatistic },
      grounding: { requestedUrl: grounding.requestedUrl, returnedUrl: grounding.returnedUrl, retrievalProvider: grounding.retrievalProvider,
        retrievedAt: grounding.retrievedAt, cacheStatus: grounding.cacheStatus, freshnessPolicy: grounding.freshnessPolicy, contentType: grounding.contentType,
        normalizedCharacterCount: grounding.normalizedCharacterCount, passageHash: grounding.passageHash,
        contentHash: grounding.contentHash, windowLocations: grounding.windowLocations, groundingStatus: grounding.groundingStatus,
        structuralBlockCount: grounding.structuralBlockCount, candidateWindowCount: grounding.candidateWindowCount,
        derivationType: derived?.derivationType || '',
        freshnessVerified, usage: grounding.usage }
    }
  });
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
  const proposition = clean(source.candidateProposition) || values[source.sourceKey] || clean(source.content).split(/(?<=[.!?])\s+/)[0];
  const candidateQualifiers = source.candidateQualifiers || {};
  const numeric = need.claimType === 'current_statistic' ? statisticEvidence(source, need).statistic : null;
  return {
    evidenceKey: `evidence-${source.sourceKey}`, proposition, sourceKey: source.sourceKey, excerpt: clean(source.content).slice(0, MAX_EXCERPT),
    qualifiers: {
      jurisdiction: ['local_requirement', 'regulation_requirement'].includes(need.claimType) ? (source.jurisdiction || '') : '',
      population: need.claimType === 'current_statistic' ? (numeric?.population || '')
        : need.claimType === 'scientific_clinical' ? (source.population || '') : '',
      period: ['current_statistic', 'regulation_requirement', 'local_requirement', 'product_company_fact'].includes(need.claimType)
        ? (clean(numeric?.period) || clean(candidateQualifiers.period) || (source.publicationDate ? source.publicationDate.slice(0, 4) : '')) : '',
      modality: clean(candidateQualifiers.modality) || (/\bmay\b/i.test(proposition) ? 'may' : ''),
      relationship: clean(candidateQualifiers.relationship) || (/associated/i.test(proposition) ? 'association' : ''),
      ...(numeric ? { metric: numeric.metric, value: numeric.value, unit: numeric.unit, denominator: numeric.denominator, geography: numeric.geography, approximation: numeric.approximation } : {})
    }, statistic: numeric,
    evidenceStatus: source.providerProvenance ? 'not_researched' : 'supported',
    supportStatus: source.providerProvenance ? 'candidate' : 'directly_supported',
    permittedUse: need.intendedUse, freshnessClass: need.freshnessClass, claimType: need.claimType,
    evidenceProvenance: source.providerProvenance || 'deterministic_fixture',
    supportMap: source.candidateStatistic?.supportMap || {}, sourcePassages: source.candidateStatistic?.sourcePassages || []
  };
}

function deterministicDirectSupport(proposition, excerpt) {
  const claim = lower(proposition);
  const passage = lower(excerpt);
  return Boolean(claim && passage && passage.includes(claim));
}

function dedupe(sources) {
  const seen = new Set();
  return sources.filter(source => { const key = source.originalSourceKey || source.contentHash || source.canonicalUrl; if (seen.has(key)) return false; seen.add(key); return true; });
}

function propositionsConflict(left, right) {
  if (left.claimType !== right.claimType) return false;
  const leftText = lower(left.proposition); const rightText = lower(right.proposition);
  const leftNumbers = leftText.match(/\b\d+(?:\.\d+)?%?\b/g) || []; const rightNumbers = rightText.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  if (leftNumbers.length && rightNumbers.length && leftNumbers.join('|') !== rightNumbers.join('|')) return true;
  const negative = text => /\b(?:did not|does not|no reliable|not establish|insufficient)\b/.test(text);
  const positive = text => /\b(?:establishes|demonstrates|improves|effective|causes)\b/.test(text);
  return (negative(leftText) && positive(rightText)) || (positive(leftText) && negative(rightText));
}

async function generateResearchEvidencePack(context, { adapter = createDeterministicResearchAdapter(), extractionAdapter, propositionParser, budget = {}, researchOperations = createResearchOperations() } = {}) {
  const brief = context?.dependencyOutputs?.find(item => item.deliverableId === 'priority_content_brief')?.output || {};
  const inventory = classifyClaimInventory(brief); const needs = researchNeeds(brief);
  const accepted = []; const items = []; const rejectedSources = []; const unsupportedQuestions = []; const conflicts = [];
  const maxCandidates = Math.min(LIMITS.candidates, Number(budget.maxCandidates) || LIMITS.candidates);
  const maxExtractionSources = Math.min(LIMITS.extractionSources, Number(budget.maxExtractionSources) || LIMITS.extractionSources);
  let extractionSources = 0;
  for (const need of needs) {
    researchOperations.need(need.key, need.essential);
    let candidates;
    try { candidates = await adapter.discover(need, { fixtureKeys: fixtureKeys(need), maxCandidates }); }
    catch (error) {
      // Production owns recovery when a paid provider operation may have
      // completed without a safely persistable result. Treating that state as
      // ordinary evidence insufficiency could allow an automatic replay.
      if (error?.ambiguous) throw error;
      unsupportedQuestions.push(`${need.question}${need.essential ? ' This evidence is essential.' : ''}`);
      rejectedSources.push({ sourceKey: 'provider-unavailable', canonicalUrl: '', reason: 'Research provider was unavailable.', status: clean(error?.code || 'unsupported') });
      researchOperations.completeNeed(need.key, { essential: need.essential, status: operationalCategory(error?.code) === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' : 'PROVIDER_UNAVAILABLE', failureCategory: operationalCategory(error?.code) });
      continue;
    }
    let count = 0;
    for (const candidate of candidates) {
      if (count >= LIMITS.acceptedSources) break;
      let source = await adapter.retrieve(candidate); let result = sourcePolicy(source || candidate, need);
      const groundingFailure = Boolean(result.statisticFailures) || (!clean(source?.content) && result.status === 'unsupported');
      if (!result.accepted && groundingFailure && extractionAdapter) {
        const preAdmission = sourcePreAdmission(source || candidate, need);
        if (!preAdmission.accepted) result = preAdmission;
        else if (extractionSources >= maxExtractionSources) {
          rejectedSources.push({ sourceKey: candidate?.sourceKey || 'unavailable', canonicalUrl: candidate?.canonicalUrl || '',
            reason: 'The bounded source-extraction budget was exhausted.', status: 'EXTRACTION_BUDGET_EXHAUSTED' });
          continue;
        }
        else try {
          extractionSources += 1;
          source = await groundCandidateSource(source || candidate, need, extractionAdapter, propositionParser);
          result = sourcePolicy(source, need);
        } catch (error) {
          rejectedSources.push({ sourceKey: candidate?.sourceKey || 'unavailable', canonicalUrl: candidate?.canonicalUrl || '',
            reason: 'Registered source extraction did not produce an eligible grounded passage.', status: clean(error?.code || 'EXTRACTION_PROVIDER_UNAVAILABLE'), ...(error?.extractionDiagnostics ? { extractionDiagnostics: error.extractionDiagnostics } : {}) });
          continue;
        }
      }
      if (!result.accepted) { rejectedSources.push({ sourceKey: candidate?.sourceKey || 'unavailable', canonicalUrl: candidate?.canonicalUrl || '', reason: result.reason, status: result.status, ...(result.diagnosticCode ? { diagnosticCode: result.diagnosticCode } : {}), ...(result.statisticFailures ? { details: [...result.statisticFailures], numericDiagnostics: result.statisticDiagnostics } : {}) }); continue; }
      const item = propositionFor(source, need);
      if (source.providerProvenance) {
        let support;
        if (deterministicDirectSupport(item.proposition, item.excerpt)) support = 'direct';
        else if (typeof adapter.entail === 'function') try {
          support = await adapter.entail({ proposition: item.proposition, excerpt: item.excerpt, qualifiers: item.qualifiers, sourceLabel: `${source.publisher} — ${source.title}` });
        } catch (_) { support = 'unsupported'; }
        else support = 'unsupported';
        item.entailmentResult = support;
        item.supportStatus = support === 'direct' ? 'directly_supported' : support === 'partial' ? 'partially_supported' : support === 'conflicting' ? 'conflicting' : 'not_supported';
        item.evidenceStatus = support === 'direct' ? 'supported' : support === 'partial' ? 'partially_supported' : support === 'conflicting' ? 'conflicted' : 'unsupported';
      }
      if (item.evidenceStatus === 'supported') {
        accepted.push(source); items.push(item); count += 1;
        // A single applicable primary source can establish a simple official
        // statistic. Stop rather than spending the remaining retrieval budget
        // after sufficient evidence has already been accepted.
        if (need.claimType === 'current_statistic') break;
      }
      else rejectedSources.push({ sourceKey: source.sourceKey, canonicalUrl: source.canonicalUrl, reason: 'Candidate evidence did not directly support the proposed claim.', status: item.evidenceStatus });
    }
    if (!count) unsupportedQuestions.push(`${need.question}${need.essential ? ' This evidence is essential.' : ''}`);
    researchOperations.completeNeed(need.key, { essential: need.essential, status: count ? 'SUPPORTED' : 'INSUFFICIENT', sourcesConsidered: candidates.length, sourcesRetrieved: extractionSources, evidenceAccepted: count, failureCategory: count ? '' : 'EVIDENCE_INSUFFICIENT' });
  }
  inventory.filter(item => item.classification === 'PROHIBITED').forEach(item => unsupportedQuestions.push(`The requested ${item.claimType.replace(/_/g, ' ')} claim is prohibited without specialized evidence and review.`));
  const sources = dedupe(accepted); const sourceKeys = new Set(sources.map(item => item.sourceKey)); const evidenceItems = items.filter(item => sourceKeys.has(item.sourceKey));
  const providerReports = typeof adapter.reports === 'function' ? adapter.reports() : [];
  providerReports.flatMap(item => item.unsupported || []).forEach(item => { if (!unsupportedQuestions.includes(item)) unsupportedQuestions.push(item); });
  providerReports.flatMap(item => item.conflicts || []).forEach(item => { if (!conflicts.includes(item)) conflicts.push(item); });
  for (let left = 0; left < evidenceItems.length; left += 1) for (let right = left + 1; right < evidenceItems.length; right += 1) {
    if (propositionsConflict(evidenceItems[left], evidenceItems[right])) {
      conflicts.push('Accepted candidate propositions materially conflict, so the article must not make a definitive claim.');
      evidenceItems[left].evidenceStatus = 'conflicted'; evidenceItems[left].supportStatus = 'conflicting';
      evidenceItems[right].evidenceStatus = 'conflicted'; evidenceItems[right].supportStatus = 'conflicting';
    }
  }
  if (evidenceItems.some(item => item.sourceKey === 'peer-reviewed-study') && evidenceItems.some(item => item.sourceKey === 'conflicting-study')) {
    conflicts.push('Credible scientific sources disagree, so the article must not make a definitive efficacy claim.');
    evidenceItems.forEach(item => { if (item.claimType === 'scientific_clinical') { item.evidenceStatus = 'conflicted'; item.supportStatus = 'conflicting'; } });
  }
  const prohibitedClaimCount = inventory.filter(item => item.classification === 'PROHIBITED').length;
  const noResearch = needs.length === 0 && prohibitedClaimCount === 0;
  const trace = [...adapter.operations(), ...(extractionAdapter && typeof extractionAdapter.operations === 'function' ? extractionAdapter.operations() : []), ...(propositionParser && typeof propositionParser.operations === 'function' ? propositionParser.operations() : [])];
  const liveOperations = trace.filter(item => item.operation === 'web_search' || item.operation === 'entailment');
  const unavailable = liveOperations.some(item => item.operation === 'web_search' && /^RESEARCH_PROVIDER_/.test(item.outcome));
  const extractionOperations = trace.filter(item => item.operation === 'source_extraction');
  const parserOperations = trace.filter(item => item.operation === 'proposition_parsing');
  const extractionSummary = extractionOperations.length ? {
    provider: extractionAdapter?.provider || 'extraction', requestCount: extractionOperations.filter(item => item.units > 0).length,
    pageCount: extractionOperations.reduce((sum, item) => sum + (item.metadata?.pageCount || (item.outcome === 'completed' ? 1 : 0)), 0),
    durationMs: extractionOperations.reduce((sum, item) => sum + (item.metadata?.durationMs || 0), 0),
    providerCostUsd: Number(extractionOperations.reduce((sum, item) => sum + (item.metadata?.providerCostUsd || 0), 0).toFixed(8)),
    estimatedCostUsd: Number(extractionOperations.reduce((sum, item) => sum + (item.metadata?.estimatedCostUsd || 0), 0).toFixed(8)),
    cacheStatuses: [...new Set(extractionOperations.map(item => item.metadata?.cacheStatus).filter(Boolean))],
    outcome: extractionOperations.some(item => item.outcome === 'completed') ? 'extraction_completed' : 'extraction_failed'
  } : null;
  const providerSummary = liveOperations.length ? {
    provider: adapter.provider || 'deterministic', model: adapter.model || '',
    requestCount: liveOperations.filter(item => item.operation === 'web_search').length,
    reservedWebCalls: liveOperations.filter(item => item.operation === 'web_search').reduce((sum, item) => sum + (item.metadata?.reservedToolCalls || item.units || 0), 0),
    actualSearchActions: liveOperations.filter(item => item.operation === 'web_search' && item.outcome === 'completed').reduce((sum, item) => sum + (item.metadata?.actualSearchActions || item.units || 0), 0),
    inputTokens: liveOperations.reduce((sum, item) => sum + (item.metadata?.inputTokens || 0), 0),
    outputTokens: liveOperations.reduce((sum, item) => sum + (item.metadata?.outputTokens || 0), 0),
    totalTokens: liveOperations.reduce((sum, item) => sum + (item.metadata?.totalTokens || 0), 0),
    estimatedCostUsd: Number(liveOperations.reduce((sum, item) => sum + (item.metadata?.estimatedCostUsd || 0), 0).toFixed(8)),
    pricingVersion: liveOperations.find(item => item.metadata?.pricingVersion)?.metadata?.pricingVersion || '',
    outcome: evidenceItems.length ? 'research_completed' : unavailable ? 'research_unavailable' : 'research_insufficient',
    ...(extractionSummary ? { extraction: extractionSummary } : {}), ...(parserOperations.length ? { parser: { requestCount: parserOperations.length, inputTokens: parserOperations.reduce((sum, item) => sum + (item.metadata?.inputTokens || 0), 0), outputTokens: parserOperations.reduce((sum, item) => sum + (item.metadata?.outputTokens || 0), 0), totalTokens: parserOperations.reduce((sum, item) => sum + (item.metadata?.totalTokens || 0), 0), estimatedCostUsd: Number(parserOperations.reduce((sum, item) => sum + (item.metadata?.estimatedCostUsd || 0), 0).toFixed(8)), outcome: parserOperations.some(item => item.outcome === 'completed') ? 'completed' : 'failed' } } : {})
  } : { provider: 'deterministic', model: '', requestCount: 0, reservedWebCalls: 0, actualSearchActions: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, pricingVersion: '',
    outcome: noResearch ? 'not_required' : extractionSummary ? (evidenceItems.length ? 'research_completed' : 'research_insufficient') : 'deterministic_fixture',
    ...(extractionSummary ? { extraction: extractionSummary } : {}), ...(parserOperations.length ? { parser: { requestCount: parserOperations.length, inputTokens: parserOperations.reduce((sum, item) => sum + (item.metadata?.inputTokens || 0), 0), outputTokens: parserOperations.reduce((sum, item) => sum + (item.metadata?.outputTokens || 0), 0), totalTokens: parserOperations.reduce((sum, item) => sum + (item.metadata?.totalTokens || 0), 0), estimatedCostUsd: Number(parserOperations.reduce((sum, item) => sum + (item.metadata?.estimatedCostUsd || 0), 0).toFixed(8)), outcome: parserOperations.some(item => item.outcome === 'completed') ? 'completed' : 'failed' } } : {}) };
  const numericRejection = rejectedSources.find(item => item.numericDiagnostics);
  const missingQualification = numericRejection?.details?.some(code => /POPULATION/.test(code)) ? 'population'
    : numericRejection?.details?.some(code => /PERIOD/.test(code)) ? 'reporting period'
      : numericRejection?.details?.some(code => /GEOGRAPHY/.test(code)) ? 'geography'
        : numericRejection?.details?.some(code => /METRIC/.test(code)) ? 'metric'
          : numericRejection?.details?.some(code => /VALUE|UNIT/.test(code)) ? 'numeric value and unit' : '';
  const providerUnavailable = rejectedSources.some(item => ['AUTHORIZATION_FAILURE', 'BILLING_FAILURE', 'RATE_LIMITED', 'TIMEOUT', 'DISCOVERY_FAILURE', 'EXTRACTION_FAILURE'].includes(operationalCategory(item.status)));
  const budgetExhausted = rejectedSources.some(item => operationalCategory(item.status) === 'BUDGET_EXHAUSTED');
  const essentialMissing = needs.some(need => need.essential && !evidenceItems.some(item => item.claimType === need.claimType && item.evidenceStatus === 'supported'));
  const operationsStatus = noResearch ? 'NOT_REQUIRED' : essentialMissing ? 'BLOCKED' : budgetExhausted ? 'BUDGET_EXHAUSTED' : providerUnavailable && !evidenceItems.length ? 'PROVIDER_UNAVAILABLE' : evidenceItems.length && unsupportedQuestions.length ? 'PARTIAL' : evidenceItems.length ? 'SUPPORTED' : 'INSUFFICIENT';
  const researchOperationsSummary = researchOperations.summary(operationsStatus, { researchNeedCount: needs.length, supportedNeedCount: needs.filter(need => evidenceItems.some(item => item.claimType === need.claimType && item.evidenceStatus === 'supported')).length, insufficientNeedCount: unsupportedQuestions.length, blockedNeedCount: essentialMissing ? 1 : 0, webSearchActions: liveOperations.filter(item => item.operation === 'web_search' && item.outcome === 'completed').reduce((sum, item) => sum + (item.metadata?.actualSearchActions || item.units || 0), 0), nativeSourceCount: providerReports.reduce((sum, item) => sum + (item.sourceCounts?.registered || 0), 0), eligibleSourceCount: providerReports.reduce((sum, item) => sum + (item.sourceCounts?.returned || 0), 0), retrievedSourceCount: extractionOperations.filter(item => item.outcome === 'completed').length });
  const limitationNote = operationsStatus === 'INSUFFICIENT' ? 'The available sources did not support this claim strongly enough, so CopyQuick left it out.' : ['PROVIDER_UNAVAILABLE', 'BUDGET_EXHAUSTED'].includes(operationsStatus) ? 'Research could not be completed during this run. Unsupported claims were not added.' : operationsStatus === 'BLOCKED' ? 'This article needs verified evidence for a required claim before it can be prepared safely.' : '';
  return {
    researchSummary: noResearch ? 'No external evidence required for this article.' : evidenceItems.length ? `Reviewed ${sources.length} accepted source${sources.length === 1 ? '' : 's'} for the article's targeted evidence needs.` : missingQualification ? `The source was authoritative, but the returned evidence did not establish the statistic's ${missingQualification} clearly enough for publication.` : 'No source met the evidence requirements for the targeted research needs.',
    researchQuestions: needs.map(item => item.question), sourcesUsed: sources.map(item => `${item.publisher} — ${item.title}${item.publicationDate ? ` (${item.publicationDate})` : ''}`),
    supportedFindings: evidenceItems.filter(item => item.evidenceStatus === 'supported').map(item => item.proposition), unsupportedQuestions, conflicts,
    freshnessNotes: sources.length ? sources.map(item => `${item.title}: retrieved ${item.retrievedAt.slice(0, 10)}.`) : ['No external source freshness review was required.'],
    sources: sources.map(({ content, ...metadata }) => metadata), evidenceItems,
    claimMappings: evidenceItems.filter(item => item.evidenceStatus === 'supported').map(item => ({ claimKey: `claim-${item.evidenceKey}`, evidenceKeys: [item.evidenceKey], supportStatus: item.supportStatus })),
    rejectedSources, researchTrace: trace, providerSummary,
    researchOperations: researchOperationsSummary, researchStatus: customerResearchStatus(operationsStatus),
    questionsChecked: needs.length, supportedQuestionCount: researchOperationsSummary.supportedNeedCount, questionsNeedingEvidence: researchOperationsSummary.insufficientNeedCount,
    sourcesUsedCount: sources.length, lastCheckedAt: researchOperationsSummary.completedAt, limitationNote,
    researchAvailabilityStatus: noResearch ? 'not_required' : providerSummary.outcome,
    noExternalEvidenceRequired: noResearch,
    essentialEvidenceMissing: essentialMissing
  };
}

function validateResearchPack(pack) {
  const failures = []; const arrayKeys = ['researchQuestions', 'sourcesUsed', 'supportedFindings', 'unsupportedQuestions', 'conflicts', 'freshnessNotes', 'sources', 'evidenceItems', 'claimMappings', 'rejectedSources', 'researchTrace'];
  if (!clean(pack?.researchSummary)) failures.push('RESEARCH_SUMMARY_MISSING');
  if (pack?.researchAvailabilityStatus !== undefined && !['not_required', 'deterministic_fixture', 'research_completed', 'research_insufficient', 'research_unavailable'].includes(pack.researchAvailabilityStatus)) failures.push('RESEARCH_AVAILABILITY_INVALID');
  if (pack?.providerSummary !== undefined && (!pack.providerSummary || typeof pack.providerSummary !== 'object' || Array.isArray(pack.providerSummary))) failures.push('RESEARCH_PROVIDER_SUMMARY_INVALID');
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
      Object.entries(proposition.qualifiers || {}).filter(([, value]) => Boolean(value)).forEach(([key, value]) => {
        const preserved = key === 'metric' ? true
          : key === 'unit' && ['percent', 'percentage', '%'].includes(lower(value))
          ? /%|percent(?:age)?/i.test(claim.text)
          : key === 'value' ? new RegExp(`(?:^|[^0-9])${normalizedNumeric(value).replace('.', '\\.')}(?=$|[^0-9])`).test(claim.text.replace(/,/g, ''))
            : containsMaterialText(claim.text, value);
        if (!preserved) failures.push('RESEARCH_QUALIFIER_LOSS');
      });
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

module.exports = { CLAIM_TYPES, LIMITS, PERMITTED_USES, STATUSES, buildExternalEvidenceContext, classifyClaimInventory, compileArticleCitations, derivePercentage, deterministicDirectSupport, generateResearchEvidencePack, groundCandidateSource, neutralQuery, propositionFor, researchNeeds, sourcePolicy, sourcePreAdmission, statisticEvidence, validateArticleEvidence, validateResearchPack };
