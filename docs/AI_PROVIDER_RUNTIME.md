# AI Provider Runtime Safety

CopyQuick routes external production-generation adapters through one bounded runtime. The runtime does not select or enable a provider; provider credentials, model selection, and live activation remain explicit deployment decisions.

## Safety bounds

- `AI_PROVIDER_TIMEOUT_MS` defaults to `45000`.
- `AI_PROVIDER_MAX_CONCURRENCY` defaults to `2` per application process.
- `AI_PROVIDER_MAX_INPUT_BYTES` defaults to `32768` serialized bytes.
- `AI_PROVIDER_MAX_OUTPUT_BYTES` defaults to `262144` serialized bytes.

All values must be positive integers. Invalid or absent values use the conservative defaults.

Adapters receive an `AbortSignal` and should stop network work promptly when it is aborted. A timed-out adapter that ignores cancellation retains its concurrency slot until the invocation settles, preventing repeated timeouts from creating an unbounded provider-request storm.

## Failure policy

Provider failures are normalized to safe codes. Raw provider messages and payloads are not written to production-job diagnostics or structured runtime events.

- Rate limits are safe to retry through the existing bounded job retry policy.
- Request rejection and oversized input/output are permanent failures.
- Timeouts, network interruptions, upstream 5xx responses, caller cancellation, and otherwise ambiguous failures require production-job recovery review. They are not automatically charged again because the provider may have completed work before the local result was lost.

The built-in deterministic generator remains available for local development and tests and does not pass through this external-provider boundary.

## Activation checklist

Before enabling any live provider adapter:

1. Choose and approve the provider, model, data-handling terms, and budget.
2. Store credentials only in the protected deployment environment.
3. Confirm the adapter honors `AbortSignal` and never logs request or response bodies.
4. Exercise timeout, rate-limit, 4xx, 5xx, oversized-output, and ambiguous-result tests with mocked provider responses.
5. Start with conservative concurrency and provider-side spend limits.
6. Verify production-job retry and recovery-required behavior without live customer data.
