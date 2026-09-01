const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'views', 'layout.ejs'), 'utf8');

assert.match(server, /app\.get\('\/blog',[\s\S]*?res\.redirect\(302, '\/about'\)/);
assert.doesNotMatch(layout, /href="\/blog"/);
assert.strictEqual(fs.existsSync(path.join(root, 'views', 'blog.ejs')), false);

for (const claim of [
  '10 proven AI prompts', 'rank higher and sell more', 'increase open rates',
  'Facebook Ads That Actually Convert', '20 templates to post engaging content every single day'
]) {
  assert.doesNotMatch(server + layout, new RegExp(claim, 'i'));
}

console.log('Story 3.99 Truthful Resource Surface tests passed');
