const assert = require('assert');
const express = require('express');
const http = require('http');
const { createSensitiveResponseCacheMiddleware } = require('../lib/sensitiveResponseCache');

function request(server, path, authenticated = false) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path,
      headers: authenticated ? { 'X-Test-Authenticated': 'yes' } : {} }, (res) => {
      res.resume(); res.on('end', () => resolve(res));
    });
    req.on('error', reject);
  });
}

async function run() {
  const app = express();
  app.use((req, _res, next) => {
    req.session = req.get('X-Test-Authenticated') === 'yes' ? { userId: 42 } : {};
    next();
  });
  app.use(createSensitiveResponseCacheMiddleware());
  app.get('*path', (_req, res) => res.send('ok'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    for (const path of ['/login', '/signup', '/forgot-password', '/reset-password?token=secret', '/auth/google']) {
      const response = await request(server, path);
      assert.strictEqual(response.headers['cache-control'], 'private, no-store');
      assert.strictEqual(response.headers.pragma, 'no-cache');
      assert.strictEqual(response.headers.expires, '0');
    }
    const privatePage = await request(server, '/generation/42', true);
    assert.strictEqual(privatePage.headers['cache-control'], 'private, no-store');
    const publicPage = await request(server, '/about');
    assert.strictEqual(publicPage.headers['cache-control'], undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }

  const source = require('fs').readFileSync(require.resolve('../server'), 'utf8');
  assert(source.indexOf('app.use(session(') < source.indexOf('app.use(createSensitiveResponseCacheMiddleware())'));
  assert(source.indexOf('app.use(createSensitiveResponseCacheMiddleware())') < source.indexOf('app.use(createCsrfProtection())'));
  console.log('Story 3.42 sensitive response cache tests passed');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
