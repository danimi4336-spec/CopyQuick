# Generation Emergency Controls V1

CopyQuick has a durable operator pause switch for generation intake and provider
spend. Its state is stored beside SQLite on the existing persistent disk and is
read dynamically, so an operator can stop new work without a deploy or database
change:

```sh
npm run generation:control -- --status
npm run generation:control -- --pause
npm run generation:control -- --resume
```

Pause blocks dashboard generation, regeneration, Production initialization,
manual Production execution, background worker cycles, and provider invocation.
Existing generations, queued jobs, billing, backups, authentication, ordinary
reads, and `/healthz` remain available. A cycle already inside a provider call is
allowed to reach its existing bounded timeout; no new provider call can begin.

The state file contains only a version, mode, and update timestamp. It defaults
to `.generation-control-state.json` beside the configured database; production
rejects an override outside `PERSISTENT_DATA_DIR`. Missing state means running.
Malformed or unreadable state fails closed and pauses generation. Updates use an
atomic rename with owner-only file permissions.

After an incident, inspect sanitized provider and worker events, correct the
underlying cause, verify status, then use the explicit `--resume` action. The
control does not cancel jobs, change usage accounting, edit production runs, or
modify `/healthz`.
