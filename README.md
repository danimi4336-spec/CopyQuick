# CopyQuick

CopyQuick is an evidence-aware marketing planning and production application. It guides an authenticated customer from business discovery through strategy and a dependency-ordered Build Plan, then produces, validates, stores, and exports selected deliverables.

## Current status

CopyQuick is suitable for controlled production use. The application, schema-v8 persistence layer, billing controls, recovery paths, backups, and operational health checks are implemented and covered by 258 isolated test files. Broad public-launch work remains, including controlled release-environment browser acceptance across every objective, broader accessibility review, staging verification of public metadata, and product-language polish.

See [Project Status](docs/PROJECT_STATUS.md) for the current capability and readiness summary.

## Supported objectives

- Launch a New Product
- Get More Customers
- Increase Conversion Rates
- Improve Search Rankings
- Build My Brand
- Promote My Service
- Validate My Idea

Each available objective has registered Discovery, Strategy, Build Plan, Production, validation, presentation, persistence, and deterministic acceptance policies.

## Main capabilities

- Email/password and Google authentication, including password recovery
- Brand Brain and offer-scoped Business Memory
- Adaptive Discovery, read-only summaries, Reflection, Strategy, and saved Build Plans
- Dependency-ordered Production with retries, recovery, history, favorites, and TXT/Markdown exports
- Deterministic provider isolation and optional bounded OpenAI/Exa research paths
- Stripe subscriptions, webhook handling, portal access, and reconciliation
- Transactional email through Resend
- SQLite schema migrations, integrity checks, local and encrypted off-site backups
- Liveness, readiness, health, operational-status, and graceful-shutdown controls

## Local development

### Requirements

- Node.js `24.20.0` exactly
- npm included with Node 24

The version is pinned in `.node-version`, `.nvmrc`, `package.json`, Render configuration, and the VS Code workspace. `.npmrc` rejects incompatible Node versions.

```bash
node --version
npm ci
cp .env.example .env
npm start
```

`node --version` must print `v24.20.0`. The default local URL is `http://localhost:3000`.

Local development defaults to deterministic generation. Real providers remain disabled unless explicitly configured in the protected runtime environment. Never commit `.env` or provider credentials.

## Testing

```bash
npm test
```

The repository runner discovers every `tests/*.test.js` file, removes inherited database and persistent-storage settings, and creates a private disposable SQLite database for each test process. Tests fail closed if isolated storage ownership cannot be proven.

Run selected test files through the same isolation boundary:

```bash
node scripts/run-tests.js tests/story-3-259-read-only-discovery-summary.test.js
```

Do not invoke individual test files directly and never point tests at local or production application storage.

## Continuous integration

GitHub Actions runs on pushes and pull requests to `next-gen`:

1. install with Node `24.20.0` and `npm ci`;
2. audit production dependencies;
3. validate JavaScript syntax and whitespace;
4. run the complete isolated repository suite.

CI uses deterministic providers and has no production credentials.

## Operations

Useful read-only checks:

```bash
npm run migrations:status
npm run migrations:check
npm run operations:status
npm run health:storage
npm run release:check
```

Health endpoints:

- `/livez` — process liveness
- `/readyz` — database readiness
- `/healthz` — database health

Production mutations—including migrations, billing reconciliation with `--apply`, recovery actions, provider execution, and deployment—require explicit authorization and the relevant runbook.

### Site traffic

Schema migration 9 adds first-party visitor counts. Set `TRAFFIC_OWNER_USER_ID` to your numeric CopyQuick account ID in the service environment. To look up your ID, run this read-only query in the Render shell with your own sign-in email:

```sh
sqlite3 -readonly "$DATABASE_PATH" "SELECT id FROM users WHERE email = 'your-login@example.com' COLLATE NOCASE;"
```

After the normal migration and release, sign in to that account and open **Site traffic** in the sidebar or visit `/admin/traffic`. Copy the invitation URL from the report. It uses `?ref=email-invite`. Previously sent untagged links cannot identify email traffic.

The totals cover the period since tracking began. Each browser with JavaScript and local storage counts once per origin. Opening a tagged link adds the browser to the email subset even if it previously arrived directly. Reloading the page or reopening an invitation leaves the counts unchanged. Clearing browser data or using a different device can count someone again. The tracker skips hidden pages until viewed and respects Do Not Track and Global Privacy Control.

## Documentation

- [Project Status](docs/PROJECT_STATUS.md)
- [Autonomous Completion Progress](docs/AUTONOMOUS_COMPLETION_PROGRESS.md)
- [Deployment Readiness](docs/DEPLOYMENT_READINESS_AUDIT.md)
- [Database Backup and Recovery](docs/DATABASE_BACKUP_RECOVERY_RUNBOOK.md)
- [Off-site Backups](docs/OFFSITE_BACKUP_RUNBOOK.md)
- [Billing Reconciliation](docs/BILLING_RECONCILIATION_RUNBOOK.md)
- [Production Recovery](docs/PRODUCTION_RECOVERY_OPERATIONS.md)
- [AI Provider Runtime](docs/AI_PROVIDER_RUNTIME.md)
- [Browser Security](docs/BROWSER_SECURITY.md)

## Deployment

The production service is defined in `render.yaml` and pins Node `24.20.0`. A successful CI run is evidence for a commit, not authorization to deploy it. Follow the deployment-readiness runbook and verify backups, schema compatibility, operational status, billing health, and post-cutover acceptance before declaring a release accepted.
