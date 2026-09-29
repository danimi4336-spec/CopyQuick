# AI Provider Runtime Safety

## Safe localhost and browser acceptance

Start acceptance work with an explicit isolated execution mode:

```sh
COPYQUICK_EXECUTION_MODE=acceptance npm start
```

Acceptance mode forces production generation through CopyQuick's deterministic
engine even when `.env` or the parent shell configures `AI_PROVIDER=openai` and
a live key. Provider status and the startup event identify the execution mode as
`acceptance` and isolation as active. Unsupported execution-mode values fail
startup instead of silently selecting a provider.

This mode is for local automated and browser acceptance with fabricated data.
It does not change standard deployment behavior and it does not authorize use
of production data. Deliberate live-provider evaluation remains separately
guarded by `AI_EVALUATION_ENABLED=true` and must not use acceptance mode.

## Isolated contract evaluation

AI output can be previewed against one production contract without creating a
production run, writing generations, or consuming customer allowance:

```sh
AI_EVALUATION_ENABLED=true npm run ai:evaluate -- customer_profile
```

For local editorial review, append `--show-output`. This returns only the
contract's customer-facing presentation sections; it still excludes prompts,
strategy snapshots, dependency payloads, credentials, and raw provider data:

```sh
AI_EVALUATION_ENABLED=true npm run ai:evaluate -- customer_profile --show-output
```

The command uses the deterministic provider unless `AI_PROVIDER=openai` is
explicitly configured. Evaluation is refused when `NODE_ENV=production`. Its
JSON result contains only contract/provider/model identifiers, validation and
quality status, counts, timing, and sanitized failure codes. It never returns
the raw prompt, fixture context, dependency content, or provider response. The
optional preview is intended only for non-production evaluation and remains
behind the same explicit evaluation guard.

## AI-assisted Discovery

Set `AI_DISCOVERY_ENABLED=true` together with the provider configuration to
allow structured interpretation of the founder's free-text description.
Recognized AI classifications are merged conservatively: user-confirmed values
always win, deterministic high-confidence matches are retained, unsupported
controlled values are discarded, and provider errors fall back to the existing
deterministic discovery path. Session provenance records only provider/model,
mode, sanitized failure code, uncertainty notes, and suggested questions.

## AI-assisted Strategy

Set `AI_STRATEGY_ENABLED=true` with the provider configuration to augment the
deterministic strategy. The deterministic engine remains authoritative for
confirmed facts, readiness, status, and core sections. AI output is limited to
bounded recommendations, reasons, assumptions, rationale, and additional risks;
unsupported claims and measured-result language are rejected. Provider failures
return the complete deterministic strategy with a sanitized fallback reason.

Production generation receives a bounded Brand Brain snapshot (brand name,
voice, builder-provided value context, and key messages) when one exists. The
stored generation and job-completion audit event record provider/model and
contract version; prompts, credentials, and raw responses are excluded from
operational event metadata.

When `AI_SAFETY_IDENTIFIER_SECRET` is configured, production requests include
a stable HMAC-derived `safety_identifier`; raw user IDs are never sent. Failed
contract or customer-quality validation receives one bounded replacement attempt
by default (`AI_PROVIDER_MAX_REVISIONS=0..2`). Revision attempts do not create
extra generation records or consume additional customer generation units.

CopyQuick routes external production-generation adapters through one bounded runtime. The runtime does not select or enable a provider; provider credentials, model selection, and live activation remain explicit deployment decisions.

## Safety bounds

- `AI_PROVIDER_TIMEOUT_MS` defaults to `45000`.
- `AI_PROVIDER_MAX_CONCURRENCY` defaults to `2` per application process.
- `AI_PROVIDER_MAX_INPUT_BYTES` defaults to `32768` serialized bytes.
- `AI_PROVIDER_MAX_OUTPUT_BYTES` defaults to `262144` serialized bytes.

Operator overrides are accepted only within hard safety ceilings: 120 seconds per
request, 8 concurrent requests per process, 262144 serialized input bytes, and
1048576 serialized output bytes. Invalid or excessive values fall back to the
defaults so configuration cannot silently disable cost and resource containment.

All values must be positive integers. Invalid or absent values use the conservative defaults.

Adapters receive an `AbortSignal` and should stop network work promptly when it is aborted. A timed-out adapter that ignores cancellation retains its concurrency slot until the invocation settles, preventing repeated timeouts from creating an unbounded provider-request storm.

## Failure policy

Provider failures are normalized to safe codes. Raw provider messages and payloads are not written to production-job diagnostics or structured runtime events.

- Rate limits are safe to retry through the existing bounded job retry policy.
- Request rejection and oversized input/output are permanent failures.
- Timeouts, network interruptions, upstream 5xx responses, caller cancellation, and otherwise ambiguous failures require production-job recovery review. They are not automatically charged again because the provider may have completed work before the local result was lost.

The built-in deterministic generator remains the default for local development and tests and does not pass through this external-provider boundary.

## OpenAI production adapter

CopyQuick includes an opt-in OpenAI Responses API adapter for structured production deliverables. It uses strict JSON Schema output and then passes the result through the existing production-contract and customer-readiness validation gates.

- `AI_PROVIDER=openai` explicitly enables the adapter.
- `OPENAI_API_KEY` must be supplied by the protected deployment environment.
- `OPENAI_MODEL` selects the model and defaults to `gpt-5.4-mini`.
- With `AI_PROVIDER` unset or set to `deterministic`, no external model request is made.

Startup fails closed when OpenAI is explicitly selected without a key or when an unsupported provider is named. Prompts and model responses are not written to operational logs. The adapter sends `store: false` on Responses API requests.

## OpenAI Web Search research adapter

Research Evidence Pack v2 can use a separately enabled OpenAI Web Search
adapter. Article generation keeps its existing provider and model. The adapter
submits one normalized Research Need per Responses request, sets
`max_tool_calls: 1`, requests native source metadata, and treats every returned
finding as candidate evidence until CopyQuick's source, qualifier, entailment,
and citation policies accept it. CopyQuick never fetches the returned URL.

- `OPENAI_RESEARCH_ENABLED=false` keeps live research off by default.
- `OPENAI_RESEARCH_MODEL` defaults to `gpt-4.1-mini-2025-04-14`.
- `OPENAI_RESEARCH_MAX_WEB_CALLS` defaults to and cannot exceed `5` per pack.
- `OPENAI_RESEARCH_TIMEOUT_MS` defaults to `60000` and cannot exceed `120000`.
- `OPENAI_RESEARCH_MAX_OUTPUT_TOKENS` defaults to `1200` and cannot exceed `4000`.
- `EXA_API_KEY` enables exact-URL Exa Contents extraction only after OpenAI has registered an eligible source; the key is never sent to OpenAI or included in generated output.
- `EXA_CONTENTS_TIMEOUT_MS` defaults to `12000` and cannot exceed `20000`. Exa extraction never performs search, accepts only the registered canonical URL, and does not use Exa summaries as evidence.
- The adapter reuses `OPENAI_API_KEY`; no second research credential is used.
- Acceptance mode always disables the live research adapter.

The same research model may perform a bounded structured entailment check
without Web Search. Search actions and entailment tokens are recorded separately
inside internal pack telemetry and do not change customer generation units.
Provider-native citation numbers are never rendered; CopyQuick assigns public
citations only after evidence acceptance.

When deterministic passage parsing finds bounded candidate windows but cannot
structure a complete proposition, the optional proposition parser may make one
strict Structured Outputs request per retrieved source. It receives at most
three source-local windows, has no tools or Web Search, and cannot establish
authority or evidence on its own. `OPENAI_PROPOSITION_PARSER_MODEL` defaults to
`OPENAI_RESEARCH_MODEL`; `OPENAI_PROPOSITION_PARSER_TIMEOUT_MS` defaults to
12000. CopyQuick independently verifies every returned field and support-window
reference before normal evidence validation.

## Activation checklist

Before enabling any live provider adapter:

1. Choose and approve the provider, model, data-handling terms, and budget.
2. Store credentials only in the protected deployment environment.
3. Confirm the adapter honors `AbortSignal` and never logs request or response bodies.
4. Exercise timeout, rate-limit, 4xx, 5xx, oversized-output, and ambiguous-result tests with mocked provider responses.
5. Start with conservative concurrency and provider-side spend limits.
6. Verify production-job retry and recovery-required behavior without live customer data.
