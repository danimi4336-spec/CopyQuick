const assert = require('assert');
const express = require('express');
const http = require('http');
const { authConfigurationEvent } = require('../lib/authConfiguration');

const DUMMY_CLIENT_ID = 'CID-UNMISTAKABLE-ALPHA-1234567890.apps.googleusercontent.com';
const DUMMY_CLIENT_SECRET = 'GSECRET-UNMISTAKABLE-BRAVO-0987654321';
const DUMMY_CALLBACK_URL = 'https://dummy.invalid/oauth/DUMMY_CALLBACK_LEAK_MARKER';
const DUMMY_SESSION_SECRET = 'SESSION-UNMISTAKABLE-CHARLIE-2468135790';

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function captureConsole(fn) {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  const lines = [];

  for (const method of Object.keys(original)) {
    console[method] = (...args) => {
      lines.push(args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
    };
  }

  try {
    const result = fn();
    return { result, output: lines.join('\n') };
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}

async function captureConsoleAsync(fn) {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  const lines = [];

  for (const method of Object.keys(original)) {
    console[method] = (...args) => {
      lines.push(args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
    };
  }

  try {
    const result = await fn();
    return { result, output: lines.join('\n') };
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}

function loadPassportWithGoogleEnv({ clientId, clientSecret }) {
  if (clientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = clientId;

  if (clientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = clientSecret;

  process.env.GOOGLE_CALLBACK_URL = DUMMY_CALLBACK_URL;

  clearModule('passport');
  clearModule('../lib/passport');
  return require('../lib/passport');
}

function assertNoCredentialLeak(output) {
  for (const value of [DUMMY_CLIENT_ID, DUMMY_CLIENT_SECRET, DUMMY_CALLBACK_URL, DUMMY_SESSION_SECRET]) {
    assert(!output.includes(value), `log output leaked full value: ${value}`);
    assert(!output.includes(value.slice(0, 12)), `log output leaked recognizable prefix: ${value.slice(0, 12)}`);
    assert(!output.includes(value.slice(5, 20)), `log output leaked recognizable substring: ${value.slice(5, 20)}`);
  }
}

function createAuthApp() {
  clearModule('../routes/auth');
  const { router } = require('../routes/auth');
  const app = express();
  app.use((req, res, next) => {
    req.session = {};
    req.logIn = (user, done) => {
      req.user = user;
      done();
    };
    next();
  });
  app.use(router);
  return app;
}

async function listen(app) {
  const server = app.listen(0, '0.0.0.0');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

function request(server, method, url) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path: url
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const configured = captureConsole(() => loadPassportWithGoogleEnv({
    clientId: DUMMY_CLIENT_ID,
    clientSecret: DUMMY_CLIENT_SECRET
  }));
  assertNoCredentialLeak(configured.output);
  assert.strictEqual(configured.output, '');
  assert.strictEqual(configured.result.isGoogleOAuthConfigured(), true);
  assert(configured.result._strategy('google'), 'configured Google OAuth should register the google strategy');

  const configuredRoute = await captureConsoleAsync(async () => {
    const server = await listen(createAuthApp());
    try {
      return await request(server, 'GET', '/auth/google');
    } finally {
      server.close();
    }
  });
  assertNoCredentialLeak(configuredRoute.output);
  assert.doesNotMatch(configuredRoute.output, /Google OAuth initiating|GOOGLE_CALLBACK_URL/);
  assert.strictEqual(configuredRoute.result.res.statusCode, 302);
  assert.match(configuredRoute.result.res.headers.location, /^https:\/\/accounts\.google\.com\//);

  const missing = captureConsole(() => loadPassportWithGoogleEnv({
    clientId: undefined,
    clientSecret: undefined
  }));
  assertNoCredentialLeak(missing.output);
  assert.strictEqual(missing.output, '');
  assert.strictEqual(missing.result.isGoogleOAuthConfigured(), false);
  assert.strictEqual(missing.result._strategy('google'), undefined);

  const configuredEvent = authConfigurationEvent({
    GOOGLE_CLIENT_ID: DUMMY_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: DUMMY_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: DUMMY_CALLBACK_URL,
    SESSION_SECRET: DUMMY_SESSION_SECRET
  });
  assert.deepStrictEqual(configuredEvent, {
    event: 'auth_configuration_loaded',
    operation: 'google_oauth',
    outcome: 'configured'
  });
  assertNoCredentialLeak(JSON.stringify(configuredEvent));
  assert.strictEqual(authConfigurationEvent({ GOOGLE_CLIENT_ID: DUMMY_CLIENT_ID }).outcome, 'disabled');
  assert.strictEqual(authConfigurationEvent({ GOOGLE_CLIENT_SECRET: DUMMY_CLIENT_SECRET }).outcome, 'disabled');

  console.log('BUG-002O OAuth credential logging tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
