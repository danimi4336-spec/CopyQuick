const assert = require('assert');
const fs = require('fs');
const path = require('path');

const views = path.join(__dirname, '..', 'views');
const index = fs.readFileSync(path.join(views, 'index.ejs'), 'utf8');
const layout = fs.readFileSync(path.join(views, 'layout.ejs'), 'utf8');

assert.match(index, /href="#demo-preview"[^>]*>See the Workflow ↓<\/a>/);
assert.doesNotMatch(index, />[^<]*Watch Demo<\/a>/);

assert.doesNotMatch(layout, /href="#" aria-label="(?:Twitter|LinkedIn|GitHub)"/);
assert.doesNotMatch(layout, /class="footer-social"/);
assert.doesNotMatch(layout, /href="\/blog"/);

console.log('Story 3.82 Public Navigation Integrity tests passed');
