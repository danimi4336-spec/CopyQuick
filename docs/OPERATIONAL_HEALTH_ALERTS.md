# Proactive Billing & Production Health Alerts V1

CopyQuick can proactively notify operators about the two non-backup conditions
that require human intervention:

- failed or unresolved Stripe entitlement reconciliation; and
- Production jobs held in `recovery_required` after an ambiguous provider result.

Enable this watcher explicitly:

```text
OPERATIONAL_HEALTH_ALERTS_ENABLED=true
OPERATIONAL_ALERT_EMAIL=<private operator recipient>
OPERATIONAL_ALERT_REMINDER_HOURS=24
OPERATIONAL_RECOVERY_NOTIFICATIONS_ENABLED=true
```

It defaults off. The watcher starts only after migration compatibility, runtime
database initialization, HTTP startup, the Production worker, and billing
scheduler initialization. It evaluates hourly after a three-minute startup
grace, never calls Stripe or an AI provider, never blocks `/healthz`, prevents
overlapping evaluations, and drains on shutdown.

Alert state is stored atomically as `.operational-health-alert-state.json` on
the existing persistent disk with owner-only permissions. First alerts,
reminders, escalation, failed-delivery retry delay, restart deduplication, and
one-time recovery notices use the established durable condition-watcher policy.
The separate backup alert state and policy remain unchanged.

Notifications contain only normalized condition IDs, severity, environment,
timestamps, safe descriptions, and runbook actions. They contain no customer
identity, Stripe identifiers, prompts, generations, raw errors, database paths,
or secrets. Historical terminal Production failures do not alert; only ambiguous
work that still needs safe operator resolution does.
