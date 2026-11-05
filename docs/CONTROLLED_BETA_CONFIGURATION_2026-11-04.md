# Controlled-Beta Configuration Recommendation — 2026-11-04

## Recommendation

Keep the current production service unchanged until a non-production staging
target exists and the release candidate passes the seven-objective browser,
billing, email, authentication, accessibility, and metadata gates.

For the first controlled beta, use two explicit modes rather than an ambiguous
hybrid:

1. Deterministic acceptance mode for release verification and incident drills.
2. Standard mode with OpenAI production generation only after the owner approves
   the model, provider data terms, beta budget, and external spend controls.

Do not enable Web Search, Exa extraction, AI-assisted Discovery, or AI-assisted
Strategy in the first beta. Those capabilities have separate cost, evidence,
and failure surfaces and are not required to validate the core paid workflow.

## Proposed initial production-generation settings

These values are recommendations, not applied configuration:

```ini
COPYQUICK_EXECUTION_MODE=standard
AI_PROVIDER=openai
OPENAI_MODEL=gpt-5.4-mini
AI_DISCOVERY_ENABLED=false
AI_STRATEGY_ENABLED=false
OPENAI_RESEARCH_ENABLED=false
AI_PROVIDER_MAX_REVISIONS=1
AI_PROVIDER_TIMEOUT_MS=45000
AI_PROVIDER_MAX_CONCURRENCY=1
AI_PROVIDER_MAX_INPUT_BYTES=32768
AI_PROVIDER_MAX_OUTPUT_BYTES=262144
```

Also require:

- a protected `OPENAI_API_KEY`;
- a long random `AI_SAFETY_IDENTIFIER_SECRET`;
- provider-side monthly and alert budgets approved by the owner;
- operational alerts routed to an explicitly owned recipient;
- one application instance until cross-instance concurrency accounting is
  intentionally designed; and
- manual beta-account admission until an explicit admission-control feature is
  implemented and validated.

## Why this is the conservative beta posture

- One process-level provider slot limits concurrent external spend and limits
  the blast radius of upstream latency.
- One revision preserves a bounded quality-repair opportunity without allowing
  unbounded retries.
- Research remains disabled, preventing web-call and citation complexity from
  entering ordinary production jobs.
- Deterministic acceptance remains available without provider calls or customer
  credit use.
- The current `service_page` evidence includes one safe rejection in three
  observations; the quality gate must remain fail-closed.

## Capacity assumptions requiring measurement

No reliable broad-beta capacity claim can be made from the current evidence.
Before raising concurrency or admitting more accounts, record:

- p50/p95 provider latency by contract;
- job queue wait and recovery-required frequency;
- validation and quality rejection rates by contract;
- average and high-percentile token-derived cost;
- retries/revisions per accepted artifact;
- billing reconciliation drift; and
- operational alert volume.

## Owner decisions required

1. Approve the production provider and model.
2. Approve monthly spend and alert thresholds.
3. Name the operator responsible for alerts, incidents, billing drift, and
   release decisions.
4. Define the number and identity of initial beta accounts.
5. Decide whether deterministic output is customer-visible fallback behavior or
   operator-only acceptance behavior.
6. Approve when research, AI Discovery, or AI Strategy may be evaluated for a
   later beta phase.
7. Approve a separate staging service and its recurring hosting cost.

No setting in this document authorizes a production configuration change.
