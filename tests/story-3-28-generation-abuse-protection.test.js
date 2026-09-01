const assert = require('assert');
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGenerationActionRateLimiter } = require('../lib/generationProtection');

function request(server, userId, accept = 'application/json') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port, path: '/expensive', method: 'POST',
      headers: { 'X-Test-User': String(userId), Accept: accept }
    }, res => {
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
  let clock = 1000;
  let executed = 0;
  const logs = [];
  const limiter = createGenerationActionRateLimiter({
    windowMs: 10000, maxActions: 2, now: () => clock, logger: event => logs.push(event)
  });
  const app = express();
  app.use((req, _res, next) => { req.session = { userId: req.get('X-Test-User') }; req.requestId = '11111111-1111-4111-8111-111111111111'; next(); });
  app.post('/expensive', limiter.middleware, (_req, res) => { executed += 1; res.json({ ok: true }); });
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    assert.strictEqual((await request(server, 1)).res.statusCode, 200);
    assert.strictEqual((await request(server, 1)).res.statusCode, 200);
    const limited = await request(server, 1);
    assert.strictEqual(limited.res.statusCode, 429);
    assert.strictEqual(limited.res.headers['retry-after'], '10');
    assert.strictEqual(JSON.parse(limited.body).code, 'GENERATION_RATE_LIMITED');
    assert.strictEqual(executed, 2, 'rejected bursts must not enter expensive route work');
    assert.strictEqual((await request(server, 2)).res.statusCode, 200, 'users must have independent budgets');
    assert.deepStrictEqual(logs[0], {
      event: 'generation_rate_limited', requestId: '11111111-1111-4111-8111-111111111111',
      code: 'GENERATION_RATE_LIMITED'
    });
    assert(!JSON.stringify(logs).includes('user:1'), 'rate-limit events must not expose account identifiers');
    clock += 10001;
    assert.strictEqual((await request(server, 1)).res.statusCode, 200, 'expired budgets must recover automatically');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  assert.strictEqual(createGenerationActionRateLimiter({ windowMs: -1, maxActions: 0 }).config.windowMs, 60000);
  assert.strictEqual(createGenerationActionRateLimiter({ windowMs: -1, maxActions: 0 }).config.maxActions, 12);

  const generationsRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
  const productionRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'production.js'), 'utf8');
  assert.match(generationsRoute, /router\.post\('\/dashboard\/generate', requireAuth, generationActionRateLimit/);
  assert.match(generationsRoute, /router\.post\('\/generation\/:id\/regenerate', requireAuth, generationActionRateLimit/);
  assert.match(productionRoute, /router\.post\('\/production\/start', requireAuth, generationActionRateLimit/);
  assert.match(productionRoute, /router\.post\('\/production\/:id\/run-next', requireAuth, generationActionRateLimit/);

  console.log('Story 3.28 Generation Abuse Protection tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
