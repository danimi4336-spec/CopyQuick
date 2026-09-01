const assert = require('assert');
const { MAX_HISTORY_PAGE, parseHistoryPage } = require('../lib/generationMetadata');

assert.strictEqual(parseHistoryPage(undefined), 1);
assert.strictEqual(parseHistoryPage('1'), 1);
assert.strictEqual(parseHistoryPage('42'), 42);
assert.strictEqual(parseHistoryPage(String(MAX_HISTORY_PAGE + 500)), MAX_HISTORY_PAGE);
for (const invalid of [0, '0', '-1', '+1', '01', '1abc', '1.5', {}, String(Number.MAX_SAFE_INTEGER + 1)]) {
  assert.strictEqual(parseHistoryPage(invalid), 1);
}

const routes = require('fs').readFileSync(require.resolve('../routes/generations'), 'utf8');
assert.match(routes, /router\.param\('id'/);
assert.match(routes, /parsePositiveIntegerId\(value\)/);
assert.match(routes, /const page = parseHistoryPage\(req\.query\.page\)/);
console.log('Story 3.49 canonical generation navigation tests passed');
