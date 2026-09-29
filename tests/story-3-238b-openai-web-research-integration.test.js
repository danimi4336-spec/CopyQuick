const assert = require('assert');
const { buildProductionContext } = require('../lib/generationService');
const { getProductionContract } = require('../lib/productionContracts');
const { buildExternalEvidenceContext, deterministicDirectSupport, generateResearchEvidencePack, validateArticleEvidence, validateResearchPack } = require('../lib/productionResearchEvidence');
const {
  DEFAULT_RESEARCH_MODEL, MAX_ERROR_BODY_BYTES, MAX_ERROR_MESSAGE_LENGTH, PRICING_SNAPSHOT, configuredOpenAIResearchAdapter,
  canonicalCitationUrl, createOpenAIResearchAdapter, estimateResearchCost, nativeResearchMetadata, reconcileNativeSource, researchModelCapabilities
} = require('../lib/openaiResearchProvider');
const { renderSafeMarkdown } = require('../lib/safeMarkdown');
const { generateSearchArticle, searchEditorialFailures } = require('../lib/productionSearchEditorial');

const need = {
  key: 'cash-flow-background', question: 'What authoritative evidence explains late-payment cash-flow pressure?',
  neutralQuery: 'late payment cash flow small business authoritative evidence', claimType: 'general_background',
  intendedUse: 'public_factual_claim', preferredSourceTypes: ['government'], prohibitedSourceTypes: ['blog'],
  freshnessClass: 'moderate', jurisdiction: 'United States', population: 'U.S. small businesses', requiredEntity: '',
  allowedDomains: ['sba.gov']
};
const finding = {
  proposition: 'Late customer payments can create cash-flow timing pressure for small businesses.',
  sourceUrl: 'https://www.sba.gov/example', supportingText: 'Late customer payments can create cash-flow timing pressure for small businesses.',
  sourceType: 'government', qualityTier: 'tier_1', publisher: 'U.S. Small Business Administration',
  title: 'Managing late payments', publicationDate: '2026-04-10', jurisdiction: 'United States',
  population: 'U.S. small businesses', entity: 'small_business', modality: 'can', relationship: '', period: '2026',
  claimType: 'general_background'
};
function headers(values = {}) { return { get(name) { return values[name.toLowerCase()] || ''; } }; }
function searchPayload(overrides = {}) {
  return {
    id: 'resp_search_1', status: 'completed', model: DEFAULT_RESEARCH_MODEL,
    output_text: JSON.stringify({ researchQuestion: need.question, candidateFindings: [finding], unsupported: [], conflicts: [] }),
    output: [
      { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', queries: [need.neutralQuery], sources: [{ type: 'url', url: finding.sourceUrl, title: finding.title }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'candidate', annotations: [{ type: 'url_citation', url: finding.sourceUrl, title: finding.title, start_index: 0, end_index: 9 }] }] }
    ],
    usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 }, ...overrides
  };
}
function entailmentPayload(support = 'direct') {
  return { id: 'resp_entail_1', status: 'completed', output_text: JSON.stringify({ support, explanation: 'The passage directly states the bounded proposition.' }), output: [], usage: { input_tokens: 180, output_tokens: 30, total_tokens: 210 } };
}
function reconciliationPayload(status = 'NO_MATCH', sourceRegistryKey = '') {
  return { id: 'resp_reconcile_1', status: 'completed', output_text: JSON.stringify({ status, sourceRegistryKey, reason: 'Bounded source identity result.' }), output: [], usage: { input_tokens: 140, output_tokens: 20, total_tokens: 160 } };
}
function responseQueue(payloads) {
  const queue = [...payloads];
  return async () => ({ ok: true, status: 200, headers: headers(), json: async () => queue.shift() });
}

(async () => {
  assert.strictEqual(configuredOpenAIResearchAdapter({}, {}), undefined, 'live research is disabled by default');
  assert.strictEqual(configuredOpenAIResearchAdapter({ OPENAI_RESEARCH_ENABLED: 'true', COPYQUICK_EXECUTION_MODE: 'acceptance' }, {}), undefined, 'acceptance mode cannot create a live adapter');
  const missingCredential = configuredOpenAIResearchAdapter({ OPENAI_RESEARCH_ENABLED: 'true' }, {});
  await assert.rejects(missingCredential.discover(need), error => error.code === 'RESEARCH_PROVIDER_AUTHORIZATION_FAILED');
  assert.strictEqual(DEFAULT_RESEARCH_MODEL, 'gpt-4.1-mini-2025-04-14');
  assert.strictEqual(PRICING_SNAPSHOT.webSearchCallUsd, 0.01);
  assert.strictEqual(estimateResearchCost({ searchActions: 1, inputTokens: 1000, outputTokens: 1000 }), 0.0152);
  assert.strictEqual(require('../lib/openaiResearchProvider').classifyLiveSource('https://cdn.www.census.gov/report', 'unknown', ['census.gov'], { claimType: 'current_statistic', jurisdiction: 'United States' }).qualityTier, 'tier_1');
  assert.strictEqual(require('../lib/openaiResearchProvider').classifyLiveSource('https://unrelated.gov/report', 'government', ['census.gov'], { claimType: 'current_statistic', jurisdiction: 'United States' }).qualityTier, 'tier_3');
  assert.strictEqual(deterministicDirectSupport(finding.proposition, `Context. ${finding.supportingText} More context.`), true);
  assert.strictEqual(deterministicDirectSupport('Late payments cause business failure.', finding.supportingText), false);

  const secret = `sk-${'a'.repeat(48)}`;
  const diagnosticBody = JSON.stringify({
    error: {
      type: 'invalid_request_error', code: 'invalid_parameter', param: 'tools[0].filters',
      message: `<b>Invalid</b>\u0000 request. Authorization: Bearer ${secret} ${'x'.repeat(400)}`,
      unknown: 'must not survive'
    }, ignored: { raw: 'must not survive' }
  });
  const diagnosticAdapter = createOpenAIResearchAdapter({ apiKey: secret, maxWebCalls: 1, fetchImpl: async () => ({
    ok: false, status: 400, headers: headers({ 'x-request-id': 'req_safe_400', 'content-length': String(Buffer.byteLength(diagnosticBody)) }), text: async () => diagnosticBody
  }) });
  let diagnosticError;
  await assert.rejects(diagnosticAdapter.discover(need), error => { diagnosticError = error; return error.code === 'RESEARCH_PROVIDER_RESPONSE_INVALID'; });
  assert.deepStrictEqual({
    httpStatus: diagnosticError.httpStatus, requestId: diagnosticError.requestId,
    providerErrorType: diagnosticError.providerErrorType, providerErrorCode: diagnosticError.providerErrorCode,
    providerErrorParam: diagnosticError.providerErrorParam
  }, { httpStatus: 400, requestId: 'req_safe_400', providerErrorType: 'invalid_request_error', providerErrorCode: 'invalid_parameter', providerErrorParam: 'tools[0].filters' });
  assert(diagnosticError.providerErrorMessage.length <= MAX_ERROR_MESSAGE_LENGTH);
  assert.doesNotMatch(diagnosticError.providerErrorMessage, /<b>|\u0000|Bearer\s+sk-|unknown|must not survive/);
  assert.doesNotMatch(JSON.stringify(diagnosticError), new RegExp(secret));
  const diagnosticMetadata = diagnosticAdapter.operations()[0].metadata;
  assert.deepStrictEqual(Object.keys(diagnosticMetadata).sort(), ['httpStatus', 'providerErrorCode', 'providerErrorMessage', 'providerErrorParam', 'providerErrorType', 'requestId'].sort());
  assert.doesNotMatch(JSON.stringify(diagnosticMetadata), /Authorization|raw|unknown|must not survive|sk-/);

  for (const errorResponse of [
    { ok: false, status: 400, headers: headers(), text: async () => '{bad json' },
    { ok: false, status: 400, headers: headers({ 'content-length': String(MAX_ERROR_BODY_BYTES + 1) }), text: async () => { throw new Error('oversized body must not be read'); } }
  ]) {
    const malformedAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', maxWebCalls: 1, fetchImpl: async () => errorResponse });
    await assert.rejects(malformedAdapter.discover(need), error => error.code === 'RESEARCH_PROVIDER_RESPONSE_INVALID' && error.providerErrorMessage === '');
  }

  const requests = [];
  const responses = [searchPayload(), entailmentPayload()];
  const adapter = createOpenAIResearchAdapter({
    apiKey: 'mock-key', maxWebCalls: 5, requestSafetyIdentifier: 'cq_safe',
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 200, headers: headers({ 'x-request-id': `req_${requests.length}`, 'x-ratelimit-remaining-requests': '499' }), json: async () => responses.shift() };
    }
  });
  const candidates = await adapter.discover(need);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].providerProvenance, 'openai_web_search_candidate');
  assert.strictEqual(candidates[0].candidateProposition, finding.proposition);
  const searchBody = requests[0].body;
  assert.strictEqual(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.strictEqual(searchBody.store, false);
  assert.strictEqual(searchBody.model, DEFAULT_RESEARCH_MODEL);
  assert.strictEqual(searchBody.tools[0].type, 'web_search');
  assert.strictEqual(searchBody.tools[0].filters, undefined, 'the selected snapshot rejects Web Search filters');
  assert.strictEqual(adapter.capabilities.supportsWebSearchDomainFilters, false);
  assert.strictEqual(searchBody.tool_choice, 'required');
  assert.strictEqual(searchBody.max_tool_calls, 1);
  assert.deepStrictEqual(searchBody.include, ['web_search_call.action.sources']);
  assert.strictEqual(searchBody.text.format.type, 'json_schema');
  assert.strictEqual(searchBody.text.format.strict, true);
  assert(!JSON.stringify(searchBody).includes('mock-key'));
  assert(!JSON.stringify(searchBody).match(/email|account id|brand brain|article draft/i));
  assert.match(searchBody.input[0].content, /untrusted data|candidate evidence|primary official sources/i);
  assert.match(searchBody.input[1].content, /Preferred official domains when relevant: sba\.gov/i);
  assert.strictEqual(adapter.budget().reserved, 1);
  assert.strictEqual(adapter.budget().actual, 1);

  const support = await adapter.entail({ proposition: finding.proposition, excerpt: finding.supportingText, qualifiers: { jurisdiction: 'United States' }, sourceLabel: finding.title });
  assert.strictEqual(support, 'direct');
  assert.strictEqual(requests[1].body.tools, undefined, 'entailment must not receive Web Search');
  assert.strictEqual(requests[1].body.store, false);
  assert(adapter.operations().some(item => item.operation === 'web_search' && item.metadata.actualSearchActions === 1));
  assert(adapter.operations().some(item => item.operation === 'entailment' && item.units === 0));

  const filterRequests = [];
  const filterCapable = createOpenAIResearchAdapter({
    apiKey: 'mock-key', model: 'synthetic-filter-capable-model',
    modelCapabilities: { supportsWebSearch: true, supportsWebSearchDomainFilters: true, supportsStructuredOutput: true, supportsMaxToolCalls: true },
    fetchImpl: async (_url, options) => {
      filterRequests.push(JSON.parse(options.body));
      return { ok: true, status: 200, headers: headers(), json: async () => searchPayload() };
    }
  });
  await filterCapable.discover(need);
  assert.deepStrictEqual(filterRequests[0].tools[0].filters, { allowed_domains: ['sba.gov'] });
  assert.strictEqual(researchModelCapabilities('unknown-model').supportsWebSearchDomainFilters, false, 'unknown models conservatively omit filters');
  assert.throws(() => createOpenAIResearchAdapter({ apiKey: 'mock-key', modelCapabilities: { supportsWebSearch: false } }), error => error.code === 'RESEARCH_PROVIDER_MODEL_INCOMPATIBLE');

  const brief = {
    summary: 'Evidence-aware brief', content: ['One bounded article'], specificTopic: 'invoicing and cash-flow visibility',
    readerQuestion: 'How can a small business use invoicing records to improve cash-flow visibility?',
    searchIntentHypothesis: 'Practical guidance', contentAngle: 'A repeatable review workflow',
    scope: 'General education', callToActionStatus: 'Not established', evidenceLimits: ['Do not invent current metrics.']
  };
  const packContext = buildProductionContext({
    productionRun: { objective: 'improve_search_rankings', user_id: 1, strategySnapshot: { primaryCustomer: { value: 'Small business owners', semanticRole: 'confirmed_fact' } } },
    job: { deliverable_id: 'research_evidence_pack', title: 'Research Evidence Pack', strategic_direction: 'Research targeted evidence.', contract_version: 'research_evidence_pack:v2' },
    dependencyOutputs: [{ deliverableId: 'priority_content_brief', contractVersion: 'priority_content_brief:v4', output: brief }]
  });
  const packRequests = [searchPayload({ id: 'resp_pack_search' }), entailmentPayload()];
  const packAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: async () => ({ ok: true, status: 200, headers: headers(), json: async () => packRequests.shift() }) });
  const pack = await generateResearchEvidencePack(packContext, { adapter: packAdapter });
  assert.deepStrictEqual(validateResearchPack(pack), []);
  assert.strictEqual(pack.providerSummary.provider, 'openai');
  assert.strictEqual(pack.providerSummary.actualSearchActions, 1);
  assert.strictEqual(pack.providerSummary.requestCount, 1);
  assert.strictEqual(pack.researchAvailabilityStatus, 'research_completed');
  assert.strictEqual(pack.evidenceItems[0].entailmentResult, 'direct');
  assert.strictEqual(pack.evidenceItems[0].evidenceStatus, 'supported');
  assert.strictEqual(packAdapter.operations().filter(item => item.operation === 'entailment').length, 0, 'verbatim bounded support does not require a second Responses request');
  assert(!JSON.stringify(getProductionContract('research_evidence_pack').presentationSections(pack)).match(/resp_pack|requestId|estimatedCost|inputTokens/));

  const assistedPackSearch = searchPayload({ id: 'resp_assisted_pack' });
  assistedPackSearch.output_text = JSON.stringify({ researchQuestion: need.question, candidateFindings: [{ ...finding, sourceUrl: 'https://redirect.example/provider-reference', title: 'Altered source label' }], unsupported: [], conflicts: [] });
  const assistedPackResponses = [assistedPackSearch, reconciliationPayload('MATCH', 'SRC_1')];
  const assistedPackAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', maxWebCalls: 1, fetchImpl: responseQueue(assistedPackResponses) });
  const assistedPack = await generateResearchEvidencePack(packContext, { adapter: assistedPackAdapter });
  assert.deepStrictEqual(validateResearchPack(assistedPack), []);
  assert.strictEqual(assistedPack.researchAvailabilityStatus, 'research_completed');
  assert.strictEqual(assistedPack.evidenceItems[0].evidenceStatus, 'supported');
  const externalEvidence = buildExternalEvidenceContext([{ deliverableId: 'research_evidence_pack', output: assistedPack }]);
  const articleContext = buildProductionContext({
    productionRun: { objective: 'improve_search_rankings', user_id: 1, strategySnapshot: { primaryCustomer: { value: 'Small business owners', semanticRole: 'confirmed_fact' } } },
    job: { deliverable_id: 'priority_search_article', title: 'Priority Search Article', strategic_direction: 'Write the article.', contract_version: 'priority_search_article:v2' },
    dependencyOutputs: [packContext.dependencyOutputs[0], { deliverableId: 'research_evidence_pack', contractVersion: 'research_evidence_pack:v2', output: assistedPack }]
  });
  const citedArticle = generateSearchArticle(articleContext);
  assert.deepStrictEqual(searchEditorialFailures(citedArticle, articleContext), []);
  assert.deepStrictEqual(validateArticleEvidence(citedArticle, articleContext), []);
  assert.match(citedArticle.articleBlocks.map(item => item.body).join('\n'), /\[1\]/);
  assert.deepStrictEqual(citedArticle.sources.map(item => item.canonicalUrl), [finding.sourceUrl]);

  const failedPackAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', maxWebCalls: 1, fetchImpl: async () => ({
    ok: false, status: 400, headers: headers({ 'x-request-id': 'req_private' }), text: async () => JSON.stringify({ error: { type: 'invalid_request_error', code: 'bad_request', param: 'tools', message: 'Private diagnostic detail.' } })
  }) });
  const failedPack = await generateResearchEvidencePack(packContext, { adapter: failedPackAdapter });
  assert.match(JSON.stringify(failedPack.researchTrace), /req_private|Private diagnostic detail/);
  const customerPack = JSON.stringify(getProductionContract('research_evidence_pack').presentationSections(failedPack));
  assert.doesNotMatch(customerPack, /req_private|Private diagnostic detail|providerError/);
  const failedExternal = require('../lib/productionResearchEvidence').buildExternalEvidenceContext([{ deliverableId: 'research_evidence_pack', output: failedPack }]);
  assert.doesNotMatch(JSON.stringify(failedExternal), /req_private|Private diagnostic detail|providerError/);

  const unknownUrlPayload = searchPayload();
  unknownUrlPayload.output_text = JSON.stringify({ researchQuestion: need.question, candidateFindings: [{ ...finding, sourceUrl: 'https://invented.example/source' }], unsupported: [], conflicts: [] });
  const unknownAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: responseQueue([unknownUrlPayload, reconciliationPayload()]) });
  const unknownCandidates = await unknownAdapter.discover(need);
  assert.strictEqual(unknownCandidates.length, 1, 'the invented URL is ignored while the independently registered native source remains eligible');
  assert.strictEqual(unknownCandidates[0].canonicalUrl, finding.sourceUrl);
  assert.strictEqual(unknownCandidates[0].providerProvenance, 'openai_native_source_candidate');
  assert.deepStrictEqual(unknownAdapter.reports()[0].diagnostics, ['CANDIDATE_SOURCE_REFERENCE_UNMATCHED', 'STRUCTURED_OUTPUT_SOURCE_MISMATCH']);
  assert.deepStrictEqual(unknownAdapter.reports()[0].reconciliationStatuses, ['NO_MATCH']);
  assert.strictEqual(unknownAdapter.operations().filter(item => item.operation === 'source_reconciliation').length, 1);
  assert.strictEqual(unknownAdapter.operations().find(item => item.operation === 'source_reconciliation').metadata.totalTokens, 160);

  assert.strictEqual(canonicalCitationUrl('https://www.sba.gov/example/?utm_source=test&b=2&a=1#section'), 'https://www.sba.gov/example?a=1&b=2');
  assert.strictEqual(canonicalCitationUrl('http://www.sba.gov/example'), '');
  const reconciledPayload = searchPayload();
  reconciledPayload.output[0].action.sources[0].url = `${finding.sourceUrl}/?utm_source=openai#result`;
  reconciledPayload.output[1].content[0].annotations = [];
  const reconciledAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: async () => ({ ok: true, status: 200, headers: headers(), json: async () => reconciledPayload }) });
  const reconciled = await reconciledAdapter.discover(need);
  assert.strictEqual(reconciled.length, 1, 'canonical-equivalent native and candidate URLs reconcile');
  assert.strictEqual(reconciled[0].canonicalUrl, finding.sourceUrl);
  assert.deepStrictEqual(reconciledAdapter.reports()[0].sourceCounts, { actionSources: 1, annotations: 0, registered: 1, findings: 1, matched: 1, sourceOnly: 0, returned: 1, authorityRejected: 0, relevanceRejected: 0 });
  assert.deepStrictEqual(reconciledAdapter.reports()[0].matchTypes, ['canonical_url']);

  const annotationPayload = searchPayload();
  annotationPayload.output[0].action.sources = [];
  const annotationAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: async () => ({ ok: true, status: 200, headers: headers(), json: async () => annotationPayload }) });
  assert.strictEqual((await annotationAdapter.discover(need)).length, 1, 'native URL citation annotations may register a source');
  assert.deepStrictEqual(annotationAdapter.reports()[0].sourceCounts, { actionSources: 0, annotations: 1, registered: 1, findings: 1, matched: 1, sourceOnly: 0, returned: 1, authorityRejected: 0, relevanceRejected: 0 });

  const combinedNative = nativeResearchMetadata(searchPayload({ output: [
    { type: 'web_search_call', action: { type: 'search', sources: [{ url: `${finding.sourceUrl}?utm_campaign=x`, title: '' }] } },
    { type: 'web_search_call', action: { type: 'open_page', sources: [{ url: finding.sourceUrl, title: finding.title }] } },
    { type: 'web_search_call', action: { type: 'find_in_page', sources: [{ url: 'https://www.sba.gov/other', title: 'Other' }] } },
    { type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', url: `${finding.sourceUrl}#quoted`, title: finding.title }] }] }
  ] }));
  assert.strictEqual(combinedNative.searchCalls.length, 1);
  assert.strictEqual(combinedNative.actionSources.length, 3);
  assert.strictEqual(combinedNative.annotations.length, 1);
  assert.strictEqual(combinedNative.sources.length, 2, 'action and annotation representations deduplicate by canonical URL');
  assert.deepStrictEqual(combinedNative.sources[0].provenance.sort(), ['action_source', 'url_citation']);
  assert.strictEqual(reconcileNativeSource({ sourceUrl: 'https://www.sba.gov/different-provider-path', title: finding.title }, combinedNative).matchType, 'host_and_title', 'one exact title on the same host safely reconciles provider URL variants');
  assert.strictEqual(reconcileNativeSource({ sourceUrl: 'https://www.sba.gov/different-provider-path', title: 'Unrelated page' }, combinedNative), null, 'host identity alone is insufficient');
  const ambiguousNative = nativeResearchMetadata(searchPayload({ output: [{ type: 'web_search_call', action: { type: 'search', sources: [
    { url: 'https://www.sba.gov/one', title: finding.title }, { url: 'https://www.sba.gov/two', title: finding.title }
  ] } }] }));
  assert.strictEqual(reconcileNativeSource({ sourceUrl: 'https://www.sba.gov/third', title: finding.title }, ambiguousNative), null, 'ambiguous title matches fail closed');

  const unrelatedSameDomain = searchPayload();
  unrelatedSameDomain.output_text = JSON.stringify({ researchQuestion: need.question, candidateFindings: [{ ...finding, sourceUrl: 'https://www.sba.gov/unrelated', title: 'Unrelated page' }], unsupported: [], conflicts: [] });
  const unrelatedAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: responseQueue([unrelatedSameDomain, reconciliationPayload()]) });
  const unrelatedCandidates = await unrelatedAdapter.discover(need);
  assert.strictEqual(unrelatedCandidates.length, 1, 'the unrelated structured URL is ignored while the relevant native source remains available');
  assert.strictEqual(unrelatedCandidates[0].canonicalUrl, finding.sourceUrl);

  const assistedPayload = searchPayload();
  assistedPayload.output_text = JSON.stringify({ researchQuestion: need.question, candidateFindings: [{ ...finding, sourceUrl: 'https://redirect.example/provider-reference', title: 'Altered source label' }], unsupported: [], conflicts: [] });
  const assistedRequests = [];
  const assistedResponses = [assistedPayload, reconciliationPayload('MATCH', 'SRC_1')];
  const assistedAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: async (_url, options) => {
    assistedRequests.push(JSON.parse(options.body));
    return { ok: true, status: 200, headers: headers(), json: async () => assistedResponses.shift() };
  } });
  const assistedCandidates = await assistedAdapter.discover(need);
  assert.strictEqual(assistedCandidates.length, 1);
  assert.strictEqual(assistedCandidates[0].canonicalUrl, finding.sourceUrl, 'only the native registry URL survives reconciliation');
  assert.deepStrictEqual(assistedAdapter.reports()[0].matchTypes, ['model_assisted']);
  assert.deepStrictEqual(assistedAdapter.reports()[0].reconciliationStatuses, ['MATCH']);
  assert.strictEqual(assistedRequests[1].tools, undefined, 'source reconciliation must not use Web Search');
  assert.strictEqual(assistedRequests[1].store, false);
  assert.deepStrictEqual(assistedRequests[1].text.format.schema.properties.sourceRegistryKey.enum, ['', 'SRC_1']);
  assert.doesNotMatch(JSON.stringify(assistedRequests[1]), /mock-key|Brand Brain|account id/i);

  for (const [status, key, expectedDiagnostic] of [
    ['AMBIGUOUS', '', 'CANDIDATE_SOURCE_REFERENCE_AMBIGUOUS'],
    ['MATCH', 'INVENTED_KEY', 'CANDIDATE_SOURCE_REFERENCE_UNMATCHED']
  ]) {
    const guardedAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: responseQueue([assistedPayload, reconciliationPayload(status, key)]) });
    const guardedCandidates = await guardedAdapter.discover(need);
    assert.strictEqual(guardedCandidates.length, 1, 'failed structured reconciliation does not discard the independently registered native source');
    assert.strictEqual(guardedCandidates[0].providerProvenance, 'openai_native_source_candidate');
    assert(guardedAdapter.reports()[0].diagnostics.includes(expectedDiagnostic));
  }

  const emptyFindings = searchPayload({ output_text: JSON.stringify({ researchQuestion: need.question, candidateFindings: [], unsupported: [need.question], conflicts: [] }) });
  const emptyAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: async () => ({ ok: true, status: 200, headers: headers(), json: async () => emptyFindings }) });
  const emptyFindingCandidates = await emptyAdapter.discover(need);
  assert.strictEqual(emptyFindingCandidates.length, 1, 'native source identity remains a retrieval candidate when structured findings are empty');
  assert.strictEqual(emptyFindingCandidates[0].providerProvenance, 'openai_native_source_candidate');
  assert.deepStrictEqual(emptyAdapter.reports()[0].diagnostics, ['CANDIDATE_FINDINGS_EMPTY']);

  const unsafeNative = searchPayload();
  unsafeNative.output[0].action.sources = [{ url: 'https://127.0.0.1/private', title: 'Unsafe' }];
  unsafeNative.output[1].content[0].annotations = [];
  const unsafeAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: async () => ({ ok: true, status: 200, headers: headers(), json: async () => unsafeNative }) });
  await assert.rejects(unsafeAdapter.discover(need), error => error.code === 'RESEARCH_PROVIDER_SOURCES_MISSING');

  const sparsePayload = searchPayload();
  sparsePayload.output[0].action.sources = [{ url: finding.sourceUrl }];
  sparsePayload.output[1].content[0].annotations = [];
  sparsePayload.output_text = JSON.stringify({ researchQuestion: need.question, candidateFindings: [{ ...finding, publisher: '', publicationDate: '', title: '' }], unsupported: [], conflicts: [] });
  const sparseAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: async () => ({ ok: true, status: 200, headers: headers(), json: async () => sparsePayload }) });
  assert.strictEqual((await sparseAdapter.discover(need)).length, 1, 'optional source metadata does not block registration');

  let attempts = 0;
  const retryAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', maxWebCalls: 2, sleep: async () => {}, fetchImpl: async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 429, headers: headers({ 'retry-after': '0' }) };
    return { ok: true, status: 200, headers: headers(), json: async () => searchPayload() };
  } });
  await retryAdapter.discover(need);
  assert.strictEqual(attempts, 2);
  assert.strictEqual(retryAdapter.budget().reserved, 2);
  await assert.rejects(retryAdapter.discover(need), error => error.code === 'RESEARCH_PROVIDER_BUDGET_EXHAUSTED');

  let singleBudgetAttempts = 0;
  const singleBudgetAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', maxWebCalls: 1, fetchImpl: async () => {
    singleBudgetAttempts += 1;
    throw new Error('pre-execution network failure');
  } });
  await assert.rejects(singleBudgetAdapter.discover(need), error => error.code === 'RESEARCH_PROVIDER_UNAVAILABLE');
  assert.strictEqual(singleBudgetAttempts, 1, 'a one-call budget must not retry or hide the original provider failure');

  const noSearchAdapter = createOpenAIResearchAdapter({ apiKey: 'mock-key', fetchImpl: async () => ({ ok: true, status: 200, headers: headers(), json: async () => ({ ...searchPayload(), output: [] }) }) });
  await assert.rejects(noSearchAdapter.discover(need), error => error.code === 'RESEARCH_PROVIDER_NO_SEARCH_EXECUTED');

  const rendered = renderSafeMarkdown(`Official source: ${finding.sourceUrl}`);
  assert.match(rendered, /<a href="https:\/\/www\.sba\.gov\/example" target="_blank" rel="noopener noreferrer">/);
  assert.doesNotMatch(renderSafeMarkdown('Source: javascript:alert(1)'), /<a /);
  console.log('Story 3.238B OpenAI Web Research Integration tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
