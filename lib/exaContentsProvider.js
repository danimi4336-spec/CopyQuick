const { EXTRACTION_LIMITS, canonicalExtractionUrl } = require('./sourceExtraction');
const { safeCitationUrl } = require('./researchAdapter');

const EXA_CONTENTS_URL = 'https://api.exa.ai/contents';
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PRICING_SNAPSHOT = Object.freeze({ version: 'exa-contents-2026-09-28', usdPerPage: 0.001 });
const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
const boundedInteger = (value, fallback, maximum) => { const parsed = Number.parseInt(value, 10); return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback; };

function extractionError(code, options = {}) {
  const error = new Error('The source extraction provider could not complete the request safely.');
  Object.assign(error, { code, httpStatus: options.httpStatus || null, retryable: Boolean(options.retryable), retryAfterMs: options.retryAfterMs || 0,
    requestId: clean(options.requestId), providerStatus: clean(options.providerStatus), providerTag: clean(options.providerTag),
    providerMessage: clean(options.providerMessage), returnedUrl: canonicalExtractionUrl(options.returnedUrl), providerCostUsd: Number.isFinite(options.providerCostUsd) ? options.providerCostUsd : null,
    transportName: clean(options.transportName).slice(0, 80), transportCode: clean(options.transportCode).slice(0, 80), transportMessage: clean(options.transportMessage).slice(0, 160) });
  return error;
}

function classifyTransportFailure(error) {
  const name = clean(error?.name || 'Error'); const causeCode = clean(error?.cause?.code || error?.code).toUpperCase();
  const details = { transportName: name, transportCode: causeCode, transportMessage: clean(error?.message || 'Fetch failed.').slice(0, 160) };
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(causeCode)) return extractionError('EXTRACTION_DNS_FAILURE', { ...details, retryable: true });
  if (causeCode === 'ECONNREFUSED') return extractionError('EXTRACTION_CONNECTION_REFUSED', { ...details, retryable: true });
  if (['ECONNRESET', 'EPIPE'].includes(causeCode)) return extractionError('EXTRACTION_CONNECTION_RESET', { ...details, retryable: true });
  if (/CERT|TLS|SSL/.test(causeCode)) return extractionError('EXTRACTION_TLS_FAILURE', details);
  if (['EPERM', 'EACCES'].includes(causeCode)) return extractionError('EXTRACTION_ENVIRONMENT_NETWORK_BLOCKED', details);
  return extractionError('EXTRACTION_FETCH_FAILED', { ...details, retryable: true });
}

function responseHeader(response, name) { try { return clean(response?.headers?.get?.(name)); } catch (_) { return ''; } }
function retryAfterMs(response) {
  const raw = responseHeader(response, 'retry-after'); if (!raw) return 0;
  const seconds = Number(raw); if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000);
  return 0;
}
function classifyHttpFailure(response) {
  const status = Number(response?.status) || 502;
  if ([401, 403].includes(status)) return extractionError('EXTRACTION_AUTHORIZATION_FAILED', { httpStatus: status });
  if (status === 402) return extractionError('EXTRACTION_BILLING_FAILED', { httpStatus: status });
  if (status === 404) return extractionError('EXTRACTION_SOURCE_UNAVAILABLE', { httpStatus: status });
  if (status === 429) return extractionError('EXTRACTION_RATE_LIMITED', { httpStatus: status, retryable: true, retryAfterMs: retryAfterMs(response) });
  if (status >= 500) return extractionError('EXTRACTION_PROVIDER_UNAVAILABLE', { httpStatus: status, retryable: true, retryAfterMs: retryAfterMs(response) });
  return extractionError('EXTRACTION_RESPONSE_INVALID', { httpStatus: status });
}

async function boundedJson(response) {
  const declared = Number(responseHeader(response, 'content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw extractionError('EXTRACTION_CONTENT_TOO_LARGE');
  let text;
  if (response?.body?.getReader) {
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let total = 0; let output = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value?.byteLength || 0;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); throw extractionError('EXTRACTION_CONTENT_TOO_LARGE'); }
      output += decoder.decode(value, { stream: true });
    }
    text = output + decoder.decode();
  } else if (typeof response?.text === 'function') {
    text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw extractionError('EXTRACTION_CONTENT_TOO_LARGE');
  } else if (typeof response?.json === 'function') {
    return response.json();
  } else throw extractionError('EXTRACTION_RESPONSE_INVALID');
  try { return JSON.parse(text); } catch (_) { throw extractionError('EXTRACTION_RESPONSE_INVALID'); }
}

function validateRequest(request) {
  const sourceRegistryKey = clean(request?.sourceRegistryKey); const canonicalUrl = canonicalExtractionUrl(request?.canonicalUrl);
  const registeredCanonicalUrl = canonicalExtractionUrl(request?.registeredCanonicalUrl);
  if (!sourceRegistryKey || !canonicalUrl || canonicalUrl !== registeredCanonicalUrl || !safeCitationUrl(canonicalUrl)) throw extractionError('EXTRACTION_SOURCE_MISMATCH');
  if (/\.pdf(?:$|[?#])/i.test(canonicalUrl)) throw extractionError('EXTRACTION_UNSUPPORTED_CONTENT');
  return Object.freeze({ sourceRegistryKey, canonicalUrl });
}

function normalizePayload(payload, requested, durationMs, now, httpStatus = 200) {
  if (!payload || typeof payload !== 'object') throw extractionError('EXTRACTION_RESPONSE_INVALID');
  const status = Array.isArray(payload.statuses) ? payload.statuses.find(item => canonicalExtractionUrl(item.id) === requested.canonicalUrl) || payload.statuses[0] : null;
  if (status && clean(status.status).toLowerCase() !== 'success') {
    const providerReason = clean(status.error?.message || status.error || status.reason || status.status);
    const details = { requestId: payload.requestId, providerStatus: status.status, providerTag: status.error?.tag || payload.tag,
      providerMessage: providerReason, httpStatus: status.error?.httpStatusCode || httpStatus,
      providerCostUsd: Number.isFinite(Number(payload.costDollars?.total)) ? Number(payload.costDollars.total) : null };
    if (/timeout|timed out|crawl.*time/i.test(providerReason) || /timeout/i.test(details.providerTag)) throw extractionError('EXTRACTION_TIMEOUT', { ...details, retryable: true });
    if (/rate|limit|thrott/i.test(providerReason) || /rate|limit|thrott/i.test(details.providerTag)) throw extractionError('EXTRACTION_RATE_LIMITED', { ...details, retryable: true });
    throw extractionError('EXTRACTION_SOURCE_UNAVAILABLE', details);
  }
  if (!Array.isArray(payload.results) || payload.results.length !== 1) throw extractionError('EXTRACTION_RESPONSE_INVALID');
  const result = payload.results[0];
  const returnedUrl = canonicalExtractionUrl(result.url);
  if (!returnedUrl || returnedUrl !== requested.canonicalUrl) throw extractionError('EXTRACTION_SOURCE_MISMATCH');
  const contentType = clean(result.contentType || result.mimeType || 'text/html').toLowerCase();
  if (contentType && !/^(?:text\/html|text\/plain)(?:;|$)/.test(contentType)) throw extractionError('EXTRACTION_UNSUPPORTED_CONTENT');
  const normalizedText = typeof result.text === 'string' ? result.text : '';
  if (!normalizedText) throw extractionError('EXTRACTION_RESPONSE_INVALID');
  if (normalizedText.length > EXTRACTION_LIMITS.normalizedTextCharacters) throw extractionError('EXTRACTION_CONTENT_TOO_LARGE');
  const providerCost = Number(payload.costDollars?.total); const cost = Number.isFinite(providerCost) && providerCost >= 0 ? providerCost : PRICING_SNAPSHOT.usdPerPage;
  return Object.freeze({ provider: 'exa_contents', requestedUrl: requested.canonicalUrl, returnedUrl, title: clean(result.title), contentType,
    retrievalStatus: clean(status?.status) || 'success', cacheStatus: clean(status?.source) || 'unknown', retrievedAt: now().toISOString(),
    freshnessPolicy: requested.freshnessClass === 'high' ? 'fresh' : 'bounded_cache',
    normalizedText, providerMetadata: Object.freeze({ pricingVersion: PRICING_SNAPSHOT.version }),
    usage: Object.freeze({ requestCount: 1, pageCount: 1, durationMs, httpStatus, requestId: clean(payload.requestId), providerCostUsd: Number.isFinite(providerCost) ? providerCost : null,
      estimatedCostUsd: cost, pricingVersion: PRICING_SNAPSHOT.version }) });
}

function createExaContentsAdapter({ apiKey, fetchImpl = global.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxAttempts = 2, signal, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date() } = {}) {
  const key = clean(apiKey); const timeout = boundedInteger(timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS); const attempts = maxAttempts === 1 ? 1 : 2; const operations = [];
  async function invoke(request, attempt) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
    const combinedSignal = signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const body = { urls: [request.canonicalUrl], text: { maxCharacters: EXTRACTION_LIMITS.normalizedTextCharacters },
      ...(request.freshnessClass === 'high' ? { maxAgeHours: 0, livecrawlTimeout: 10000 } : { maxAgeHours: 168 }) };
    const started = Date.now();
    try {
      const response = await fetchImpl(EXA_CONTENTS_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: combinedSignal });
      if (!response?.ok) throw classifyHttpFailure(response);
      const payload = await boundedJson(response); return normalizePayload(payload, request, Date.now() - started, now, response.status);
    } catch (error) {
      if (error?.name === 'AbortError') throw extractionError('EXTRACTION_TIMEOUT_BEFORE_RESPONSE', { retryable: true, transportName: error.name, transportMessage: 'Request aborted before a response.' });
      if (error?.code) throw error;
      throw classifyTransportFailure(error);
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ provider: 'exa_contents', async retrieveSource(input) {
    const request = validateRequest(input);
    if (!key) { const error = extractionError('EXTRACTION_AUTHORIZATION_FAILED'); operations.push({ operation: 'source_extraction', sourceKey: request.sourceRegistryKey, outcome: error.code, units: 0, attempt: 0 }); throw error; }
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await invoke({ ...request, freshnessClass: input.freshnessClass }, attempt);
        operations.push({ operation: 'source_extraction', sourceKey: request.sourceRegistryKey, outcome: 'completed', units: 1, attempt,
          metadata: { canonicalUrl: request.canonicalUrl, durationMs: result.usage.durationMs, pageCount: 1, normalizedCharacterCount: result.normalizedText.length, cacheStatus: result.cacheStatus, providerCostUsd: result.usage.providerCostUsd, estimatedCostUsd: result.usage.estimatedCostUsd, pricingVersion: result.usage.pricingVersion } });
        return result;
      } catch (error) {
        lastError = error; operations.push({ operation: 'source_extraction', sourceKey: request.sourceRegistryKey, outcome: error.code, units: 1, attempt, metadata: { canonicalUrl: request.canonicalUrl, httpStatus: error.httpStatus || null } });
        if (attempt + 1 >= attempts || !error.retryable) throw error;
        if (error.retryAfterMs) await sleep(error.retryAfterMs);
      }
    }
    throw lastError;
  }, operations: () => Object.freeze(operations.map(item => Object.freeze({ ...item, metadata: item.metadata ? Object.freeze({ ...item.metadata }) : undefined }))) });
}

function configuredExaContentsAdapter(env = process.env, options = {}) {
  if (!clean(env.EXA_API_KEY)) return undefined;
  return createExaContentsAdapter({ apiKey: env.EXA_API_KEY, timeoutMs: env.EXA_CONTENTS_TIMEOUT_MS, fetchImpl: options.fetchImpl, signal: options.signal, sleep: options.sleep, now: options.now });
}

module.exports = { DEFAULT_TIMEOUT_MS, EXA_CONTENTS_URL, MAX_RESPONSE_BYTES, PRICING_SNAPSHOT, boundedJson, classifyTransportFailure, configuredExaContentsAdapter, createExaContentsAdapter, extractionError, validateRequest };
