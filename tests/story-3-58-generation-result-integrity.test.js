const assert = require('assert');
const { parseStoredGenerationResults } = require('../lib/generationResults');

const valid = [{ text: 'Customer-ready copy', tone: 'professional' }];
assert.deepStrictEqual(parseStoredGenerationResults(JSON.stringify(valid)), valid);
assert.deepStrictEqual(parseStoredGenerationResults('[]'), []);
for (const invalid of [null, '{malformed', '{}', '[null]', '[{"text":"Missing tone"}]', '[["nested"]]']) {
  assert.strictEqual(parseStoredGenerationResults(invalid), null);
}

console.log('Story 3.58 generation result integrity tests passed');
