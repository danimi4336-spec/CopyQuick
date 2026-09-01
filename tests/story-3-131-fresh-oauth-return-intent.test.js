const assert = require('assert');
const fs = require('fs');
const path = require('path');

const authRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');

assert.match(authRoute, /const returnTo = normalizeAuthReturnPath\(req\.query\.next\);\s*if \(returnTo\) req\.session\.authReturnTo = returnTo;\s*else delete req\.session\.authReturnTo;/);
assert.match(authRoute, /if \(!passport\.isGoogleOAuthConfigured\(\)\) \{\s*if \(req\.session\) delete req\.session\.authReturnTo;/);
assert.match(authRoute, /if \(err\) \{\s*if \(req\.session\) delete req\.session\.authReturnTo;/);
assert.match(authRoute, /if \(!user\) \{\s*if \(req\.session\) delete req\.session\.authReturnTo;/);
assert.match(authRoute, /const returnTo = normalizeAuthReturnPath\(req\.session\?\.authReturnTo\)/);

console.log('Story 3.131 fresh OAuth return intent tests passed');
