# Generation Abuse Protection V1

CopyQuick applies one bounded per-user burst budget to authenticated actions that
can create generation or Production work:

- `POST /dashboard/generate`
- `POST /generation/:id/regenerate`
- `POST /production/start`
- `POST /production/:id/run-next`

The default budget is 12 actions per 60 seconds. Configure it with
`AI_ACTION_RATE_LIMIT_PER_WINDOW` and `AI_ACTION_RATE_LIMIT_WINDOW_MS`.
Invalid, zero, or negative values fall back to the safe defaults.
The window must remain between 10 seconds and 1 hour, and the action allowance
cannot exceed 100 per window. Values outside those safety bounds also fall back
to the defaults so configuration cannot silently disable abuse and cost
containment.

Rejected requests return HTTP `429`, a bounded `Retry-After` header, and the
normalized code `GENERATION_RATE_LIMITED`. Rejection happens before generation,
usage accounting, idempotency-ledger creation, Production initialization, or
provider invocation. Automated Production-worker cycles are not rate-limited;
their concurrency, retry, and lease controls remain authoritative.

The limiter is intentionally process-local and memory-bounded. CopyQuick's
database runtime ownership lock permits only one active application revision to
open the SQLite database, so a distributed limiter would add infrastructure
without improving the current deployment model. Buckets expire automatically
and are never persisted as customer or billing state.

Rate-limit events contain only a request ID and normalized code. They do not log
user IDs, IP addresses, request bodies, prompts, or provider payloads.
