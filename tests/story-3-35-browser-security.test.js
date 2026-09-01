const assert = require('assert');
const express = require('express');
const http = require('http');
const {
  CONTENT_SECURITY_POLICY,
  configureBrowserSecurity
} = require('../lib/browserSecurity');

function request(server, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method: 'GET',
      path: route,
      headers
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

function assertBaselineHeaders(response, expectedCsp = CONTENT_SECURITY_POLICY) {
  const headers = response.res.headers;
  assert.strictEqual(headers['content-security-policy'], expectedCsp);
  assert.strictEqual(headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(headers['x-frame-options'], 'DENY');
  assert.strictEqual(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.strictEqual(headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.strictEqual(headers['x-permitted-cross-domain-policies'], 'none');
  assert.strictEqual(headers['x-powered-by'], undefined);
}

async function run() {
  assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /base-uri 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /form-action 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(CONTENT_SECURITY_POLICY, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(CONTENT_SECURITY_POLICY, /img-src[^;]*data:[^;]*https:/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /default-src \*/);

  const productionApp = express();
  productionApp.set('trust proxy', 1);
  configureBrowserSecurity(productionApp, { env: { NODE_ENV: 'production' } });
  productionApp.get('/html', (_req, res) => res.send('<h1>CopyQuick</h1>'));
  productionApp.get('/redirect', (_req, res) => res.redirect('/html'));
  productionApp.get('/failure', (_req, res) => res.status(500).json({ error: 'safe' }));
  const productionServer = await listen(productionApp);

  try {
    for (const route of ['/html', '/failure']) {
      const response = await request(productionServer, route, { 'X-Forwarded-Proto': 'https' });
      assertBaselineHeaders(response);
      assert.strictEqual(
        response.res.headers['strict-transport-security'],
        'max-age=31536000; includeSubDomains'
      );
    }

    const redirect = await request(productionServer, '/redirect', { 'X-Forwarded-Proto': 'https' });
    assertBaselineHeaders(redirect);
    assert.strictEqual(
      redirect.res.headers['strict-transport-security'],
      'max-age=31536000; includeSubDomains'
    );

    for (const route of ['/missing']) {
      const response = await request(productionServer, route, { 'X-Forwarded-Proto': 'https' });
      // Express deliberately tightens its own generated default 404 body.
      assertBaselineHeaders(response, "default-src 'none'");
      assert.strictEqual(
        response.res.headers['strict-transport-security'],
        'max-age=31536000; includeSubDomains'
      );
    }

    const insecure = await request(productionServer, '/html');
    assertBaselineHeaders(insecure);
    assert.strictEqual(insecure.res.headers['strict-transport-security'], undefined);
  } finally {
    await new Promise((resolve) => productionServer.close(resolve));
  }

  const developmentApp = express();
  developmentApp.set('trust proxy', 1);
  configureBrowserSecurity(developmentApp, { env: { NODE_ENV: 'development' } });
  developmentApp.get('/', (_req, res) => res.send('local'));
  const developmentServer = await listen(developmentApp);
  try {
    const local = await request(developmentServer, '/', { 'X-Forwarded-Proto': 'https' });
    assertBaselineHeaders(local);
    assert.strictEqual(local.res.headers['strict-transport-security'], undefined);
  } finally {
    await new Promise((resolve) => developmentServer.close(resolve));
  }

  const serverSource = require('fs').readFileSync(require.resolve('../server'), 'utf8');
  assert(
    serverSource.indexOf('configureBrowserSecurity(app)') < serverSource.indexOf('app.use(createRequestContextMiddleware'),
    'browser security must be configured before the earliest route middleware'
  );

  console.log('Story 3.35 browser security tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
