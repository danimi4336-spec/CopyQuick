const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const expected = '24.20.0';
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');
const nodeVersion = fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim();
const renderSource = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');

assert.strictEqual(nodeVersion, expected);
assert.strictEqual(packageJson.engines.node, expected);
assert.strictEqual(packageLock.packages[''].engines.node, expected);
assert.match(renderSource, /- key: NODE_VERSION\s+value: 24\.20\.0/);
assert.strictEqual(process.version, `v${expected}`, 'repository tests must run under the pinned Node release');
assert.strictEqual(process.versions.modules, '137', 'better-sqlite3 must use the pinned Node ABI');

console.log('Story 3.172 Exact Node Runtime tests passed');
