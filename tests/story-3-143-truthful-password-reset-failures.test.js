const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { createPasswordRecoveryRouter } = require('../routes/passwordRecovery');

function request(server, body) {
  const payload = new URLSearchParams(body).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: '/reset-password', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let output = '';
      res.on('data', chunk => { output += chunk; });
      res.on('end', () => resolve({ res, output }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function withRouter(options, callback) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.requestId = '00000000-0000-4000-8000-000000000143';
    res.locals.csrfToken = 'test';
    next();
  });
  app.use(createPasswordRecoveryRouter({
    getDb: () => ({}),
    env: { NODE_ENV: 'test', SESSION_SECRET: 'story-3-143-secret' },
    ...options
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  try { await callback(server); } finally { await new Promise(resolve => server.close(resolve)); }
}

async function run() {
  const rejectedEvents = [];
  await withRouter({
    resetPassword: async () => ({ ok: false, code: 'TOKEN_INVALID' }),
    operationalLogger: event => rejectedEvents.push(event)
  }, async server => {
    const response = await request(server, { token: 'invalid', password: 'valid-password' });
    assert.strictEqual(response.res.statusCode, 400);
    assert.match(response.output, /invalid or has expired/);
  });
  assert.deepStrictEqual(rejectedEvents, []);

  const failureEvents = [];
  await withRouter({
    resetPassword: async () => { throw new Error('database path and sensitive details'); },
    operationalLogger: event => failureEvents.push(event)
  }, async server => {
    const response = await request(server, { token: 'valid-looking', password: 'valid-password' });
    assert.strictEqual(response.res.statusCode, 500);
    assert.match(response.output, /could not be completed safely/);
    assert.doesNotMatch(response.output, /database path|sensitive details/);
  });
  assert.deepStrictEqual(failureEvents, [{
    event: 'password_reset_failed',
    requestId: '00000000-0000-4000-8000-000000000143',
    method: 'POST',
    route: '/reset-password',
    statusCode: 500,
    code: 'PASSWORD_RESET_INTERNAL_FAILED'
  }]);

  console.log('Story 3.143 truthful password reset failure tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
