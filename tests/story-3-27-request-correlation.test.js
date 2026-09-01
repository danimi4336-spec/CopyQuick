const assert = require('assert');
const express = require('express');
const http = require('http');
const { createGlobalErrorHandler } = require('../lib/errorHandler');
const { sanitizedOperationalEvent } = require('../lib/operationalLogger');
const { createProviderRuntime } = require('../lib/providerRuntime');
const { createRequestContextMiddleware, runWithOperationalContext, skipCompletionEvent } = require('../lib/requestContext');

function request(server, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const events = [];
  const app = express();
  app.use(createRequestContextMiddleware({ idFactory: () => '11111111-1111-4111-8111-111111111111', now: (() => { let value = 100; return () => value += 5; })(), logger: event => events.push(event) }));
  app.get('/ok', (req, res) => res.json({ ok: true }));
  app.get('/fail', () => { const error = new Error('private customer@example.com payload'); error.code = 'SAFE_FAILURE_CODE'; throw error; });
  app.use(createGlobalErrorHandler({ getNodeEnv: () => 'production', logger: event => events.push(event) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const ok = await request(server, '/ok?email=private@example.com', { 'X-Request-ID': 'attacker-controlled' });
    assert.strictEqual(ok.res.headers['x-request-id'], '11111111-1111-4111-8111-111111111111');
    const completion = events.find(event => event.event === 'http_request_completed' && event.statusCode === 200);
    assert.strictEqual(completion.route, '/ok');
    assert(!JSON.stringify(completion).includes('private@example.com'));
    assert(!JSON.stringify(completion).includes('attacker-controlled'));

    const failed = await request(server, '/fail', { Accept: 'application/json' });
    assert.strictEqual(failed.res.statusCode, 500);
    assert.strictEqual(JSON.parse(failed.body).requestId, '11111111-1111-4111-8111-111111111111');
    assert(!failed.body.includes('private customer'));
    const failure = events.find(event => event.event === 'http_request_failed');
    assert.deepStrictEqual(failure, {
      event: 'http_request_failed', requestId: '11111111-1111-4111-8111-111111111111',
      method: 'GET', route: '/fail', statusCode: 500, code: 'SAFE_FAILURE_CODE'
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const sanitized = sanitizedOperationalEvent({
    event: 'test_event', code: 'SAFE', email: 'private@example.com', prompt: 'secret', rawError: 'private'
  });
  assert.deepStrictEqual(sanitized, { event: 'test_event', code: 'SAFE' });
  assert.deepStrictEqual(sanitizedOperationalEvent({ event: 'test_event', code: 'private@example.com' }), { event: 'test_event' });
  assert.strictEqual(skipCompletionEvent('/healthz'), true);
  assert.strictEqual(skipCompletionEvent('/js/dashboardResults.js'), true);
  assert.strictEqual(skipCompletionEvent('/production/12'), false);

  const providerEvents = [];
  const runtime = createProviderRuntime({ logger: event => providerEvents.push(sanitizedOperationalEvent(event)) });
  await runWithOperationalContext({
    requestId: '22222222-2222-4222-8222-222222222222', productionRunId: 41, productionJobId: 52
  }, () => runtime.run({ operation: 'production:test', input: { safe: true }, invoke: async () => ({ text: 'ok' }) }));
  assert.deepStrictEqual(providerEvents[0], {
    requestId: '22222222-2222-4222-8222-222222222222', productionRunId: 41,
    productionJobId: 52, event: 'provider_request_completed', operation: 'production:test', durationMs: providerEvents[0].durationMs
  });

  console.log('Story 3.27 Request Correlation tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
