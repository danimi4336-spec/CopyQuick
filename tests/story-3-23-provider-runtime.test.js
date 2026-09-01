const assert = require('assert');
const {
  ProviderRuntimeError,
  createProviderRuntime,
  normalizeProviderError
} = require('../lib/providerRuntime');

async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof ProviderRuntimeError && error.code === code);
}

async function run() {
  const events = [];
  const runtime = createProviderRuntime({
    timeoutMs: 100,
    maxConcurrency: 1,
    maxInputBytes: 100,
    maxOutputBytes: 100,
    logger: event => events.push(event)
  });

  let receivedSignal;
  const success = await runtime.run({
    operation: 'test:success',
    input: { prompt: 'safe input' },
    invoke: ({ signal }) => {
      receivedSignal = signal;
      return { text: 'safe output' };
    }
  });
  assert.deepStrictEqual(success, { text: 'safe output' });
  assert(receivedSignal instanceof AbortSignal);
  assert.strictEqual(runtime.activeCount(), 0);
  assert(events.some(event => event.event === 'provider_request_completed' && event.operation === 'test:success'));

  await rejectsCode(runtime.run({
    input: { prompt: 'x'.repeat(200) },
    invoke: () => ({ text: 'unused' })
  }), 'PROVIDER_INPUT_TOO_LARGE');
  await rejectsCode(runtime.run({
    input: { prompt: 'small' },
    invoke: () => ({ text: 'x'.repeat(200) })
  }), 'PROVIDER_OUTPUT_TOO_LARGE');

  let releasePending;
  const pending = runtime.run({
    input: { prompt: 'first' },
    invoke: () => new Promise(resolve => { releasePending = resolve; })
  });
  await Promise.resolve();
  assert.strictEqual(runtime.activeCount(), 1);
  await rejectsCode(runtime.run({ input: { prompt: 'second' }, invoke: () => 'unused' }), 'PROVIDER_CONCURRENCY_LIMIT');
  releasePending({ text: 'done' });
  await pending;
  assert.strictEqual(runtime.activeCount(), 0);

  const timeoutRuntime = createProviderRuntime({ timeoutMs: 15, maxConcurrency: 1, logger: event => events.push(event) });
  let timeoutSignal;
  await assert.rejects(timeoutRuntime.run({
    operation: 'test:timeout',
    input: { prompt: 'hang' },
    invoke: ({ signal }) => new Promise((resolve, reject) => {
      timeoutSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  }), error => error.code === 'PROVIDER_TIMEOUT' && error.ambiguous === true && error.safeToRetry === false);
  assert.strictEqual(timeoutSignal.aborted, true);
  await Promise.resolve();
  assert.strictEqual(timeoutRuntime.activeCount(), 0);

  let releaseIgnoredAbort;
  const ignoringRuntime = createProviderRuntime({ timeoutMs: 10, maxConcurrency: 1, logger: () => {} });
  await rejectsCode(ignoringRuntime.run({
    input: { prompt: 'ignored abort' },
    invoke: () => new Promise(resolve => { releaseIgnoredAbort = resolve; })
  }), 'PROVIDER_TIMEOUT');
  assert.strictEqual(ignoringRuntime.activeCount(), 1, 'an adapter ignoring abort must retain its concurrency slot');
  await rejectsCode(ignoringRuntime.run({ input: { prompt: 'storm' }, invoke: () => 'unused' }), 'PROVIDER_CONCURRENCY_LIMIT');
  releaseIgnoredAbort({ text: 'late result' });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(ignoringRuntime.activeCount(), 0);

  const caller = new AbortController();
  const cancelled = timeoutRuntime.run({
    input: { prompt: 'cancel' },
    signal: caller.signal,
    invoke: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  });
  caller.abort();
  await assert.rejects(cancelled, error => error.code === 'PROVIDER_CANCELLED' && error.ambiguous === true);
  let invokedAfterCancellation = false;
  await rejectsCode(timeoutRuntime.run({
    input: { prompt: 'already cancelled' },
    signal: caller.signal,
    invoke: () => { invokedAfterCancellation = true; }
  }), 'PROVIDER_CANCELLED');
  assert.strictEqual(invokedAfterCancellation, false);

  const limited = normalizeProviderError({ status: 429, message: 'secret payload' });
  assert.strictEqual(limited.code, 'PROVIDER_RATE_LIMITED');
  assert.strictEqual(limited.safeToRetry, true);
  assert.doesNotMatch(limited.message, /secret payload/);
  assert.strictEqual(normalizeProviderError({ status: 503 }).code, 'PROVIDER_UNAVAILABLE');
  assert.strictEqual(normalizeProviderError({ status: 400 }).permanent, true);
  assert.strictEqual(normalizeProviderError({ code: 'ECONNRESET' }).ambiguous, true);
  assert(events.every(event => !JSON.stringify(event).includes('secret payload')));

  console.log('Story 3.23 provider runtime tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
