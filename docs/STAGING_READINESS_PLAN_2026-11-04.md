# Staging Readiness Plan — 2026-11-04

## Current blocker

Repository configuration defines one Render web service named `copyquick`. No
separate staging service or preview environment is represented in `render.yaml`,
and no verified non-production deployment target is documented.

Creating a new hosted service, attaching storage, or adding paid infrastructure
requires owner authorization. The current `next-gen` branch runs CI and does not
auto-deploy.

## Required staging properties

A useful staging target must be technically separate from production:

- separate Render service and URL;
- separate SQLite persistent disk and backup prefix;
- separate session secret and safety-identifier secret;
- Stripe test-mode key, webhook secret, prices, customers, and portal state;
- controlled Resend recipient/domain configuration;
- separate Google OAuth callback registration;
- no production customer records or copied production database;
- deterministic provider mode by default;
- live-provider evaluation enabled only for separately authorized bounded work;
- explicit noindex response policy; and
- independently observable logs, health, billing, and recovery state.

## First staging deployment gate

1. Owner approves the service and recurring cost.
2. Create isolated storage and secrets without copying production data.
3. Deploy the exact approved `next-gen` commit.
4. Confirm Node `v24.20.0`, schema v8, zero pending migrations, and a newly
   initialized staging database.
5. Verify `/livez`, `/readyz`, and `/healthz` repeatedly.
6. Verify `robots.txt`, sitemap, canonical URLs, social preview, and private-page
   noindex behavior.
7. Run the bookkeeping terminology check through Strategy and Build Plan.
8. Execute the seven-objective browser matrix with dedicated staging accounts.
9. Execute Stripe test-mode and controlled email/authentication gates.
10. Compare database, usage, credit, Business Memory, and provider counters.

## Production boundary

Staging acceptance does not authorize production deployment. After staging
passes, freeze an exact release-candidate commit, record CI evidence, verify
backup/rollback readiness, and obtain separate production authorization.
