# Stripe Billing Reconciliation Runbook

Stripe is CopyQuick's billing authority. SQLite stores the operational subscription and current entitlement needed by the application; signed webhooks normally keep that state synchronized. Reconciliation detects and, only with explicit authorization, repairs local drift after missed or incomplete webhook delivery.

CopyQuick currently uses Stripe Node SDK `22.2.2` without an application-level `apiVersion` override, so the Stripe account's configured API version governs returned subscription fields. The policy validates every required field before mutation and fails closed if that contract is incomplete.

## Entitlement policy

- `active` and `trialing`: entitled to the recognized Stripe price's CopyQuick plan.
- `past_due`: retains paid entitlement for 72 hours only when CopyQuick has an authoritative Stripe event timestamp establishing when the transition was observed. If that timestamp is unavailable, reconciliation fails closed and records `STRIPE_PAST_DUE_SINCE_UNKNOWN` instead of inventing a grace period.
- `unpaid`, `incomplete`, `incomplete_expired`, `paused`, `canceled`, and deleted subscriptions: not entitled.
- Unknown statuses, unknown prices, incomplete records, and customer/subscription mismatches are unresolved issues and never grant or upgrade access.

The webhook path and reconciliation service use the same policy in `lib/billingEntitlement.js`. Validation completes before either the subscription row or user entitlement is changed.

## Commands

Read the latest sanitized operational summary:

```sh
npm run billing:status
```

Inspect drift without repairing subscription or entitlement state:

```sh
npm run billing:reconcile -- --dry-run
```

Apply reviewed local repairs explicitly:

```sh
npm run billing:reconcile -- --apply
```

Invoking the reconciliation command without exactly one mode is rejected. Commands never print customer email, raw Stripe objects, secrets, payment data, or filesystem paths. Reconciliation never changes Stripe-side subscriptions, invoices, refunds, usage events, usage periods, generations, or production jobs.

## Scheduler

The in-process scheduler is disabled by default and starts only after schema compatibility and SQLite runtime initialization.

```env
STRIPE_RECONCILIATION_ENABLED=false
STRIPE_RECONCILIATION_INTERVAL_HOURS=24
STRIPE_PAST_DUE_GRACE_HOURS=72
```

When enabled, it runs an apply reconciliation no more than once per configured interval. Due time is calculated only from the latest successfully completed apply run; a dry-run never postpones an automated apply. Manual and scheduled operations share a leased cross-process lock. Stripe outages are recorded as sanitized failures and do not fail `/healthz` or crash the web service.

## Normalized issues

Important codes include `STRIPE_API_UNAVAILABLE`, `STRIPE_SUBSCRIPTION_MISSING`, `STRIPE_PRICE_UNKNOWN`, `STRIPE_STATUS_UNKNOWN`, `STRIPE_RECORD_INCOMPLETE`, `STRIPE_PAST_DUE_SINCE_UNKNOWN`, `LOCAL_SUBSCRIPTION_MISSING`, `LOCAL_ENTITLEMENT_DRIFT`, `CUSTOMER_SUBSCRIPTION_MISMATCH`, `RECONCILIATION_LOCKED`, and `RECONCILIATION_FAILED`.

## Schema and rollback

Schema v2 adds `subscriptions.past_due_since` and sanitized reconciliation run/issue tables. It does not rewrite business rows. Although the physical migration is additive, the v1 application does not recognize a v2 migration ledger and will correctly refuse startup. Application rollback is therefore not database rollback; use a v2-aware application revision or the deliberate disaster-recovery procedure, never an automatic database restore.

## Safe first production rollout

Do not enable scheduled reconciliation during the initial deployment.

1. Verify local and off-site backup health.
2. Create a fresh verified backup.
3. Run `npm run migrations:status` and review the pending v2 migration.
4. Put the service into the documented migration maintenance/offline state.
5. Run the explicit `npm run migrate:database` command.
6. Require `npm run migrations:check` to succeed.
7. Deploy Story 3.20 with `STRIPE_RECONCILIATION_ENABLED=false`.
8. Verify startup and the minimal `/healthz` response.
9. Run `npm run billing:status`.
10. Run `npm run billing:reconcile -- --dry-run` only.
11. Review every proposed repair and unresolved issue against Stripe.
12. Obtain explicit operator approval.
13. Run one `npm run billing:reconcile -- --apply`.
14. Re-run dry-run and require zero unexplained drift.
15. Monitor signed webhooks and billing status.
16. Only then consider enabling the 24-hour scheduler.

If reconciliation fails, preserve the database, keep scheduling disabled, inspect the normalized failure, and retry only after the Stripe/configuration problem is understood. Never restore a backup solely because billing reconciliation reports drift.
