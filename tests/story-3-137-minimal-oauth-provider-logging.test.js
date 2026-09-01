const assert = require('assert');
const fs = require('fs');
const path = require('path');

const passportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'passport.js'), 'utf8');
const authSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');

assert.doesNotMatch(passportSource, /console\.(?:log|info|warn|error)/);
assert.match(authSource, /event: 'auth_google_callback_failed'/);
assert.match(authSource, /code: 'GOOGLE_AUTHENTICATION_FAILED'/);
assert.match(authSource, /requestId: req\.requestId/);

console.log('Story 3.137 minimal OAuth provider logging tests passed');
