const assert = require('assert');
const {
  SIGNUP_PASSWORD_MIN_LENGTH,
  validateLoginInput,
  validateSignupInput
} = require('../lib/authProtection');
const { validateNewPassword } = require('../lib/passwordRecovery');

assert.strictEqual(SIGNUP_PASSWORD_MIN_LENGTH, 8);
assert.strictEqual(validateSignupInput({ name: 'Owner', email: 'owner@example.com', password: '1234567' }).ok, false);
assert.strictEqual(validateSignupInput({ name: 'Owner', email: 'owner@example.com', password: '12345678' }).ok, true);
assert.strictEqual(validateNewPassword('1234567'), false);
assert.strictEqual(validateNewPassword('12345678'), true);
assert.strictEqual(
  validateLoginInput({ email: 'legacy@example.com', password: 'old' }).ok,
  true,
  'existing accounts with legacy short passwords must still be able to authenticate'
);

const signupView = require('fs').readFileSync(require.resolve('../views/signup.ejs'), 'utf8');
assert.match(signupView, /minlength="8"/);
assert.match(signupView, /maxlength="1024"/);

console.log('Story 3.39 password policy tests passed');
