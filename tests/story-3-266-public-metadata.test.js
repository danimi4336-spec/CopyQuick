const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  PUBLIC_PAGES,
  pageMetadataFor,
  sitemapEntries
} = require('../lib/pageMetadata');

const root = path.join(__dirname, '..');
const layout = fs.readFileSync(path.join(root, 'views', 'layout.ejs'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const publicPaths = ['/', '/about', '/contact', '/pricing', '/privacy', '/terms', '/cookies', '/refunds'];
assert.deepStrictEqual(Object.keys(PUBLIC_PAGES), publicPaths);

for (const publicPath of publicPaths) {
  const metadata = pageMetadataFor(publicPath, { origin: 'https://copyquick.co' });
  assert.strictEqual(metadata.indexable, true);
  assert.strictEqual(metadata.robots, 'index, follow');
  assert.strictEqual(metadata.canonicalUrl, `https://copyquick.co${publicPath === '/' ? '/' : publicPath}`);
  assert(metadata.description.length >= 50 && metadata.description.length <= 170);
  assert.strictEqual(metadata.imageUrl, 'https://copyquick.co/images/copyquick-social-card.png');

  const html = ejs.render(layout, {
    title: 'Fallback title', pageMetadata: metadata, csrfToken: '', body: '<h1>Safe</h1>',
    currentPage: '', locals: {}, user: null
  });
  assert.match(html, new RegExp(`<link rel="canonical" href="${metadata.canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(html, /<meta property="og:image" content="https:\/\/copyquick\.co\/images\/copyquick-social-card\.png">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
}

for (const privatePath of ['/dashboard', '/discovery', '/production/9', '/generation/4', '/login', '/signup']) {
  const metadata = pageMetadataFor(privatePath, { origin: 'https://copyquick.co' });
  assert.strictEqual(metadata.indexable, false);
  assert.strictEqual(metadata.canonicalUrl, undefined);
  assert.strictEqual(metadata.imageUrl, undefined);
  assert.strictEqual(metadata.robots, 'noindex, nofollow, noarchive');
}

assert.deepStrictEqual(sitemapEntries({ origin: 'https://copyquick.co' }), publicPaths.map(publicPath => `https://copyquick.co${publicPath === '/' ? '/' : publicPath}`));
assert.doesNotMatch(JSON.stringify(sitemapEntries()), /dashboard|profile|history|discovery|production|generation|billing/);
assert.match(server, /app\.get\('\/robots\.txt'/);
assert.match(server, /app\.get\('\/sitemap\.xml'/);
assert.match(server, /X-Robots-Tag/);
assert(fs.existsSync(path.join(root, 'public', 'images', 'copyquick-favicon.svg')));
assert(fs.existsSync(path.join(root, 'public', 'images', 'copyquick-social-card.png')));

console.log('Story 3.266 public metadata tests passed');
