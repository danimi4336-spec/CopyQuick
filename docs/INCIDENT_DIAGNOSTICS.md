# Incident Diagnostics V1

CopyQuick assigns a server-generated UUID to every HTTP request and returns it
in the `X-Request-ID` response header. Error responses produced by the global
handler also show the reference in HTML or return it as `requestId` in JSON.
Inbound request-ID headers are not trusted or reused.

Operational events are structured JSON with an explicit allowlist. They may
contain request IDs, normalized error codes, HTTP method/route/status/duration,
provider operation names, and internal production run/job IDs. They never
include raw URLs or query strings, prompts, provider payloads, customer names or
email addresses, raw exceptions, secrets, or database paths. Health checks and
static assets do not emit completion events, preventing routine probes from
overwhelming useful diagnostics. `/healthz` retains its minimal response body.

Provider events executed during an HTTP request inherit its request ID. Provider
events executed by the Production worker carry the durable production run and
job IDs instead. The durable `production_job_events` ledger remains the source
of truth for job lifecycle history; log correlation complements it and does not
replace recovery or accounting state.

## Incident procedure

1. Ask the customer for the CopyQuick error reference or capture the
   `X-Request-ID` header.
2. Locate `http_request_failed` and `http_request_completed` events with that
   request ID.
3. Use only the normalized `code`, route, status, and timing to identify the
   failing subsystem.
4. For Production work, correlate `productionRunId` and `productionJobId` with
   the local job/event ledger using approved operator access. Do not paste raw
   customer data or provider payloads into logs.
5. Treat a missing correlation event as an observability failure; do not guess
   at customer data or retry ambiguous provider work outside the established
   recovery flow.

This V1 uses the existing Render log stream. It does not add a telemetry vendor,
distributed tracing backend, production-data exporter, or `/healthz` dependency.
