const assert = require('assert');
const http = require('http');
const express = require('express');
const { evaluateDeploymentReadiness, EXPECTED_NODE_VERSION } = require('../lib/deploymentReadiness');
const { createHealthRouter } = require('../routes/health');

function request(server, path) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    http.get({ host: '127.0.0.1', port: address.port, path }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-secure-random-session-secret-over-32-characters',
    DATABASE_PATH: '/var/data/copyquick.db',
    PERSISTENT_DATA_DIR: '/var/data',
    PUBLIC_APP_ORIGIN: 'https://copyquick.example',
    STRIPE_KEY: 'sk_live_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    STRIPE_PRO_PRICE: 'price_pro',
    STRIPE_UNLIMITED_PRICE: 'price_unlimited',
    RESEND_API_KEY: 'configured',
    AI_PROVIDER: 'deterministic',
    OFFSITE_BACKUP_ENABLED: 'true',
    BACKUP_HEALTH_ALERTS_ENABLED: 'true',
    STRIPE_RECONCILIATION_ENABLED: 'true',
    ...overrides
  };
}

async function main() {
  const ready = evaluateDeploymentReadiness(productionEnv(), { nodeVersion: EXPECTED_NODE_VERSION });
  assert.strictEqual(ready.ready, true);
  assert.strictEqual(ready.blockerCount, 0);
  assert.strictEqual(ready.warningCount, 0);

  const unsafe = evaluateDeploymentReadiness({ NODE_ENV: 'production', SESSION_SECRET: 'short' }, { nodeVersion: 'v22.0.0' });
  assert.strictEqual(unsafe.ready, false);
  const codes = unsafe.findings.map(item => item.code);
  for (const code of ['NODE_VERSION_MISMATCH', 'SESSION_SECRET_WEAK', 'PERSISTENT_DATABASE_CONFIGURATION_MISSING', 'PUBLIC_APP_ORIGIN_MISSING', 'STRIPE_KEY_MISSING', 'RESEND_API_KEY_MISSING']) {
    assert(codes.includes(code), `missing deployment blocker ${code}`);
  }
  assert(!JSON.stringify(unsafe).includes('short'), 'readiness output must not echo configuration values');

  const partialOAuth = evaluateDeploymentReadiness(productionEnv({ GOOGLE_CLIENT_ID: 'configured' }), { nodeVersion: EXPECTED_NODE_VERSION });
  assert(partialOAuth.findings.some(item => item.code === 'GOOGLE_OAUTH_PARTIAL_CONFIGURATION'));
  const invalidBilling = evaluateDeploymentReadiness(productionEnv({ STRIPE_KEY: 'sk_test_not-production', STRIPE_UNLIMITED_PRICE: 'price_pro' }), { nodeVersion: EXPECTED_NODE_VERSION });
  assert(invalidBilling.findings.some(item => item.code === 'STRIPE_KEY_INVALID'));
  assert(invalidBilling.findings.some(item => item.code === 'STRIPE_PRICE_IDS_NOT_DISTINCT'));
  const invalidOAuth = evaluateDeploymentReadiness(productionEnv({ GOOGLE_CLIENT_ID: 'configured', GOOGLE_CLIENT_SECRET: 'configured', GOOGLE_CALLBACK_URL: 'http://copyquick.example/callback' }), { nodeVersion: EXPECTED_NODE_VERSION });
  assert(invalidOAuth.findings.some(item => item.code === 'GOOGLE_CALLBACK_URL_INVALID'));
  const liveAi = evaluateDeploymentReadiness(productionEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'configured' }), { nodeVersion: EXPECTED_NODE_VERSION });
  assert(liveAi.findings.some(item => item.code === 'AI_SAFETY_IDENTIFIER_SECRET_MISSING' && item.severity === 'warning'));

  const app = express();
  app.use(createHealthRouter({ getDatabase: () => ({ prepare: () => ({ get: () => ({ ready: 1 }) }) }) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const path of ['/livez', '/healthz', '/readyz']) {
      const response = await request(server, path);
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { status: 'ok' });
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const failedApp = express();
  failedApp.use(createHealthRouter({ getDatabase: () => { throw new Error('private database detail'); } }));
  const failedServer = failedApp.listen(0, '127.0.0.1');
  await new Promise(resolve => failedServer.once('listening', resolve));
  try {
    assert.strictEqual((await request(failedServer, '/livez')).status, 200);
    const unavailable = await request(failedServer, '/readyz');
    assert.strictEqual(unavailable.status, 503);
    assert.deepStrictEqual(unavailable.body, { status: 'unavailable' });
    assert(!JSON.stringify(unavailable).includes('private database detail'));
  } finally {
    await new Promise(resolve => failedServer.close(resolve));
  }

  console.log('Phase 5 deployment readiness tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
