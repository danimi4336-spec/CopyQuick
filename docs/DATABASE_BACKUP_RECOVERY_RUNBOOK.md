# CopyQuick Database Backup and Recovery Runbook

CopyQuick V1 uses one SQLite database on the Render persistent disk. Backups are SQLite-consistent snapshots created with the SQLite backup API; never copy the live `.db` file with `cp` while the service is running.

## Create and inspect backups

From the Render Shell, with `DATABASE_PATH=/var/data/copyquick.db` and `PERSISTENT_DATA_DIR=/var/data` configured:

```sh
npm run backup:database
npm run health:storage
```

The backup command writes a temporary snapshot beneath `/var/data/backups`, independently runs `PRAGMA quick_check`, checks the expected CopyQuick schema, then atomically promotes it. A zero exit code means the backup was verified. Filenames sort chronologically. `health:storage` reports the recognized backup count and most recent independently verified backup time without exposing database contents or filesystem paths.

Production also runs an independent hourly Backup Health Watcher. With
`BACKUP_HEALTH_ALERTS_ENABLED=true`, a valid `BACKUP_ALERT_EMAIL`, and Resend
configured, it sends deduplicated operator alerts for database integrity,
critical capacity, local backup availability, and encrypted off-site backup
conditions. Reminders default to every 24 hours and one optional recovery
notice follows a previously delivered alert. Private durable alert state
prevents deployment/restart notification storms.

Backups default to seven retained files. Cleanup recognizes only `copyquick-YYYY-MM-DDTHHMMSSZ[-N].db`; it never deletes unrelated files or the live database.

The single-instance web service runs the Story 3.15 off-site backup scheduler.
Its timer is only a wake-up mechanism: durable backup state determines when a
backup is due after restart. A separate Render cron service still cannot share
this service's local persistent disk. Manual backup commands remain available
for controlled operator use and share the same backup-operation lease.

## Restore production safely

Restore is intentionally offline and never runs at startup.

1. Identify the newest verified backup with `npm run health:storage` and the backup command logs.
2. Stop the Render web service. Do not merely close a browser session.
3. Confirm no CopyQuick Node process is using the database.
4. Run:

```sh
npm run restore:database -- --source /var/data/backups/copyquick-YYYY-MM-DDTHHMMSSZ.db --confirm-application-stopped --confirm-production-restore
```

5. The utility verifies the source, creates and verifies a safety backup of the current database, restores through a temporary SQLite database, quarantines stale WAL/SHM files, and atomically replaces the main database.
6. Restart the service.
7. Confirm startup integrity checks pass, then run `npm run health:storage`.
8. Verify login, usage state, production runs, and that the worker resumes queued work without repeating completed work.

The runtime owner marker deliberately refuses restoration while the application process is active. It uses a process-instance identity plus a short heartbeat lease so an unclean restart can recover a dead owner without confusing a reused PID for the old application. Never delete the marker to bypass that protection while Node is running.

Normal deploys acquire ownership atomically. A genuinely live second CopyQuick process is rejected; a dead marker is quarantined and replaced. Cross-instance ownership is treated as active while its heartbeat is fresh, so restore and deploy coordination remain conservative.

## Integrity and low-space incidents

If `quick_check` fails, stop production writes and investigate. Do not automatically restore: an operator must select the correct recovery point and accept the rollback explicitly. Preserve the corrupt database for diagnosis when space permits.

Storage status is:

- `healthy`: above both warning thresholds.
- `warning`: at or below 1 GiB free or 20% free.
- `critical`: at or below 512 MiB free or 10% free, or database integrity/readability fails.

An unavailable or unwritable backup directory is also critical. A writable
directory without a valid independently verified backup is warning. These
states affect the `health:storage` exit code and operational alert policy.

Render probes `GET /healthz`, which is intentionally limited to process and
minimal SQLite readiness. It does not run `quick_check`, inspect backups, or
contact R2. Do not make stale backups fail readiness; use the watcher and
`npm run health:storage` for detailed diagnostics.

Thresholds are configurable through the documented environment variables. Low space never causes application data deletion. Only expired, recognized backup files are eligible for retention cleanup.

While CopyQuick is running, never manually delete or replace:

- `/var/data/copyquick.db`
- `/var/data/copyquick.db-wal`
- `/var/data/copyquick.db-shm`
- `/var/data/copyquick.db.runtime-lock`

Backup files contain production user data. Keep `/var/data/backups` private; never serve it through Express or download it through entrepreneur-facing routes.

## Failure behavior and limitations

- An unavailable directory, disk-full error, SQLite busy error, permission error, or failed verification makes the backup command fail non-zero. A partial temporary file is never promoted.
- Retention runs only after a verified backup is promoted. Cleanup failure leaves the newest backup intact and is reported separately.
- A corrupt backup is rejected before the live database is changed.
- An interrupted restore retains the verified pre-restore safety backup. Inspect the database and auxiliary files before retrying.
- A confirmed corrupt live production database should be taken offline rather than allowed to continue mutating.

The Render persistent disk protects data across supported deploys and restarts, but it is not a complete backup or disaster-recovery system. Backups stored on the same `/var/data` disk protect against logical database damage and some operator mistakes; they do **not** protect against loss of the entire Render persistent disk. Off-disk encrypted backups and tested recovery objectives are the next durability step.

Story 3.17 will provide isolated off-site restore drills. Until then, continue
the deliberate offline production restore workflow; `/healthz` is not evidence
that a backup is restorable.

SQLite persistent disk remains a single-instance architecture. Do not horizontally scale the web service and do not add a separate Render worker that expects to share this disk. Shared durable storage such as PostgreSQL is required before multi-instance deployment.
