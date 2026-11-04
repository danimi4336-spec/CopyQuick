const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const layout = read('views/layout.ejs');
const history = read('views/history.ejs');
const generation = read('views/generation.ejs');
const css = read('public/css/style.css');

assert.match(layout, /name="viewport" content="width=device-width, initial-scale=1\.0"/);
assert.doesNotMatch(layout, /user-scalable=no|maximum-scale=1\.0/);
assert.match(layout, /class="skip-link" href="#main-content"/);
assert.match(layout, /<main id="main-content"/);
assert.match(layout, /tabindex="-1">/);

assert.match(layout, /id="sidebarToggle"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/);
assert.match(layout, /setAttribute\('aria-expanded'/);
assert.match(layout, /event\.key === 'Escape'/);
assert.match(layout, /firstLink\.focus\(\)/);
assert.match(layout, /toggle\.focus\(\)/);
assert.strictEqual((layout.match(/aria-current="page"/g) || []).length, 7);
assert.strictEqual((layout.match(/class="sidebar-icon" aria-hidden="true"/g) || []).length, 7);

for (const id of ['history-search', 'history-type', 'history-sort', 'history-favorite']) {
  assert.match(history, new RegExp(`<label class="sr-only" for="${id}">`));
  assert.match(history, new RegExp(`id="${id}"`));
}
assert.match(history, /class="search-icon" aria-hidden="true"/);
assert.match(generation, /<label class="sr-only" for="tagInput">Tags<\/label>/);

assert.match(css, /\.skip-link:focus\s*\{[^}]*transform: translateY\(0\)/s);
assert.match(css, /\.sr-only\s*\{[^}]*position: absolute[^}]*clip: rect\(0, 0, 0, 0\)/s);
assert.match(css, /\*:focus-visible\s*\{[^}]*outline: 3px solid #312e81 !important/s);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: \.01ms !important/);
assert.match(css, /transition-duration: \.01ms !important/);

const authenticated = ejs.render(layout, {
  title: 'History - CopyQuick',
  body: '<h1>History</h1>',
  csrfToken: 'test-csrf',
  currentPage: 'history',
  user: { name: 'Test User' },
  locals: { user: { name: 'Test User' } }
});
assert.match(authenticated, /id="sidebarToggle"[^>]*aria-expanded="false"/);
assert.strictEqual((authenticated.match(/aria-current="page"/g) || []).length, 1);
assert.match(authenticated, /href="\/history"[^>]*aria-current="page"/);
assert.match(authenticated, /<main id="main-content"[^>]*>\s*<h1>History<\/h1>/);

const publicPage = ejs.render(layout, {
  title: 'CopyQuick',
  body: '<h1>Welcome</h1>',
  csrfToken: 'test-csrf',
  currentPage: 'home',
  user: null,
  locals: { user: null }
});
assert.doesNotMatch(publicPage, /id="sidebarToggle"|id="sidebar"/);
assert.match(publicPage, /<main id="main-content"[^>]*>\s*<h1>Welcome<\/h1>/);

console.log('Story 3.265 accessibility foundation tests passed');
