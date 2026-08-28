# CopyQuick Encrypted Off-Site Backup Runbook

CopyQuick off-site backups are optional and disabled by default. The service first creates or verifies a Story 3.13 SQLite snapshot, encrypts it locally with AES-256-GCM, and uploads only the encrypted `.cqbackup` artifact to private S3-compatible object storage.

CopyQuick pins Node.js 24.x. Confirm the Render service runtime satisfies the
`package.json` engine before deployment.

## Configuration

Set these secrets and environment values in Render:

```text
OFFSITE_BACKUP_ENABLED=true
OFFSITE_BACKUP_SCHEDULE_ENABLED=true
OFFSITE_BACKUP_INTERVAL_HOURS=24
OFFSITE_BACKUP_ENDPOINT=<provider S3 endpoint; omit for AWS S3>
OFFSITE_BACKUP_REGION=<region>
OFFSITE_BACKUP_BUCKET=<private bucket>
OFFSITE_BACKUP_ACCESS_KEY_ID=<restricted credential>
OFFSITE_BACKUP_SECRET_ACCESS_KEY=<restricted secret>
OFFSITE_BACKUP_PREFIX=copyquick/production
OFFSITE_BACKUP_ENCRYPTION_KEY=<base64 32-byte key>
OFFSITE_BACKUP_KEY_ID=v1
OFFSITE_BACKUP_RETENTION=30
OFFSITE_BACKUP_MAX_AGE_HOURS=36
OFFSITE_BACKUP_MAX_ARTIFACT_BYTES=67108864
BACKUP_HEALTH_ALERTS_ENABLED=true
BACKUP_ALERT_EMAIL=<private operator recipient>
BACKUP_ALERT_REMINDER_HOURS=24
BACKUP_RECOVERY_NOTIFICATIONS_ENABLED=true
```

The V1 artifact limit defaults to, and is capped at, 64 MiB. Encryption and
verification can temporarily hold several copies of an artifact in memory;
this bound prevents unsafe memory growth on the 512 MiB Starter service.

Generate a key outside Render and the object-storage provider:

```sh
openssl rand -base64 32
```

Store it in a password manager or secrets vault with a separate recovery copy. Never store it in the backup bucket. Losing a key makes every artifact encrypted with that key permanently unrecoverable.

The bucket should block public access. Give the credential only object list, put, head/get, and delete permissions beneath the configured prefix. Provider-side encryption and versioning are useful additional controls, but they do not replace CopyQuick client-side encryption.

## Create and monitor

From the Render Shell:

```sh
npm run backup:offsite
npm run health:storage
```

To upload an existing verified local snapshot:

```sh
npm run backup:offsite -- --source /var/data/backups/copyquick-YYYY-MM-DDTHHMMSSZ.db
```

The explicit source must be a recognized canonical backup physically beneath the trusted backup directory. Symlinks and traversal outside that directory are rejected.

Success requires local SQLite verification, local encryption/authentication verification, upload, and a remote HEAD check matching object size, format version, key ID, and ciphertext SHA-256. Remote retention runs afterward and is independent from local retention.

Freshness status is included in `health:storage`:

- `healthy`: verified success no older than `OFFSITE_BACKUP_MAX_AGE_HOURS` (default 36 hours).
- `warning`: older than the target but no more than twice the target.
- `critical`: older than twice the target.
- `never_succeeded`: enabled without a verified remote success.
- `disabled`: off-site backups are disabled.

The health command exits non-zero for warning, critical, or never-succeeded status so external monitoring can alert operators.

## Operational alerts

The independent Backup Health Watcher evaluates complete storage health about
once per hour after a three-minute startup grace. It does not decide when to
create backups and does not depend on browser traffic. Alerting remains off
unless `BACKUP_HEALTH_ALERTS_ENABLED=true` and a valid `BACKUP_ALERT_EMAIL` is
configured. Missing email or Resend configuration is contained and never
terminates the website.

The watcher alerts on a never-successful, stale, critically stale, failed, or
repeatedly failing off-site backup; invalid off-site state; an unexpectedly
disabled production scheduler; SQLite integrity failure; critical persistent
disk capacity; an unavailable local backup directory; and a missing or invalid
local backup. Three distinct failed off-site attempts constitute repeated
failure. A verified success resets the count.

Each independent condition is stored in a private atomic state file beneath
the persistent root. The first transition sends once, severity escalation
sends once, and unresolved conditions receive at most one reminder per
`BACKUP_ALERT_REMINDER_HOURS` (24 by default). When enabled, one recovery
message is sent only if the original alert was successfully delivered.
Restarting the service reconstructs this state and does not create a fresh
alert storm.

Operator actions:

- Backup stale/failed: inspect scheduler logs and run `npm run backup:offsite`.
- Scheduler disabled: restore the approved production setting and verify startup.
- SQLite integrity failure: stop unsafe writes and follow the database recovery runbook.
- Critical capacity: inspect disk use; never delete the live database, WAL, or SHM files.
- Local backup unavailable: verify the persistent mount/permissions and run `npm run backup:database`.

Disable email delivery safely with `BACKUP_HEALTH_ALERTS_ENABLED=false`;
health inspection and `npm run health:storage` remain available.

`GET /healthz` is a separate, intentionally minimal Render readiness check. It
performs only a cheap SQLite query and returns `{"status":"ok"}`. It never
returns backup timestamps, paths, object keys, or alert state. Backup staleness
does not fail readiness because restarting CopyQuick cannot repair R2 delivery.

## Automatic scheduling

Scheduling requires both `OFFSITE_BACKUP_ENABLED=true` and
`OFFSITE_BACKUP_SCHEDULE_ENABLED=true`. The single Render web process waits
about 60 seconds after startup, then evaluates durable off-site state every
five minutes. A verified success is due again after
`OFFSITE_BACKUP_INTERVAL_HOURS` (24 by default). Missing or stale success state
causes one catch-up attempt; a failure records an eligibility time about one
hour later, preventing restart and polling storms.

The timer is only a wake-up mechanism. Durable timestamps in
`.offsite-backup-state.json` reconstruct scheduling decisions after every
deploy or restart. The scheduler is browser/session independent and ordinary
R2 failures are logged without terminating the website.

A filesystem lease beneath the private backup directory coordinates manual
local backups, manual off-site backups, and the scheduler across processes.
It uses atomic acquisition, a unique ownership token, heartbeat renewal, and
stale-owner recovery. A manual command exits safely with
`BACKUP_OPERATION_LOCKED` when another backup owns the lease. During graceful
shutdown the scheduler stops accepting work and waits a bounded interval for
an active operation. If termination interrupts it, the expiring lease permits
safe recovery later.

There is an unavoidable delivery window: R2 may accept and verify an object
immediately before the process dies, before local success state is written.
The next eligible catch-up may upload another valid object. Object naming and
retention make this safe; the system does not claim exactly-once remote upload.

## Download and recovery preparation

List/select an exact recognized object using provider operator tools, then run:

```sh
npm run backup:offsite:download -- --object copyquick/production/YYYY/MM/DD/copyquick-YYYY-MM-DDTHHMMSSZ-v1.cqbackup
```

The command verifies remote metadata and size, authenticates and decrypts locally, checks both hashes, runs SQLite `quick_check` and schema verification, and writes a restrictive local restore candidate beneath the backup recovery directory.

It never replaces production. Review the candidate and then use the Story 3.13 offline workflow:

```sh
npm run restore:database -- --source <verified-candidate.db> --confirm-application-stopped --confirm-production-restore
```

Stop the application before the final restore and follow `DATABASE_BACKUP_RECOVERY_RUNBOOK.md`.

## Key rotation

Create a new random key and change `OFFSITE_BACKUP_KEY_ID` from `v1` to `v2`. New artifacts identify `v2`; old artifacts continue to identify `v1` without containing either secret key.

For an old artifact, temporarily supply its retained recovery key through protected environment values:

```text
OFFSITE_BACKUP_DECRYPTION_KEY=<old base64 key>
OFFSITE_BACKUP_DECRYPTION_KEY_ID=v1
```

Never put encryption keys directly in command-line arguments. Retain every historical key for at least as long as remote retention can retain its artifacts.

## Failure behavior and rehearsal

Network, DNS, authentication, bucket, quota, timeout, upload, and HEAD-verification failures do not affect the verified local backup or crash normal web service operation. They record a sanitized failure code and become visible through freshness health. Remote-retention failure does not invalidate the newly verified object.

Quarterly restore rehearsal is recommended:

1. Select a recent object.
2. Prepare it in a non-production environment with the correct key.
3. Verify SQLite integrity and critical counts.
4. Restore into an isolated CopyQuick instance.
5. Confirm authentication, usage ledger, generations, production runs, and worker restart behavior.
6. Record the measured recovery time and any remediation.

For an emergency backup, run `npm run backup:offsite`. If an automatic or other
manual backup is active, wait for it to finish rather than deleting the lease.
Confirm `npm run health:storage` reports a new verified success and the next
eligible attempt. Never remove the database runtime lock or SQLite sidecars.

Current limitations: encrypted artifacts are built in process memory in V1,
remote upload is at-least-once across the narrow state-write crash window, no
automatic production restore exists, and local SQLite remains single-instance.
Off-site storage protects against persistent-disk loss only when verified
backups remain fresh and encryption keys remain recoverable.

Story 3.17 will add isolated restore verification drills. Story 3.16 alerts
confirm operational health; they do not by themselves prove end-to-end
restorability.
