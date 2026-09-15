const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const release = fs.readFileSync(path.join(root, 'docs', 'RELEASE_CANDIDATE_3_194_3_217.md'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(release, /## Database deployment order/);
assert.match(release, /## Rollback constraint/);
assert.match(release, /rollbackCompatible: false/);
assert.match(release, /COPYQUICK_EXECUTION_MODE=acceptance/);
assert.match(release, /Story 3\.215 was exercised in Chrome/);
assert.match(release, /npm run rehearse:migration-v7/);
assert.match(release, /No commits are created by this document/);
assert.match(release, /Commit, push, merge, migration, and deployment receive separate authorization/);
assert.strictEqual(packageJson.scripts['rehearse:migration-v7'], 'node scripts/rehearse-migration-v7.js');

for (const localArtifact of [
  '.env.save',
  '*.db.runtime-lock/',
  'db/.backup-health-alert-state.json',
  'db/.operational-health-alert-state.json'
]) {
  assert(gitignore.split(/\r?\n/).includes(localArtifact), `${localArtifact} must remain local`);
}

console.log('Story 3.217 Release Candidate Assembly tests passed');
