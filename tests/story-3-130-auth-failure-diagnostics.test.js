const assert = require('assert');
const fs = require('fs');
const path = require('path');

const authRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');

for (const event of [
  'auth_signup_failed',
  'auth_login_failed',
  'auth_logout_failed',
  'auth_google_configuration_failed',
  'auth_google_callback_failed',
  'auth_google_callback_rejected',
  'auth_google_session_failed'
]) {
  assert.match(authRoute, new RegExp(`event: '${event}'`));
}

assert.match(authRoute, /requestId: req\.requestId/);
assert.doesNotMatch(authRoute, /console\.(?:log|warn|error)/);
assert.doesNotMatch(authRoute, /auth_login_failed[\s\S]*?Invalid email or password/);

console.log('Story 3.130 auth failure diagnostics tests passed');
