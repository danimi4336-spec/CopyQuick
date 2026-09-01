const assert = require('assert');

process.env.GOOGLE_CLIENT_ID = 'story-3-41-client';
process.env.GOOGLE_CLIENT_SECRET = 'story-3-41-secret';
const passport = require('../lib/passport');
const { getVerifiedGoogleEmail } = passport;

assert.strictEqual(getVerifiedGoogleEmail({
  emails: [{ value: '  Owner@Example.COM ', verified: true }]
}), 'owner@example.com');

assert.strictEqual(getVerifiedGoogleEmail({
  emails: [{ value: 'Owner@Example.com' }],
  _json: { email_verified: true }
}), 'owner@example.com');

for (const profile of [
  {},
  { emails: [{ value: 'owner@example.com' }] },
  { emails: [{ value: 'owner@example.com', verified: false }], _json: { email_verified: false } },
  { emails: [{ value: 'not-an-email', verified: true }] },
  { emails: [{ value: 'owner@example.com\r\nattacker@example.com', verified: true }] }
]) {
  assert.throws(() => getVerifiedGoogleEmail(profile), error => error.code === 'GOOGLE_EMAIL_UNVERIFIED');
}

const source = require('fs').readFileSync(require.resolve('../lib/passport'), 'utf8');
assert.match(source, /const email = getVerifiedGoogleEmail\(profile\)/);
assert(!source.includes('profile.emails[0].value'));

console.log('Story 3.41 OAuth identity integrity tests passed');
