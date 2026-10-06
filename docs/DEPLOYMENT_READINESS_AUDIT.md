# CopyQuick Controlled-Beta Release Runbook

This is the authoritative procedure for the schema-v8 controlled-beta release.
It does not authorize a deployment, migration, restore, provider call, or
production-data change. Record every operator assertion in the release record;
never record credentials, database contents, or recovery keys.

## Compatibility and ownership

The current application supports schema v8. Production may begin at v2 and
therefore has six ordered, individually transactional migrations: generation
request idempotency (v3), checkout intents (v4), saved build plans (v5),
20-character saved-plan state (v6), production-plan progress snapshots (v7),
and structured business memory (v8). Each migration commits separately. A
failure rolls back the failing migration but can leave earlier migrations
recorded as a valid intermediate schema.

Record before the maintenance window:

- `PRE_RELEASE_COMMIT`
- `PRE_MIGRATION_SCHEMA`
- `PRE_MIGRATION_BACKUP_ID`
- deployment owner
- migration owner
- rollback owner
- backup/restore owner and recovery-key custodian
- go/no-go authority

| Application | Database | Decision |
|---|---|---|
| Recorded pre-release application | v2 | Supported before release |
| Approved v8 application | v2 | Fail closed with `MIGRATION_REQUIRED` |
| Approved v8 application | v8 | Supported |
| Recorded pre-release application | v8 | Prohibited; restore its paired backup first |

## Hard preflight gates

Do not migrate or deploy unless every item passes:

1. Freeze the approved commit and confirm Node v24.20.0.
2. Confirm one Render web instance and no worker sharing the SQLite disk.
3. Establish a quiet window: no active paid Production job, no ambiguous
   provider operation, and all application/database writers can be excluded.
4. Assign every owner listed above.
5. Inspect the **ACTUAL Render start command**. An existing service can retain a
   dashboard override even when `render.yaml` is safe. It must be exactly
   `node server.js`; automatic migration in web start must be `NO`.
6. If it contains `migrate`, correct the dashboard override and perform a
   second read-only verification **before deploying anything**.
7. Require valid HTTPS `PUBLIC_APP_ORIGIN`. For the observed production domain
   the intended value is `https://www.copyquick.co`; application configuration
   remains environment-driven.
8. Verify durable database placement, sessions, Stripe live keys and distinct
   prices, live webhook registration, Resend domain/delivery, and support inbox.
9. Billing reconciliation should be enabled and healthy. A temporary controlled-
   beta waiver must record risk, owner, expiry, and the latest zero-drift result.
10. Select generation mode explicitly: `DETERMINISTIC` or `OPENAI`. Select
    research independently as `ENABLED` or `DISABLED`. OpenAI requires
    provider readiness; enabled research also requires OpenAI research and Exa.
    The observed deterministic/no-research state is a current configuration,
    not a permanent product default.

Repository `render.yaml` already has the safe `node server.js` command.
Repository configuration cannot prove that an external dashboard override is
safe.

## Read-only preflight

```sh
npm run release:check
npm run migrations:status
npm run migrations:check
npm run operations:status
npm run health:storage
```

`release:check`, `migrations:status`, and `migrations:check` are read-only.
Release readiness requires schema v8 with zero pending migrations. Before the
explicit migration, `MIGRATION_REQUIRED` is the expected blocker, not
permission to start traffic. Future or invalid schema also blocks.

## Backup gate

Before migration, create a fresh verified local snapshot with
`npm run backup:database`. Record its identifier, timestamp, schema v2 status,
and integrity result. Verify a fresh encrypted off-site backup, identify the
recovery-key custodian and backup/restore owner, and confirm the restore
procedure. Stop if an artifact is missing, stale, invalid, or lacks custody.

## Exact Gate 2B sequence

Render one-off jobs and pre-deploy commands do not mount the base web service's
persistent disk. For an offline migration of that disk, use the temporary
persistent-disk maintenance runner. It serves only a bounded plain-text `503`
response and does not import the application, open the database, start workers
or schedulers, or contact providers. Maintenance mode remains the customer-
facing traffic barrier; the runner is the disk-attached shell host.

1. Freeze the approved commit, record all owners, and announce the maintenance
   window.
2. Verify the quiet window, single-instance topology, zero active or ambiguous
   work, and complete local and off-site recovery readiness.
3. Enable Render Maintenance Mode before changing or restarting the service.
4. Change the actual Render web start command temporarily to exactly
   `npm run start:maintenance`.
5. Deploy the exact approved commit and verify the maintenance runner stays
   alive while every HTTP path returns `503` with the maintenance message.
6. Open a shell on that same disk-attached web service and reverify the commit,
   Node v24.20.0, database path, schema v2, SQLite integrity, and fresh backup
   identifiers. Do not use a one-off job or pre-deploy command.
7. Reconfirm the irreversible-action authorization and rollback owners. Stop
   here unless the migration is explicitly authorized.
8. Run the offline migration exactly once from the disk-attached shell:
   `npm run migrate:database -- --confirm-production-migration`.
9. Run `migrations:status`, `migrations:check`, and SQLite integrity checks;
   require schema v8 and zero pending migrations.
10. If migration or verification fails, keep Maintenance Mode enabled and the
    maintenance runner active, then execute the paired restore/rollback plan.
11. Restore the actual Render start command to exactly `node server.js`.
12. Deploy the same exact approved commit; do not substitute a newer commit.
13. While Maintenance Mode remains enabled, verify Node v24.20.0, `/livez`,
    `/readyz`, `/healthz`, database persistence, and the bounded smoke journey.
14. The go/no-go authority records GO only after every release criterion passes;
    otherwise keep traffic stopped and invoke rollback.
15. Disable Render Maintenance Mode only after recorded GO, then observe health,
    errors, jobs, billing, sessions, persistence, and provider behavior.

If failure occurs before migration, keep Maintenance Mode enabled, retain the
maintenance runner, and correct the precondition without touching the database.
If failure occurs after migration, do not start the pre-release application
against v8; either complete the approved release or restore the paired v2 backup
before deploying `PRE_RELEASE_COMMIT`.

Stop before migration if backup fails, active jobs remain, an owner is missing,
the Render override is unsafe, `PUBLIC_APP_ORIGIN` is invalid, recovery-key
custody is unknown, live Stripe webhook registration is unverified, or
mandatory email delivery is unverified.

## Bounded smoke test and observation

Use one authorized disposable beta account. Verify signup/login, one objective,
Discovery, Reflection, Build Plan, Production Review, one bounded Production
run, credit use, automatic Results transition, finished asset, and session
persistence. Stripe behavior follows the approved billing procedure.
Deterministic mode costs $0 in provider calls. OpenAI mode is limited to one
normal Production provider path unless separately authorized; research makes
zero calls unless explicitly enabled and budgeted.

Observe before widening access: 5xx errors, readiness, sessions, Production jobs,
`recovery_required`, billing reconciliation, duplicate billing, backups,
storage, provider failures, and research health when enabled.

GO requires the approved commit, Node v24.20.0, schema v8, zero pending
migrations, database integrity, all health endpoints, persistent storage,
sessions, canonical origin, verified live billing/webhook and required email,
explicit provider mode, a clean smoke result, tenant/security integrity, and a
recorded rollback artifact.

## Rollback

Database restore and application rollback are a pair:

1. Stop traffic and all writers.
2. Select `PRE_MIGRATION_BACKUP_ID` and confirm rollback authorization.
3. Run the offline confirmation-gated restore from the backup runbook.
4. Verify integrity and restored `PRE_MIGRATION_SCHEMA` (v2 for this release).
5. Deploy `PRE_RELEASE_COMMIT` only after its matching database is restored.
6. Verify runtime, health, login, sessions, billing, persistence, and queued work.
7. Restore traffic only after go/no-go approval.

Rollback triggers include migration/integrity failure, readiness or persistent-
storage failure, login/session failure, billing corruption or duplicate
charging, tenant/security failure, failure of core Production, provider
configuration failure that prevents the selected mode, or persistent severe
5xx errors. Copy polish and other noncritical beta issues are not by themselves
rollback triggers.
