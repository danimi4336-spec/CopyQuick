const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const plan = fs.readFileSync(path.join(root, 'docs', 'ATOMIC_COMMIT_PLAN_3_220.md'), 'utf8');
const candidate = fs.readFileSync(path.join(root, 'docs', 'RELEASE_CANDIDATE_3_194_3_217.md'), 'utf8');

for (const heading of [
  '## Commit 1 — Functional release candidate',
  '## Commit 2 — Release operations package',
  '## Commit 3 — Review and commit-preparation evidence',
  '## Why three commits instead of the earlier six',
  '## Staging safeguards',
  '## Story 3.220 acceptance'
]) {
  assert(plan.includes(heading), `atomic commit plan must retain ${heading}`);
}

for (const coupledBoundary of [
  'routes/discovery.js',
  'lib/productionContracts.js',
  'lib/productionExecution.js',
  'db/migrations.js'
]) {
  assert(plan.includes(`\`${coupledBoundary}\``), `${coupledBoundary} coupling must be documented`);
}

assert.match(plan, /stage only explicit paths, never `git add \.`/);
assert.match(plan, /No file was staged and no commit or external operation was performed/);
assert.match(plan, /Post-preparation complete suite passed: 194\/194 test files/);
assert.match(plan, /Story 3\.221, Shared Objective Framework/);
assert.match(candidate, /authoritative,[\s\S]*three-commit sequence/);

console.log('Story 3.220 Atomic Commit Preparation tests passed');
