# Promote My Service Provider Reliability — 2026-11-04

## Verdict

The available evidence does not demonstrate an application defect, but the
sample remains too small to establish a dependable provider success rate.

Across the three preserved `service_page` observations:

- Passing validation and quality: 2
- Safely rejected by customer-readiness validation: 1
- Observed pass proportion: 66.7%
- Observed safe-rejection proportion: 33.3%

These proportions describe only the observed calls and must not be treated as
population reliability estimates.

## New bounded evaluation

- Provider: OpenAI
- Model: `gpt-5.4-mini`
- Fixture: sanitized Promote My Service acceptance fixture
- Contract: `service_page`
- Calls: 1
- Revisions: 0
- Web Search/research calls: 0
- Validation: passed
- Customer-readiness quality: passed
- Public sections: 2
- Public word count: 372
- Duration: 4,829 ms
- Estimated provider cost: $0.00304875
- Database, Production, generation, usage, Business Memory, and customer-credit
  mutations: 0

The evaluation emitted no prompt, raw provider output, fixture content,
dependency payload, credential, or customer data.

## Historical observations included

The 2026-10-27 seven-objective gate recorded one safe `service_page` rejection.
A separately authorized identical one-call diagnostic evaluation passed. The
new 2026-11-04 call also passed.

The failed output was not retained as public content, and the quality gate was
not weakened. Because an identical input has produced both a safe rejection and
passes, provider-output variability remains the most plausible explanation.

## Limitations and next decision

A planned three-call continuation was not executed because the available
authorization boundary was enforced as one additional paid call. No workaround
was attempted.

A future statistically useful sample requires explicit owner approval for the
exact call count and aggregate cost ceiling. Until then:

- retain the current fail-closed quality rules;
- retain safe rule-level diagnostics;
- do not claim a stable success rate;
- treat the contract as operationally variable under the tested model; and
- consider provider/model or prompt changes only if a larger approved sample
  reveals a repeated, rule-specific failure pattern.
