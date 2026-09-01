# Generation Request Idempotency

CopyQuick's browser generation and regeneration actions attach a unique request key. The server binds that key to the authenticated user, operation, and a SHA-256 hash of normalized inputs before generation begins.

The additive v3 migration creates `generation_requests`. It stores request identity and lifecycle metadata only; raw prompts and generated output are not duplicated in the ledger.

## Behavior

- The first request claims its key as `in_progress` before generation.
- Generation persistence, usage charging, and marking the request `completed` occur in one SQLite transaction.
- A completed replay returns the existing generation and performs no provider work or usage mutation.
- Reusing a key with different inputs is rejected.
- Concurrent or interrupted `in_progress` requests fail closed. They are never automatically retried because external provider completion may be ambiguous.
- Known failed requests remain failed; the customer starts a new request with a new key.
- Legacy clients without a key remain compatible, while all first-party browser forms supply one. Malformed supplied keys are rejected.

Production runs retain their existing independent plan-fingerprint idempotency mechanism.

## Rollout

Schema v3 is additive, but v2 application code must not run after its ledger is recorded. Follow the established offline migration procedure: stop the old application and workers, run the explicit verified-backup migration command, verify migration status/checks, and then deploy the v3-aware application. Do not roll application code back to a v2-only revision after migration.
