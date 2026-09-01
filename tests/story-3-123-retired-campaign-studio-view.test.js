const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const builderRoute = fs.readFileSync(path.join(root, 'routes', 'builder.js'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'views', 'layout.ejs'), 'utf8');

assert.strictEqual(fs.existsSync(path.join(root, 'views', 'campaign-studio.ejs')), false);
assert.match(builderRoute, /router\.get\('\/campaign-studio', requireAuth/);
assert.match(builderRoute, /res\.redirect\('\/welcome\?goal=launch_product'\)/);
assert.doesNotMatch(builderRoute, /render\(['"]campaign-studio/);
assert.doesNotMatch(layout, /href="\/campaign-studio"/);

console.log('Story 3.123 retired campaign studio view tests passed');
