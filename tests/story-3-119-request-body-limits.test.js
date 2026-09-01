const assert = require('assert');
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGlobalErrorHandler } = require('../lib/errorHandler');
const {
  BROWSER_REQUEST_BODY_LIMIT,
  STRIPE_WEBHOOK_BODY_LIMIT
} = require('../lib/requestBodyLimits');

function request(server, route, contentType, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: route,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json'
      }
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function run() {
  assert.strictEqual(BROWSER_REQUEST_BODY_LIMIT, '64kb');
  assert.strictEqual(STRIPE_WEBHOOK_BODY_LIMIT, '256kb');

  const events = [];
  const app = express();
  app.post('/raw', express.raw({ type: 'application/json', limit: STRIPE_WEBHOOK_BODY_LIMIT }), (req, res) => res.json({ bytes: req.body.length }));
  app.use(express.json({ limit: BROWSER_REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BROWSER_REQUEST_BODY_LIMIT }));
  app.post('/browser', (req, res) => res.json({ accepted: Boolean(req.body) }));
  app.use(createGlobalErrorHandler({ getNodeEnv: () => 'production', logger: (event) => events.push(event) }));

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });

  try {
    assert.strictEqual((await request(server, '/browser', 'application/json', JSON.stringify({ value: 'safe' }))).statusCode, 200);
    assert.strictEqual((await request(server, '/browser', 'application/json', JSON.stringify({ value: 'x'.repeat(70 * 1024) }))).statusCode, 413);
    assert.strictEqual((await request(server, '/browser', 'application/x-www-form-urlencoded', `value=${'x'.repeat(70 * 1024)}`)).statusCode, 413);
    assert.strictEqual((await request(server, '/raw', 'application/json', 'x'.repeat(257 * 1024))).statusCode, 413);
    assert(events.every((event) => event.statusCode === 413));
    assert(events.every((event) => event.code === 'REQUEST_BODY_TOO_LARGE'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const webhookSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'webhook.js'), 'utf8');
  assert.match(serverSource, /express\.json\(\{ limit: BROWSER_REQUEST_BODY_LIMIT \}\)/);
  assert.match(serverSource, /express\.urlencoded\(\{[\s\S]*limit: BROWSER_REQUEST_BODY_LIMIT,[\s\S]*parameterLimit: BROWSER_FORM_PARAMETER_LIMIT/);
  assert.match(webhookSource, /limit: STRIPE_WEBHOOK_BODY_LIMIT/);
  assert(serverSource.indexOf('app.use(express.json') > serverSource.indexOf("app.use('/', webhookRoutes)"));

  console.log('Story 3.119 request body limit tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
