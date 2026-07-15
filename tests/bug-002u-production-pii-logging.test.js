const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002u-test.sqlite');
process.env.SESSION_SECRET = 'BUG002U_SESSION_SECRET_MARKER';
process.env.GOOGLE_CLIENT_ID = 'BUG002U_GOOGLE_CLIENT_ID_MARKER';
process.env.GOOGLE_CLIENT_SECRET = 'BUG002U_GOOGLE_CLIENT_SECRET_MARKER';
process.env.GOOGLE_CALLBACK_URL = 'https://dummy.invalid/BUG002U_CALLBACK_MARKER';
process.env.STRIPE_KEY = 'sk_test_bug_002u';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_bug_002u';
process.env.STRIPE_PRO_PRICE = 'price_bug_002u_pro';
process.env.STRIPE_UNLIMITED_PRICE = 'price_bug_002u_unlimited';

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

const markers = [
  'BUG002U_EMAIL_MARKER@example.com',
  'BUG002U_NAME_MARKER',
  'BUG002U_GOOGLE_PROFILE_ID_MARKER',
  'BUG002U_USER_ID_MARKER',
  'cus_BUG002U_CUSTOMER_MARKER',
  'sub_BUG002U_SUBSCRIPTION_MARKER',
  'BUG002U_CONTACT_SUBJECT_MARKER',
  'BUG002U_CONTACT_MESSAGE_MARKER',
  'BUG002U_GENERATED_COPY_MARKER',
  'BUG002U_PROMPT_MARKER',
  'BUG002U_CALLBACK_MARKER',
  'BUG002U_PASSWORD_MARKER',
  'BUG002U_CSRF_TOKEN_MARKER',
  'BUG002U_SESSION_SECRET_MARKER',
  'BUG002U_GOOGLE_CLIENT_ID_MARKER',
  'BUG002U_GOOGLE_CLIENT_SECRET_MARKER',
  'whsec_bug_002u',
  'sk_test_bug_002u'
];

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function captureConsole() {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  const lines = [];

  for (const method of Object.keys(original)) {
    console[method] = (...args) => {
      lines.push(args.map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch (err) {
          return String(arg);
        }
      }).join(' '));
    };
  }

  return {
    output: () => lines.join('\n'),
    restore: () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    }
  };
}

function assertNoMarkers(output, context) {
  for (const marker of markers) {
    assert(!output.includes(marker), `${context} leaked marker: ${marker}\n${output}`);
  }
  assert(!/password/i.test(output), `${context} logged password-related text:\n${output}`);
  assert(!/request body/i.test(output), `${context} logged request-body text:\n${output}`);
}

function request(server, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || null;
    const contentType = options.contentType || 'application/x-www-form-urlencoded';
    let payload = '';
    if (body && contentType === 'application/json') {
      payload = JSON.stringify(body);
    } else if (body) {
      payload = new URLSearchParams(body).toString();
    }

    const headers = { ...(options.headers || {}) };
    if (payload) {
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path: url,
      headers
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

async function runOAuthLoggingTest(db) {
  clearModule('passport');
  clearModule('../lib/passport');
  const capture = captureConsole();
  try {
    const passport = require('../lib/passport');
    const strategy = passport._strategy('google');
    assert(strategy, 'Google strategy should be registered in configured test env');

    await new Promise((resolve, reject) => {
      strategy._verify(null, null, {
        id: 'BUG002U_GOOGLE_PROFILE_ID_MARKER',
        displayName: 'BUG002U_NAME_MARKER',
        name: { givenName: 'BUG002U_NAME_MARKER' },
        emails: [{ value: 'BUG002U_EMAIL_MARKER@example.com' }],
        photos: [{ value: 'https://dummy.invalid/avatar/BUG002U_GOOGLE_PROFILE_ID_MARKER' }]
      }, (err, user) => {
        if (err) return reject(err);
        try {
          assert(user, 'OAuth strategy should create a user');
          resolve();
        } catch (assertErr) {
          reject(assertErr);
        }
      });
    });

    const output = capture.output();
    assert.match(output, /Google auth complete/);
    assertNoMarkers(output, 'OAuth logging');
    assert(db.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get('BUG002U_EMAIL_MARKER@example.com').count === 1);
  } finally {
    capture.restore();
  }
}

async function runContactLoggingTest() {
  const { createContactHandler } = require('../lib/contactProtection');

  async function invoke(sendContactFormEmails) {
    const handler = createContactHandler({ sendContactFormEmails });
    const req = {
      body: {
        name: 'BUG002U_NAME_MARKER',
        email: 'BUG002U_EMAIL_MARKER@example.com',
        subject: 'BUG002U_CONTACT_SUBJECT_MARKER',
        message: 'BUG002U_CONTACT_MESSAGE_MARKER'
      },
      headers: { accept: 'application/json', 'user-agent': 'BUG002U_USER_AGENT_MARKER' },
      ip: '203.0.113.42',
      xhr: false,
      get(name) {
        return this.headers[String(name).toLowerCase()];
      }
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
      render(view, payload) {
        this.view = view;
        this.payload = payload;
        return this;
      }
    };
    await handler(req, res);
    return res;
  }

  const successCapture = captureConsole();
  try {
    const res = await invoke(async () => ({ ticketNumber: 'CQ-BUG002U_TICKET_MARKER' }));
    assert.strictEqual(res.statusCode, 200);
    const output = successCapture.output();
    assert.match(output, /Contact form processed/);
    assertNoMarkers(output, 'Contact success logging');
  } finally {
    successCapture.restore();
  }

  const failureCapture = captureConsole();
  try {
    const res = await invoke(async () => {
      throw new Error('BUG002U_CONTACT_MESSAGE_MARKER provider failure for BUG002U_EMAIL_MARKER@example.com');
    });
    assert.strictEqual(res.statusCode, 500);
    const output = failureCapture.output();
    assert.match(output, /Contact form error/);
    assertNoMarkers(output, 'Contact failure logging');
  } finally {
    failureCapture.restore();
  }
}

async function runDashboardAndGenerationLoggingTest(db, userId) {
  const generatorModuleId = require.resolve('../lib/generator');
  require.cache[generatorModuleId] = {
    id: generatorModuleId,
    filename: generatorModuleId,
    loaded: true,
    exports: {
      generateCopy: () => [{ text: 'BUG002U_GENERATED_COPY_MARKER', tone: 'Professional' }],
      getContentTypes: () => ({ subject_line: 'Subject Lines' }),
      getTones: () => ['Professional']
    }
  };
  clearModule('../routes/generations');
  const generationRoutes = require('../routes/generations');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    req.session = { userId };
    res.locals.user = user;
    res.locals.csrfToken = 'BUG002U_CSRF_TOKEN_MARKER';
    next();
  });
  app.use(generationRoutes);

  const server = await listen(app);
  const capture = captureConsole();
  try {
    const dashboard = await request(server, 'GET', '/dashboard');
    assert.strictEqual(dashboard.res.statusCode, 200);
    const generated = await request(server, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json' },
      body: {
        productDescription: 'BUG002U_PROMPT_MARKER',
        targetAudience: 'Founders',
        contentType: 'subject_line',
        tone: 'Professional',
        generationType: 'quick'
      }
    });
    assert.strictEqual(generated.res.statusCode, 200);
    const output = capture.output();
    assert.match(output, /Dashboard route called/);
    assertNoMarkers(output, 'Dashboard/generation logging');
  } finally {
    capture.restore();
    server.close();
  }
}

async function runWebhookLoggingTest() {
  const stripeModuleId = require.resolve('../lib/stripe');
  const queuedEvents = [];
  require.cache[stripeModuleId] = {
    id: stripeModuleId,
    filename: stripeModuleId,
    loaded: true,
    exports: {
      stripe: {
        webhooks: {
          constructEvent: (body, signature) => {
            if (signature === 'bad-signature') {
              throw new Error('bad signature for sub_BUG002U_SUBSCRIPTION_MARKER');
            }
            return queuedEvents.shift();
          }
        },
        checkout: { sessions: { listLineItems: async () => ({ data: [] }) } },
        subscriptions: { retrieve: async () => null }
      }
    }
  };
  clearModule('../routes/webhook');
  const webhookRoutes = require('../routes/webhook');

  const app = express();
  app.use(webhookRoutes);
  const server = await listen(app);
  const capture = captureConsole();
  try {
    const invalid = await request(server, 'POST', '/stripe/webhook', {
      contentType: 'application/json',
      headers: { 'Stripe-Signature': 'bad-signature' },
      body: { id: 'evt_invalid' }
    });
    assert.strictEqual(invalid.res.statusCode, 400);
    assert(!invalid.body.includes('BUG002U_SUBSCRIPTION_MARKER'));

    queuedEvents.push({
      id: 'evt_bug002u_unknown',
      type: 'customer.subscription.updated',
      created: 100,
      data: {
        object: {
          id: 'sub_BUG002U_SUBSCRIPTION_MARKER',
          customer: 'cus_BUG002U_CUSTOMER_MARKER',
          status: 'active',
          items: { data: [{ price: { id: process.env.STRIPE_PRO_PRICE } }] },
          current_period_start: 100,
          current_period_end: 200,
          cancel_at_period_end: false,
          canceled_at: null,
          ended_at: null
        }
      }
    });
    const unknown = await request(server, 'POST', '/stripe/webhook', {
      contentType: 'application/json',
      headers: { 'Stripe-Signature': 'valid-signature' },
      body: { id: 'evt_bug002u_unknown' }
    });
    assert.strictEqual(unknown.res.statusCode, 200);

    const output = capture.output();
    assert.match(output, /Webhook signature verification failed/);
    assert.match(output, /Subscription update received for unknown user/);
    assertNoMarkers(output, 'Webhook logging');
  } finally {
    capture.restore();
    server.close();
  }
}

function runErrorHandlerLoggingTest() {
  const { createGlobalErrorHandler } = require('../lib/errorHandler');
  const handler = createGlobalErrorHandler({ getNodeEnv: () => 'production' });
  const capture = captureConsole();
  try {
    const req = { method: 'GET', originalUrl: '/safe-error-path', get: () => 'text/html' };
    const res = {
      headersSent: false,
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      type() {
        return this;
      },
      send(body) {
        this.body = body;
        return this;
      }
    };
    handler(new Error('Operational failure'), req, res, () => {});
    const output = capture.output();
    assert.match(output, /SERVER ERROR/);
    assert.match(output, /Status/);
    assert.match(output, /GET \/safe-error-path/);
    assertNoMarkers(output, 'Global error handler logging');
  } finally {
    capture.restore();
  }
}

async function run() {
  const { initDb } = require('../db/init');
  const { getDb } = require('../db/database');
  initDb();
  const db = getDb();
  const userId = db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, ?, 'free', 10, 0)
  `).run('dashboard-BUG002U_EMAIL_MARKER@example.com', 'BUG002U_NAME_MARKER').lastInsertRowid;

  await runOAuthLoggingTest(db);
  await runContactLoggingTest();
  await runDashboardAndGenerationLoggingTest(db, userId);
  await runWebhookLoggingTest();
  runErrorHandlerLoggingTest();
}

run()
  .then(() => {
    console.log('BUG-002U production PII logging tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
