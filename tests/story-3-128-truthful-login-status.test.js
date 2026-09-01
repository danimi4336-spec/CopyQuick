const assert = require('assert');
const fs = require('fs');
const path = require('path');

const authRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');

assert.match(authRoute, /loginLimiter\.recordFailure\(req\);[\s\S]*?res\.status\(401\)\.render\('login'/);
assert.match(authRoute, /catch \(err\) \{[\s\S]*?console\.error\('Login failed\.'\);[\s\S]*?res\.status\(500\)\.render\('login'/);
assert.match(authRoute, /const passwordHash = user\?\.password_hash \|\| DUMMY_PASSWORD_HASH/);
assert.match(authRoute, /await bcryptApi\.compare\(password, passwordHash\)/);

console.log('Story 3.128 truthful login status tests passed');
