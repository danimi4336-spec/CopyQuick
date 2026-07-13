const assert = require('assert');
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

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

function runServerStartupSmoke() {
  return new Promise((resolve, reject) => {
    const databasePath = path.join('/tmp', 'copyquick-bug-002o-startup.sqlite');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(databasePath + suffix);
      } catch (err) {
        // Temp database may not exist yet.
      }
    }

    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '0',
        DATABASE_URL: databasePath,
        SESSION_SECRET: DUMMY_SESSION_SECRET,
        GOOGLE_CLIENT_ID: DUMMY_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: DUMMY_CLIENT_SECRET,
        GOOGLE_CALLBACK_URL: DUMMY_CALLBACK_URL,
        STRIPE_KEY: 'sk_test_bug_002o',
        STRIPE_WEBHOOK_SECRET: 'whsec_bug_002o',
        STRIPE_PRO_PRICE: 'price_bug_002o_pro',
        STRIPE_UNLIMITED_PRICE: 'price_bug_002o_unlimited'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('server startup smoke timed out')), 5000);

    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill('SIGTERM');
      if (err) reject(err);
      else resolve(output);
    }

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('Server is running on')) finish();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', finish);
    child.on('exit', (code) => {
      if (!settled && code !== 0) finish(new Error(`server exited early with code ${code}:\n${output}`));
    });
  });
}

async function run() {
  const configured = captureConsole(() => loadPassportWithGoogleEnv({
    clientId: DUMMY_CLIENT_ID,
    clientSecret: DUMMY_CLIENT_SECRET
  }));
  assertNoCredentialLeak(configured.output);
  assert.match(configured.output, /clientID:\s+present/);
  assert.match(configured.output, /clientSecret:\s+present/);
  assert.match(configured.output, /enabled:\s+yes/);
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
  assert.match(configuredRoute.output, /Google OAuth initiating/);
  assert.match(configuredRoute.output, /GOOGLE_CALLBACK_URL:\s+present/);
  assert.strictEqual(configuredRoute.result.res.statusCode, 302);
  assert.match(configuredRoute.result.res.headers.location, /^https:\/\/accounts\.google\.com\//);

  const missing = captureConsole(() => loadPassportWithGoogleEnv({
    clientId: undefined,
    clientSecret: undefined
  }));
  assertNoCredentialLeak(missing.output);
  assert.match(missing.output, /clientID:\s+missing/);
  assert.match(missing.output, /clientSecret:\s+missing/);
  assert.match(missing.output, /enabled:\s+no/);
  assert.match(missing.output, /Google OAuth is disabled/);
  assert.strictEqual(missing.result.isGoogleOAuthConfigured(), false);
  assert.strictEqual(missing.result._strategy('google'), undefined);

  const startupOutput = await runServerStartupSmoke();
  assertNoCredentialLeak(startupOutput);
  assert.match(startupOutput, /GOOGLE_CLIENT_ID:\s+present/);
  assert.match(startupOutput, /GOOGLE_CLIENT_SECRET:\s+present/);
  assert.match(startupOutput, /Google OAuth:\s+configured/);
  assert.match(startupOutput, /SESSION_SECRET:\s+present/);

  console.log('BUG-002O OAuth credential logging tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
