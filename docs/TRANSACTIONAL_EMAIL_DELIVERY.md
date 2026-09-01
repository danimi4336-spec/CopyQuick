# Transactional Email Delivery Integrity V1

The contact form reports success only after the support notification has been
accepted by Resend. Missing provider configuration and exhausted provider
failures return a contained error; CopyQuick no longer tells a customer that a
message was sent when email delivery is disabled.

Each admin notification and customer acknowledgement receives a distinct
provider idempotency key. Transient failures are retried up to three times by
default with bounded exponential backoff, always using the same key so an
ambiguous retry cannot intentionally create duplicate mail. Permanent provider
rejections are not retried. Each provider attempt also has a fixed duration
bound; a timeout is treated as an unavailable provider and retried with the
same idempotency key. The same controls protect password-reset delivery.
Configure the bounds with:

- `EMAIL_DELIVERY_MAX_ATTEMPTS` (default `3`, maximum `5`)
- `EMAIL_DELIVERY_RETRY_BASE_MS` (default `250`, maximum `10000`)
- `EMAIL_DELIVERY_TIMEOUT_MS` (default `10000`, maximum `60000`)
- `EMAIL_DELIVERY_TOTAL_TIMEOUT_MS` (default `35000`, maximum `60000`)
- `EMAIL_DELIVERY_DRAIN_TIMEOUT_MS` (default `15000`, valid range `1`–`60000`)

The total timeout is authoritative across provider attempts and exponential
backoff. Each attempt is capped by the remaining budget, and CopyQuick does not
start a retry when its backoff would cross the deadline. This prevents otherwise
valid individual settings from combining into a multi-minute customer request.

During graceful shutdown, CopyQuick stops accepting new HTTP requests first.
It lets active requests finish, then drains password-reset delivery so a reset
request that was already in flight cannot be lost between request completion
and process exit. The email drain is bounded by
`EMAIL_DELIVERY_DRAIN_TIMEOUT_MS`. Active HTTP requests have a separate
`HTTP_SHUTDOWN_TIMEOUT_MS` bound (default `25000`, valid range
`1000`–`120000`); connections still open at that boundary are closed so the
SQLite runtime lock can be released. These in-process drains protect planned
deploys and SIGTERM shutdowns; they are not a durable queue and cannot recover
mail interrupted by an abrupt process or host failure.

The support notification is authoritative. If it succeeds but the customer
acknowledgement exhausts retries, the contact submission remains successful and
the partial failure is emitted for operators. Events contain only
`contact_admin` or `contact_reply` plus normalized delivery codes; they never
include recipients, subjects, messages, provider errors, IP addresses, or API
keys.

V1 deliberately does not persist contact-form PII for deferred retry. Adding a
durable outbox would require an explicit retention, encryption, deletion, and
operator-access policy. Operational alerts continue using their existing
domain-specific deduplication and retry behavior.
