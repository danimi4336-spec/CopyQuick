# CopyQuick Staging Environment Runbook

## Purpose and boundary

`render.staging.yaml` defines a separate acceptance environment. It does not
modify the existing `copyquick` production service and it is not connected to
production data, Stripe objects, email recipients, OAuth credentials, backups,
or provider keys.

Creating the Blueprint is a billable external action. As of 2026-11-10, Render
lists the `0.5c-512mb` web-service plan at $7 per month and persistent disks at
$0.25 per GB per month, prorated. The proposed 1 GB configuration therefore has
an estimated base cost of $7.25 per month before bandwidth or other usage.
Confirm current pricing in Render immediately before creation.

## Blueprint creation

1. In Render, create a new Blueprint instance from this repository.
2. Set the Blueprint path to `render.staging.yaml`.
3. Confirm the service name is exactly `copyquick-staging` and the branch is
   exactly `next-gen`.
4. Confirm automatic deploys are off, the disk is new and mounted at
   `/var/data`, and no existing production resource is selected.
5. Supply only dedicated staging values for every `sync: false` variable.

Do not reuse production secrets or objects. In particular, use Stripe test-mode
keys, webhook secret, and test-mode price IDs; a controlled Resend key/recipient;
and a Google OAuth client whose callback is the staging URL.

## Required environment values

- `PUBLIC_APP_ORIGIN`: the exact HTTPS staging origin, with no path.
- `STRIPE_KEY`: a Stripe test-mode secret key.
- `STRIPE_WEBHOOK_SECRET`: the endpoint secret for the staging URL only.
- `STRIPE_PRO_PRICE` and `STRIPE_UNLIMITED_PRICE`: staging test-mode prices.
- `RESEND_API_KEY`: a controlled staging-capable key.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: a dedicated OAuth client.
- `GOOGLE_CALLBACK_URL`: `<PUBLIC_APP_ORIGIN>/auth/google/callback`.

The Blueprint generates independent session and AI safety secrets. It forces
deterministic acceptance generation, disables live AI/research, disables Stripe
reconciliation, disables off-site backup activity, and prevents public indexing.

## Fresh database initialization

Normal application startup deliberately refuses to create or migrate a fresh
production-mode database. Do not weaken that guard and do not permanently add a
migration command to the start command.

For the first staging initialization only:

1. Confirm the staging disk is empty and `DATABASE_PATH` is exactly
   `/var/data/copyquick-staging.db`.
2. Temporarily set the staging service start command to:

   ```bash
   node scripts/migrate-database.js --confirm-production-migration
   ```

3. Trigger one manual deploy. The web deploy is expected not to become healthy
   because the migration process exits instead of serving HTTP.
4. Inspect the migration log and require schema v8 with zero pending migrations.
5. Restore the start command to exactly `node server.js`.
6. Trigger a manual deploy of the exact approved commit.

Never run this sequence against the production service or production disk.

## Initial acceptance gate

1. Verify the live commit and Node `v24.20.0`.
2. Verify schema v8, zero pending migrations, database integrity, and the exact
   staging database path without exposing it publicly.
3. Require two consecutive HTTP 200 rounds from `/livez`, `/readyz`, and
   `/healthz`.
4. Verify `robots.txt` contains `Disallow: /`, public pages emit noindex, and
   the sitemap contains no indexable URLs.
5. Create dedicated staging users; never copy production records.
6. Run the seven-objective browser matrix and record state/counter baselines.
7. Run Stripe test-mode, controlled transactional-email, password-recovery, and
   OAuth checks with no real charge.
8. Verify desktop/mobile accessibility, exports, recovery, and ownership.
9. Stop on any unexpected external call, credit movement, cross-tenant access,
   production identifier, or data-source ambiguity.

Staging acceptance never authorizes production deployment.
