const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  pageMetadataFor,
  publicIndexingEnabled,
  robotsText,
  sitemapEntries
} = require('../lib/pageMetadata');

const root = path.join(__dirname, '..');
const blueprint = fs.readFileSync(path.join(root, 'render.staging.yaml'), 'utf8');

assert.match(blueprint, /name: copyquick-staging\b/);
assert.match(blueprint, /branch: next-gen\b/);
assert.match(blueprint, /autoDeployTrigger: off\b/);
assert.match(blueprint, /plan: 0\.5c-512mb\b/);
assert.match(blueprint, /mountPath: \/var\/data\b/);
assert.match(blueprint, /sizeGB: 1\b/);
assert.match(blueprint, /value: \/var\/data\/copyquick-staging\.db\b/);
assert.match(blueprint, /key: PUBLIC_INDEXING_ENABLED\s+value: false/);
assert.match(blueprint, /key: COPYQUICK_EXECUTION_MODE\s+value: acceptance/);
assert.match(blueprint, /key: AI_PROVIDER\s+value: deterministic/);
assert.match(blueprint, /key: OPENAI_RESEARCH_ENABLED\s+value: false/);
assert.match(blueprint, /key: STRIPE_RECONCILIATION_ENABLED\s+value: false/);
assert.match(blueprint, /key: OFFSITE_BACKUP_ENABLED\s+value: false/);
assert.doesNotMatch(blueprint, /price_[A-Za-z0-9]+|sk_(?:live|test)_|whsec_|re_[A-Za-z0-9]{10,}/);
assert.doesNotMatch(blueprint, /copyquick\.db\b|copyquick\/production/);

const env = { PUBLIC_INDEXING_ENABLED: 'false' };
assert.strictEqual(publicIndexingEnabled(env), false);
const metadata = pageMetadataFor('/', {
  origin: 'https://copyquick-staging.onrender.com',
  indexingEnabled: publicIndexingEnabled(env)
});
assert.strictEqual(metadata.indexable, false);
assert.strictEqual(metadata.robots, 'noindex, nofollow, noarchive');
assert.strictEqual(robotsText({ indexingEnabled: false }), 'User-agent: *\nDisallow: /\n');
assert.deepStrictEqual(sitemapEntries({
  origin: 'https://copyquick-staging.onrender.com',
  indexingEnabled: publicIndexingEnabled(env)
}), []);

console.log('Story 3.267 staging isolation tests passed');
