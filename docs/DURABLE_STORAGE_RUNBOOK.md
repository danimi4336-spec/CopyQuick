# CopyQuick V1 Durable SQLite Storage

CopyQuick V1 uses one SQLite database for users, sessions, generations, billing and usage records, and production state. The web application and in-process Production Worker share that same database connection. This architecture supports one Render web-service instance only.

## Deployment sequence

1. Keep the Render workspace on Hobby if desired.
2. Use Starter web-service compute or higher. `render.yaml` declares `plan: starter`.
3. Before deploying the Story 3.12 code or changing the database path, decide whether data in the currently deployed ephemeral database must be retained.
4. If existing data matters, create and export an explicit SQLite-safe backup while the old instance and database are still accessible. Store that backup outside the ephemeral service before proceeding. Do not assume attaching a disk migrates it.
5. In the Render dashboard, attach one persistent disk to the existing `copyquick` web service. Do not create a separate worker service.
6. Use mount path `/var/data` and an initial size of 5 GB.
7. If migrating existing data, place the reviewed source backup where the migration command can read it and run the one-time utility before starting CopyQuick against the target path:

   ```sh
   npm run migrate:sqlite-storage -- --source /explicit/reviewed-backup.db --destination /var/data/copyquick.db
   ```

   The utility refuses to overwrite the destination, uses SQLite's backup API for WAL safety, runs `PRAGMA quick_check`, and compares per-table row counts. If no existing data needs migration, leave the target absent so CopyQuick can initialize it explicitly.
8. Set `DATABASE_PATH=/var/data/copyquick.db`.
9. Set `PERSISTENT_DATA_DIR=/var/data`.
10. Deploy the application. Do not deploy the production guard before the disk and environment variables are ready, because startup will intentionally fail.
11. Verify startup diagnostics report `persistent-production`, `/var/data/copyquick.db`, and `writable: yes`.
12. Confirm whether startup reused an existing database or initialized a new one. A new database message does not mean old ephemeral data was migrated.
13. Create a controlled verification user/state and a queued production run. Record its identifiers and usage-event count.
14. Restart or redeploy the service.
15. Confirm the user, session as applicable, generation/usage state, and production run still exist.
16. Confirm the Production Worker resumes the same queued run or safely recovers an expired claim.
17. Confirm completed jobs were not regenerated and the production-start usage event was not duplicated.

## Existing ephemeral data

Attaching `/var/data` does not move the old `db/copyquick.db`. If the current deployment contains data that must survive, it requires an explicit backup/migration before switching `DATABASE_PATH`. If the old file is no longer accessible after a Render restart or deploy, application code cannot recover it.

Never point production at the new path and assume an empty database represents a successful migration. The server will initialize a missing target safely, but it will clearly state that no automatic migration occurred.

## Operational constraints

- Do not horizontally scale CopyQuick while it uses service-local SQLite storage.
- Do not create a separate Render worker service. It cannot share this web service's local persistent disk.
- Keep the database, WAL, and shared-memory files together beneath `/var/data` by configuring the main database there.
- Persistent disk protects data across supported service restarts and deploys; it is not a complete disaster-recovery strategy.
- Review Render snapshot and backup capabilities separately and test restoration procedures.
- PostgreSQL or another shared durable datastore is the future path for multiple web instances or a separate worker architecture.

## Verification and diagnostics

Production startup fails instead of falling back when `DATABASE_PATH` is missing, outside `PERSISTENT_DATA_DIR`, missing its parent mount, or cannot write to the parent directory. Path validation is a configuration guard; it cannot prove that Render physically mounted durable storage. Operational restart/redeploy testing is still required.

For an offline integrity check, stop writers and run SQLite tooling against an explicit backup or use the migration utility, which performs `PRAGMA quick_check`. Never copy only the main database file while WAL writes may be active.
