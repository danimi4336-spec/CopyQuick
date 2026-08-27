# CopyQuick Encrypted Off-Site Backup Runbook

CopyQuick off-site backups are optional and disabled by default. The service first creates or verifies a Story 3.13 SQLite snapshot, encrypts it locally with AES-256-GCM, and uploads only the encrypted `.cqbackup` artifact to private S3-compatible object storage.

The S3 client requires Node.js 20 or newer. Confirm the Render service runtime satisfies the `package.json` engine before deployment.

## Configuration

Set these secrets and environment values in Render:

```text
OFFSITE_BACKUP_ENABLED=true
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

## Scheduling decision

V1 intentionally does not add an in-process timer. A timer tied to web-process restarts is not a durable scheduler, and a separate Render cron service cannot access the web service's attached local disk. Schedule the operator command through a controlled mechanism that executes inside the web service environment, or run it manually daily until CopyQuick has shared durable database storage or a supported job-control plane.

Do not start overlapping manual local and off-site backup commands. The in-process Story 3.13 guard does not coordinate separate Render Shell processes.

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

Current limitations: scheduling is operator-managed, encrypted artifacts are built in process memory in V1, no automatic production restore exists, and local SQLite remains single-instance. Off-site storage protects against persistent-disk loss only when verified backups remain fresh and encryption keys remain recoverable.
