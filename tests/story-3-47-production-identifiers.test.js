const assert = require('assert');
const { parsePositiveIntegerId } = require('../lib/httpIdentifiers');

for (const [input, expected] of [['1', 1], ['47', 47], [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) {
  assert.strictEqual(parsePositiveIntegerId(input), expected);
}
for (const invalid of [
  1, '', '0', '-1', '+1', '01', '1abc', '1.0', ' 1', '1 ',
  String(Number.MAX_SAFE_INTEGER + 1), null, undefined
]) {
  assert.strictEqual(parsePositiveIntegerId(invalid), null);
}

const productionRoutes = require('fs').readFileSync(require.resolve('../routes/production'), 'utf8');
assert.strictEqual((productionRoutes.match(/parsePositiveIntegerId\(req\.params\.id\)/g) || []).length, 3);
assert.doesNotMatch(productionRoutes, /parseInt\(req\.params\.id/);
console.log('Story 3.47 canonical production identifier tests passed');
