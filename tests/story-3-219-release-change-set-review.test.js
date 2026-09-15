const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const review = fs.readFileSync(path.join(root, 'docs', 'RELEASE_CHANGESET_REVIEW_3_219.md'), 'utf8');
const candidate = fs.readFileSync(path.join(root, 'docs', 'RELEASE_CANDIDATE_3_194_3_217.md'), 'utf8');

for (const requiredSection of [
  '## Change inventory and ownership',
  '## Boundary review',
  '### Authentication and ownership',
  '### Credits and billing',
  '### AI and internal context',
  '### Migration and recovery',
  '## Remaining release risks',
  '## Verification evidence',
  '## Story 3.219 acceptance'
]) {
  assert(review.includes(requiredSection), `review must retain ${requiredSection}`);
}

assert.match(review, /No critical or high-severity release defect was found/);
assert.match(review, /No commit, push, merge, deployment, or production operation was performed/);
assert.match(review, /Pre-review complete suite: 192\/192 test files passed after Story 3\.218/);
assert.match(review, /Post-review complete suite: 193\/193 test files passed/);
assert.match(candidate, /Stories 3\.194–3\.218/);
assert.match(candidate, /Story 3\.218 was exercised against an existing localhost production run/);
assert.match(candidate, /192\/192 test files passed after Story 3\.218/);

console.log('Story 3.219 Release Change-Set Review tests passed');
