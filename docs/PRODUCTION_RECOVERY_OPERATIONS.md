# Production Recovery Operations V1

Production retries remain automatic and bounded. Permanent failures are marked
failed, dependent jobs are skipped, unused units are reversed, and every state
transition is recorded. Ambiguous provider outcomes instead enter
`recovery_required`; CopyQuick never guesses whether they are safe to retry.

Operators can inspect a bounded, PII-free summary while the service is live:

```sh
npm run production:recovery -- --status
```

Mutating recovery actions are deliberately offline. Stop the web service and
confirm its database runtime lock has been released; the command then acquires
that same lock and refuses to run if any application process still owns SQLite.
Every action requires exact internal run/job IDs and `--verified-safe`:

```sh
npm run production:recovery -- --safe-retry --run-id 12 --job-id 34 --verified-safe
npm run production:recovery -- --mark-failed --run-id 12 --job-id 34 --verified-safe
npm run production:recovery -- --mark-completed --run-id 12 --job-id 34 --generation-id 56 --verified-safe
```

Use safe retry only after establishing that no provider result exists and a new
request cannot duplicate paid work. Mark completed accepts only a generation
owned by the same user/job that passes the current customer-quality contract.
Mark failed atomically applies the existing terminal-failure, dependent-skip,
event, and usage-reversal policy.

Output contains only internal IDs, deliverable IDs, normalized codes, attempts,
statuses, and timestamps. It never includes customer identity, prompts, results,
provider payloads, or database paths. No action automatically restores data,
changes completed jobs, or rewrites historical production runs.
