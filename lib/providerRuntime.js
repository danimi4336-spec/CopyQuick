const DEFAULT_TIMEOUT_MS = 45 * 1000;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_INPUT_BYTES = 32 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_TIMEOUT_MS = 120 * 1000;
const MAX_CONCURRENCY = 8;
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const { writeOperationalEvent } = require('./operationalLogger');
const { getGenerationControlState, RUNNING } = require('./generationControls');

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function byteLength(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
  catch (_) { return Number.POSITIVE_INFINITY; }
}

class ProviderRuntimeError extends Error {
  constructor(code, { safeToRetry = false, permanent = false, ambiguous = false } = {}) {
    super('The generation provider could not complete the request safely.');
    this.name = 'ProviderRuntimeError';
    this.code = code;
    this.safeToRetry = safeToRetry;
    this.permanent = permanent;
    this.ambiguous = ambiguous;
  }
}

function statusCode(error) {
  const candidate = Number(error?.status || error?.statusCode || error?.response?.status);
  return Number.isInteger(candidate) ? candidate : null;
}

function normalizeProviderError(error, { timedOut = false, externallyAborted = false } = {}) {
  if (error instanceof ProviderRuntimeError) return error;
  if (timedOut) return new ProviderRuntimeError('PROVIDER_TIMEOUT', { ambiguous: true });
  if (externallyAborted) return new ProviderRuntimeError('PROVIDER_CANCELLED', { ambiguous: true });
  const status = statusCode(error);
  if (status === 429) return new ProviderRuntimeError('PROVIDER_RATE_LIMITED', { safeToRetry: true });
  if (status && status >= 500) return new ProviderRuntimeError('PROVIDER_UNAVAILABLE', { ambiguous: true });
  if (status && status >= 400) return new ProviderRuntimeError('PROVIDER_REQUEST_REJECTED', { permanent: true });
  if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'ETIMEDOUT'].includes(error?.code)) {
    return new ProviderRuntimeError('PROVIDER_NETWORK_FAILURE', { ambiguous: true });
  }
  return new ProviderRuntimeError('PROVIDER_FAILURE', { ambiguous: true });
}

function createProviderRuntime({
  timeoutMs = process.env.AI_PROVIDER_TIMEOUT_MS,
  maxConcurrency = process.env.AI_PROVIDER_MAX_CONCURRENCY,
  maxInputBytes = process.env.AI_PROVIDER_MAX_INPUT_BYTES,
  maxOutputBytes = process.env.AI_PROVIDER_MAX_OUTPUT_BYTES,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  now = Date.now,
  logger = writeOperationalEvent,
  controlReader = () => getGenerationControlState()
} = {}) {
  const config = Object.freeze({
    timeoutMs: boundedPositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxConcurrency: boundedPositiveInteger(maxConcurrency, DEFAULT_MAX_CONCURRENCY, MAX_CONCURRENCY),
    maxInputBytes: boundedPositiveInteger(maxInputBytes, DEFAULT_MAX_INPUT_BYTES, MAX_INPUT_BYTES),
    maxOutputBytes: boundedPositiveInteger(maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES)
  });
  let activeCount = 0;

  function log(event, details = {}) {
    try { logger({ event, ...details }); } catch (_) {}
  }

  async function run({ operation = 'generation', input, invoke, signal } = {}) {
    if (typeof invoke !== 'function') {
      throw new ProviderRuntimeError('PROVIDER_ADAPTER_REQUIRED', { permanent: true });
    }
    let controlState;
    try {
      controlState = controlReader();
    } catch (_) {
      controlState = { mode: 'paused' };
    }
    if (controlState.mode !== RUNNING) {
      const error = new ProviderRuntimeError('GENERATION_PAUSED', { safeToRetry: true });
      log('provider_request_blocked', { operation, code: error.code });
      throw error;
    }
    if (byteLength(input) > config.maxInputBytes) {
      throw new ProviderRuntimeError('PROVIDER_INPUT_TOO_LARGE', { permanent: true });
    }
    if (activeCount >= config.maxConcurrency) {
      throw new ProviderRuntimeError('PROVIDER_CONCURRENCY_LIMIT', { safeToRetry: true });
    }
    if (signal?.aborted) {
      throw new ProviderRuntimeError('PROVIDER_CANCELLED', { ambiguous: true });
    }

    activeCount += 1;
    const startedAt = now();
    const controller = new AbortController();
    let timedOut = false;
    let externallyAborted = false;
    const abortFromCaller = () => {
      externallyAborted = true;
      controller.abort(signal?.reason || new Error('Generation cancelled'));
    };
    signal?.addEventListener?.('abort', abortFromCaller, { once: true });

    let timeout;
    const timeoutResult = new Promise(resolve => {
      timeout = setTimeoutFn(() => {
        timedOut = true;
        controller.abort(new Error('Generation timed out'));
        resolve({ ok: false, timeout: true });
      }, config.timeoutMs);
    });

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeCount -= 1;
    };
    const invocationResult = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return invoke({ signal: controller.signal });
      })
      .then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    // A timed-out adapter retains its concurrency slot until it actually settles.
    // Abort-aware adapters release promptly; an adapter that ignores cancellation
    // cannot create an unbounded request storm.
    invocationResult.then(release);

    const outcome = await Promise.race([invocationResult, timeoutResult]);
    clearTimeoutFn(timeout);
    signal?.removeEventListener?.('abort', abortFromCaller);
    const durationMs = Math.max(0, now() - startedAt);

    if (!outcome.ok) {
      const normalized = normalizeProviderError(outcome.error, { timedOut, externallyAborted });
      log('provider_request_failed', { operation, code: normalized.code, durationMs });
      throw normalized;
    }
    if (byteLength(outcome.value) > config.maxOutputBytes) {
      const error = new ProviderRuntimeError('PROVIDER_OUTPUT_TOO_LARGE', { permanent: true });
      log('provider_request_failed', { operation, code: error.code, durationMs });
      throw error;
    }
    log('provider_request_completed', { operation, durationMs });
    return outcome.value;
  }

  return { run, config, activeCount: () => activeCount };
}

const defaultProviderRuntime = createProviderRuntime();

module.exports = {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENCY,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_TIMEOUT_MS,
  ProviderRuntimeError,
  boundedPositiveInteger,
  createProviderRuntime,
  defaultProviderRuntime,
  normalizeProviderError
};
