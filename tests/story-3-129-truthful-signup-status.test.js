const assert = require('assert');
const {
  isDuplicateSignupError
} = require('../routes/auth');

assert.strictEqual(isDuplicateSignupError({ code: 'SQLITE_CONSTRAINT_UNIQUE' }), true);
assert.strictEqual(isDuplicateSignupError({ code: 'SQLITE_CONSTRAINT_NOTNULL' }), false);
assert.strictEqual(isDuplicateSignupError({ code: 'SQLITE_IOERR' }), false);
assert.strictEqual(isDuplicateSignupError(null), false);

console.log('Story 3.129 truthful signup status tests passed');
