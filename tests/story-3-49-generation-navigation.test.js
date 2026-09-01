const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const { MAX_HISTORY_PAGE, buildPaginationPages, parseHistoryPage } = require('../lib/generationMetadata');

assert.strictEqual(parseHistoryPage(undefined), 1);
assert.strictEqual(parseHistoryPage('1'), 1);
assert.strictEqual(parseHistoryPage('42'), 42);
assert.strictEqual(parseHistoryPage(String(MAX_HISTORY_PAGE + 500)), MAX_HISTORY_PAGE);
for (const invalid of [0, '0', '-1', '+1', '01', '1abc', '1.5', {}, String(Number.MAX_SAFE_INTEGER + 1)]) {
  assert.strictEqual(parseHistoryPage(invalid), 1);
}
assert.deepStrictEqual(buildPaginationPages(0, 1), []);
assert.deepStrictEqual(buildPaginationPages(4, 2), [1, 2, 3, 4]);
assert.deepStrictEqual(buildPaginationPages(1000, 500), [1, 498, 499, 500, 501, 502, 1000]);
assert(buildPaginationPages(1000000, 999999).length <= 7);

const routes = require('fs').readFileSync(require.resolve('../routes/generations'), 'utf8');
assert.match(routes, /router\.param\('id'/);
assert.match(routes, /parsePositiveIntegerId\(value\)/);
assert.strictEqual((routes.match(/const requestedPage = parseHistoryPage\(req\.query\.page\)/g) || []).length, 2);
assert.match(routes, /favorite = 1 AND is_deleted = 0[\s\S]+LIMIT \? OFFSET \?/);

const generation = {
  id: 1, content_type: 'social_post', title: 'Bounded favorite', input_text: 'Safe preview',
  tone: 'professional', word_count: 10, created_at: '2026-08-31T00:00:00.000Z', favorite: 1
};
const paginationPages = buildPaginationPages(1000, 500);
const favoriteHtml = ejs.render(fs.readFileSync(path.join(__dirname, '..', 'views', 'favorites.ejs'), 'utf8'), {
  generations: [generation], total: 20000, totalPages: 1000, page: 500, paginationPages
});
assert.strictEqual((favoriteHtml.match(/<a href="\?page=/g) || []).length, 7);
const historyHtml = ejs.render(fs.readFileSync(path.join(__dirname, '..', 'views', 'history.ejs'), 'utf8'), {
  generations: [generation], total: 20000, totalPages: 1000, page: 500, paginationPages,
  search: '', type: '', sort: 'newest', favorite: '', language: '', contentTypes: { social_post: 'Social Post' }
});
assert.strictEqual((historyHtml.match(/<a href="\?page=/g) || []).length, 7);
console.log('Story 3.49 canonical generation navigation tests passed');
