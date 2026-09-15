# CopyQuick Release Candidate: Stories 3.194–3.218

## Release decision

This change set is ready for human code review and commit preparation after the
checks below pass on the final working tree. It is not authorization to commit,
push, merge, deploy, migrate production, or access production data.

## Customer-visible scope

- Evidence-disciplined idea-stage and physical-product planning.
- Affordable phased production and maturity-aware output selection.
- Optional OpenAI-backed Discovery, Strategy, and production generation.
- Contract validation, quality revision, provenance, and prompt-context boundaries.
- Durable saved-plan recovery, failed-job recovery, and cross-batch progress.
- Production-plan history, filtering, pagination, resume navigation, and stable identity.
- Acceptance-isolated deterministic generation for safe localhost/browser testing.

## Release acceptance evidence

### Automated

- Pinned runtime: Node 24.20.0.
- Complete repository suite: 192/192 test files passed after Story 3.218.
- Story 3.216's disposable migration rehearsal verifies v6 backup, v7 migration,
  restart, one-time application, business-row preservation, and restoration to v6.
- Syntax checks and `git diff --check` pass.

### Browser

Story 3.215 was exercised in Chrome against a disposable schema-v7 database
with `COPYQUICK_EXECUTION_MODE=acceptance`. A deliberately configured fake
OpenAI provider was overridden; startup reported deterministic isolation.

Verified behavior:

- production history renders ten records per page;
- page 3 renders the remaining three of 23 synthetic owner records;
- active, needs-attention, and completed filters render isolated result sets;
- a historical production run opens without restarting or charging work;
- a run belonging to another synthetic user returns 404;
- a legacy run without a v7 snapshot uses the generic `Product Launch Plan`
  fallback and reports current-batch progress rather than inventing plan progress;
- persisted plan name `Acceptance Plan 23` survives application restart;
- the authenticated history session survives restart through durable session storage;
- `/healthz` returns `{"status":"ok"}`;
- the acceptance server shuts down cleanly.

Story 3.218 was exercised against an existing localhost production run that had
stalled at 3 of 5 jobs after a process restart. Restart reconciliation queued the
eligible dependent work, the run completed at 5 of 5, and no additional
production credits were consumed.

Only fabricated `example.test` users and disposable database paths were used.
No production data or live AI request was involved.

## Database deployment order

1. Stop HTTP admission and all workers; confirm shutdown has drained.
2. Confirm the intended application artifact and Node 24.20.0 runtime.
3. Run the read-only migration status and compatibility checks.
4. Create and verify the mandatory database backup.
5. Run the explicit database migration command.
6. Confirm schema version 7 with zero pending migrations.
7. Start exactly one application instance and confirm the runtime lock.
8. Verify `/healthz`, startup diagnostics, and production-provider mode.
9. Verify an existing legacy run and a new snapshot-backed run.
10. Resume normal traffic only after operational checks pass.

The application does not perform pending migrations implicitly at startup.

## Rollback constraint

Migration v7 is additive but marked `rollbackCompatible: false`. An older build
must not be started against a schema-v7 database. Rollback requires:

1. stop every application instance;
2. explicitly select the verified pre-migration backup;
3. run the offline restore procedure with the required confirmations;
4. verify SQLite integrity and restored schema version;
5. deploy the matching older application artifact;
6. verify health before reopening traffic.

Restoring a v6 backup intentionally removes data written after that backup.
Operators must make that tradeoff explicitly; there is no automatic downgrade.

## Provider activation and acceptance isolation

- Standard mode preserves explicit `AI_PROVIDER` selection.
- `COPYQUICK_EXECUTION_MODE=acceptance` always forces the deterministic engine,
  including when a parent environment or `.env` enables OpenAI.
- Unsupported execution modes stop startup with a sanitized configuration code.
- Live AI evaluation remains opt-in and must use fabricated, approved input.
- Credentials belong only in protected runtime configuration and must never be committed.

## Known compatibility behavior

- Pre-v7 runs without a trustworthy saved-plan match show batch-only progress
  and a safe generic identity.
- New v7 runs store a bounded plan identity and selected-deliverable snapshot;
  they do not persist generation prompts or complete Strategy context there.
- Production-history pages are bounded to ten runs. Query performance should be
  monitored as real history volume grows.

## Repository hygiene

The following remain local and ignored:

- `.env.save`
- `db/.backup-health-alert-state.json`
- `db/.operational-health-alert-state.json`
- `*.db.runtime-lock/`
- SQLite databases and sidecars

Before committing, review `git status --short` and confirm every remaining file
is source, test, documentation, or an intentional static asset.

## Proposed atomic commit sequence

No commits are created by this document. Story 3.220 found that the earlier
six-way proposal would require unsafe hunk-level staging across tightly coupled
routes, contracts, migrations, and execution modules. The authoritative,
test-preserving three-commit sequence is documented in
`docs/ATOMIC_COMMIT_PLAN_3_220.md`.

Do not split a schema change from the code that reads it or from its migration
tests. Do not stage or commit any group without explicit approval.

## Final release gates

- [ ] Human review completed for every proposed commit group.
- [ ] No unexplained modified or untracked files.
- [x] No known secret or runtime artifact is included in `git status`.
- [x] `npm test` passes under Node 24.20.0.
- [x] `npm run rehearse:migration-v7` passes.
- [x] Syntax checks and `git diff --check` pass.
- [x] Story 3.215 isolated browser matrix passes on the final candidate.
- [ ] Deployment and rollback operators acknowledge the v7 restore requirement.
- [ ] Provider mode and spend controls are explicitly approved.
- [ ] Commit, push, merge, migration, and deployment receive separate authorization.
