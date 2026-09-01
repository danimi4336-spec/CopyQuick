# Unified Production Operations Status V1

`npm run operations:status` provides one bounded, sanitized snapshot for
incident triage. It inspects the live database read-only and reports:

- migration compatibility and pending migration count;
- SQLite quick check, disk-capacity classification, and verified local backup state;
- encrypted off-site backup freshness and scheduler state;
- Stripe reconciliation enablement, last success/failure, drift, and unresolved issues;
- the durable generation emergency-control mode; and
- counts of Production jobs requiring recovery, failed jobs, and skipped jobs.

The overall status is deterministic: exit `0` is healthy, `1` is warning, and
`2` is critical or unavailable. A deliberate generation pause is a warning;
invalid control state is critical. Any recovery-required Production job,
incompatible migration state, critical storage/backup condition, failed billing
reconciliation, or unresolved billing issue is critical. Historical terminal
Production failures remain visible as counts but do not keep the system unhealthy
forever after their accounting has been safely resolved.

The command never calls Stripe, R2, Resend, or an AI provider. It does not expose
database paths, customer identities, prompts, generated content, Stripe IDs,
secrets, or raw exceptions. `/healthz` remains the same minimal readiness probe;
this command is an operator diagnostic, not a public health dependency.
