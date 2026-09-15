# CopyQuick Deployment Readiness Audit

## Decision

The repository is prepared for a controlled staging release, but this document
does not authorize deployment or production-data access. A production release
remains gated on operator-supplied configuration, the migration/rollback
procedure, and external-provider verification in staging.

## Automated release gate

Run `npm run release:check` inside the intended deployment environment. The
command reports only stable finding codes and descriptions; it never prints
configuration values or secrets. A non-zero exit means a release blocker is
present.

The gate verifies the exact Node runtime, production mode, a strong session
secret, durable database placement, canonical HTTPS origin, billing and email
configuration, complete-or-disabled OAuth configuration, AI provider selection,
and recommended backup, alerting, and billing-reconciliation controls.

## Configuration and security findings

- Sessions are stored in SQLite, use `HttpOnly`, `Secure` in production,
  `SameSite=Lax`, and a 24-hour expiry. Production fails closed without a
  session secret; the release gate additionally requires at least 32 characters.
- Browser responses disable framework disclosure and set CSP, frame, MIME,
  referrer, permissions, and HSTS protections. TLS termination must preserve the
  trusted proxy protocol so secure cookies and HSTS are applied correctly.
- State-changing browser routes use session-bound CSRF tokens. Stripe webhooks
  are deliberately outside browser CSRF and instead require the raw signed body.
- Authentication, contact, generation, billing-provider, and production-worker
  work have bounded abuse/concurrency controls covered by regression tests.
- Operational logs use stable event and failure codes. Prompts, provider
  responses, credentials, and raw customer payloads are excluded.

## Database, migration, backup, and rollback

- Production requires `DATABASE_PATH` beneath `PERSISTENT_DATA_DIR`; startup
  acquires one runtime ownership lock and refuses unsafe concurrent access.
- Startup never applies pending migrations implicitly. Check status, take and
  verify a backup, then run the explicit migration command while HTTP admission
  is stopped.
- Migration v7 is additive but rollback-incompatible. Rollback requires stopping
  all application instances and restoring the verified pre-migration backup;
  an older binary must never open the v7 database.
- Local and encrypted off-site backup creation, bounded retention, restore
  verification, health alerts, and scheduler shutdown are automated and tested.
  Production bucket access and alert delivery still require staging credentials.

## Billing, OAuth, email, and AI providers

- Stripe startup validates the live key, signed-webhook secret, distinct price
  identifiers, canonical return origin, bounded client retries, customer
  ownership, checkout intent binding, webhook idempotency, and reconciliation.
- Google OAuth is optional. If enabled, all three client ID, client secret, and
  HTTPS callback settings must be supplied and the deployed callback must match
  the provider console exactly.
- Transactional email is mandatory in production and uses bounded attempts,
  total timeouts, idempotency, privacy-safe password reset behavior, and graceful
  shutdown draining.
- Live OpenAI generation is explicit, uses strict structured output, `store:
  false`, bounded time/concurrency/payload limits, sanitized errors, contract and
  quality validation, and a pseudonymous safety identifier when configured.
  Acceptance mode always forces the deterministic provider.

## Health, startup, restart, and recovery

- `/livez` is process liveness and does not touch storage.
- `/readyz` verifies a database query and returns only `ok` or `unavailable`.
- `/healthz` remains a backward-compatible database readiness alias.
- Startup is migration-gated and failure-atomic. Shutdown closes HTTP admission,
  drains bounded background work, and releases the database lock.
- Saved-plan state, production snapshots, job dependencies, and eligible waiting
  work survive restart and are reconciled idempotently.

## Required operator gates before production

1. Run `npm run release:check` in the protected staging/production environment.
2. Confirm `/livez` and `/readyz` behind the real TLS proxy and health monitor.
3. Exercise Google callback, email delivery, Stripe test-mode checkout/portal,
   signed webhook replay/idempotency, and reconciliation with staging credentials.
4. Rehearse backup, v7 migration, application restart, and restore using a
   disposable copy of the intended production topology.
5. Approve provider/model, privacy terms, concurrency, and spend limits; run a
   bounded fabricated-input live-AI qualification.
6. Record rollback owner, backup identifier, maintenance window, and go/no-go
   authority before deployment.

These remaining gates require deployment credentials or an authorized staging
environment. They are operational prerequisites, not unresolved repository
defects.
