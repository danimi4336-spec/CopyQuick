const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.strictEqual(fs.existsSync(path.join(root, 'routes', 'dashboard.js.old')), false);
assert.match(server, /require\(['"]\.\/routes\/generations['"]\)/);
assert.doesNotMatch(server, /routes\/dashboard/);

console.log('Story 3.124 repository route hygiene tests passed');
