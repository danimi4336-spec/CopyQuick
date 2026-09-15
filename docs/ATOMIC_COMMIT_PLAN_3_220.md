# Story 3.220 — Atomic Commit Preparation

## Purpose and authorization boundary

This plan prepares the reviewed Stories 3.194–3.219 working tree for atomic
commits. It does not authorize staging, committing, pushing, merging, deploying,
migrating production, accessing production data, or changing protected runtime
configuration.

The current implementation is cross-cutting. Several central files contain
inseparable behavior from multiple stories, so splitting one file by story would
create fragile intermediate states. The safest sequence uses three coherent
commits, each with its own tests and with schema/code/test coupling preserved.

## Commit 1 — Functional release candidate

Proposed message:

`feat: complete trustworthy guided production workflows`

Scope:

- Discovery, Reflection, Strategy, and Build Plan improvements.
- Physical-product maturity planning and the Get More Customers workflow.
- Planning-foundation versus ready-asset policy and affordable batching.
- OpenAI adapters, evaluation, provenance, revision, and prompt-context safety.
- Saved plans, migrations 5–7, durable production identity and progress.
- Production recovery, history, pagination, resume behavior, and Story 3.218
  restart dependency reconciliation.
- All runtime presentation and navigation required by those behaviors.
- Provider-isolated acceptance and migration-rehearsal tooling.

Include:

- `.env.example`, `package.json`
- `db/migrations.js`
- `docs/AI_PROVIDER_RUNTIME.md`
- all modified and new files under `lib/`
- `scripts/evaluate-ai-production.js`, `scripts/rehearse-migration-v7.js`
- `server.js`
- modified `routes/builder.js`, `routes/discovery.js`,
  `routes/generations.js`, `routes/pricing.js`, `routes/production.js`
- `public/css/style.css`
- all modified files under `views/` and new `views/production-history.ejs`
- all modified pre-existing tests currently shown by `git status --short`
- new tests for Stories 3.194–3.214, 3.216, and 3.218

Exclude:

- `.gitignore`
- `docs/RELEASE_CANDIDATE_3_194_3_217.md`
- `docs/RELEASE_CHANGESET_REVIEW_3_219.md`
- `docs/ATOMIC_COMMIT_PLAN_3_220.md`
- tests for Stories 3.217, 3.219, and 3.220

Required gate after staging and before commit:

1. Confirm the staged diff contains no `.env`, database, database sidecar,
   runtime-lock directory, backup-health state, credential, or user data.
2. Run all staged story tests through Story 3.218 except documentation-only
   Stories 3.217 and 3.219.
3. Run the complete repository suite from the proposed staged tree.
4. Run syntax checks and `git diff --cached --check`.
5. Confirm migrations 5–7 and their reader/writer modules are staged together.

## Commit 2 — Release operations package

Proposed message:

`docs: assemble release candidate operations package`

Include:

- `.gitignore`
- `docs/RELEASE_CANDIDATE_3_194_3_217.md`
- `tests/story-3-217-release-candidate-assembly.test.js`

This commit records local-artifact exclusions, migration and rollback order,
provider-isolated browser evidence, Story 3.218 recovery acceptance, and the
release gates. Its filename remains historical, but its heading and contents
cover Stories 3.194–3.218.

Required gate:

- Story 3.217 test passes.
- Every listed local artifact is ignored.
- No secret or runtime artifact is staged.
- `git diff --cached --check` passes.

## Commit 3 — Review and commit-preparation evidence

Proposed message:

`docs: record release review and atomic commit plan`

Include:

- `docs/RELEASE_CHANGESET_REVIEW_3_219.md`
- `docs/ATOMIC_COMMIT_PLAN_3_220.md`
- `tests/story-3-219-release-change-set-review.test.js`
- `tests/story-3-220-atomic-commit-preparation.test.js`

Required gate:

- Stories 3.219 and 3.220 tests pass.
- The complete repository suite passes.
- `git diff --cached --check` passes.
- `git status --short` contains no unexplained remaining source file.

## Why three commits instead of the earlier six

- `routes/discovery.js` simultaneously wires objective behavior, AI Strategy,
  batching, saved plans, and production handoff.
- `lib/productionContracts.js` simultaneously provides maturity-aware planning,
  acquisition contracts, AI schemas, and quality presentation boundaries.
- `lib/productionExecution.js` simultaneously carries provider provenance,
  cancellation, billing reversal, saved-plan lifecycle, and restart recovery.
- `db/migrations.js` must remain coupled to saved-plan readers, production-plan
  snapshot writers, migration gates, and rehearsal tests.
- Shared EJS views present the integrated contract and cannot be meaningfully
  assigned to only one story without staging partial templates.

A larger functional commit is less risky than constructing intermediate commits
that compile but violate runtime or migration invariants.

## Staging safeguards

When explicit commit approval is later provided:

- capture the pre-staging `git status --short`;
- stage only explicit paths, never `git add .`;
- inspect `git diff --cached --stat` and `git diff --cached`;
- run the gate for that group before committing;
- confirm the unstaged remainder exactly matches the next groups;
- never use reset, checkout, clean, or another destructive Git operation;
- stop if unrelated user work appears or a file cannot be assigned safely.

## Current verification baseline

- Node 24.20.0
- Story 3.219 review contract passed
- Complete suite passed: 193/193 test files
- Post-preparation complete suite passed: 194/194 test files
- `git diff --check` passed
- Story 3.218 localhost recovery acceptance passed
- No critical or high-severity review finding remains open

## Story 3.220 acceptance

- [x] Commit boundaries preserve runtime and schema coherence.
- [x] Every current changed source category has exactly one proposed destination.
- [x] Shared-file and hunk-staging risks are explicitly identified.
- [x] Tests and validation gates are defined for every commit.
- [x] Secret, runtime-artifact, and user-data exclusions are explicit.
- [x] No file was staged and no commit or external operation was performed.

After explicit approval and successful execution of this plan, the next product
story is Story 3.221, Shared Objective Framework.
