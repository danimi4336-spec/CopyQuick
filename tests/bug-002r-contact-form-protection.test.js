const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'bug-002r-session-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

const { createCsrfProtection } = require('../lib/csrf');
const {
  CONTACT_FIELD_LIMITS,
  CONTACT_LIMIT_ERROR,
  CONTACT_VALIDATION_ERROR,
  createContactHandler,
  createContactRateLimiter
} = require('../lib/contactProtection');

function request(agent, method, url, options = {}) {
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
    if (agent.cookie) headers.Cookie = agent.cookie;

    const req = http.request({
      hostname: '127.0.0.1',
      port: agent.server.address().port,
      method,
      path: url,
      headers
    }, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie?.length) {
        agent.cookie = setCookie.map((cookie) => cookie.split(';')[0]).join('; ');
      }

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

function parseJson(response) {
  return JSON.parse(response.body || '{}');
}

function validBody(overrides = {}) {
  return {
    name: 'Ada Founder',
    email: 'ada@example.com',
    subject: 'Question about CopyQuick',
    message: 'Hello CopyQuick team, I have a question.',
    ...overrides
  };
}

async function createTestAgent(options = {}) {
  const sent = [];
  const sendContactFormEmails = options.sendContactFormEmails || (async (payload) => {
    sent.push(payload);
    return { ticketNumber: 'CQ-20260712-00001' };
  });

  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
  }));
  app.use(createCsrfProtection());
  app.get('/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });
  app.get('/contact', (req, res) => {
    res.render('contact', { title: 'Contact - CopyQuick', currentPage: 'contact', sent: false, error: null });
  });
  app.post('/contact',
    createContactRateLimiter({ max: options.max || 10, windowMs: options.windowMs || 15 * 60 * 1000 }),
    createContactHandler({ sendContactFormEmails })
  );

  const server = await listen(app);
  return { agent: { server, cookie: '' }, sent, close: () => server.close() };
}

async function getToken(agent) {
  const response = await request(agent, 'GET', '/csrf-token');
  assert.strictEqual(response.res.statusCode, 200);
  return parseJson(response).csrfToken;
}

async function postContact(agent, body, token, headers = {}) {
  return request(agent, 'POST', '/contact', {
    headers: { Accept: 'application/json', 'X-CSRF-Token': token, ...headers },
    body
  });
}

async function withAgent(options, fn) {
  const context = await createTestAgent(options);
  try {
    await fn(context);
  } finally {
    context.close();
  }
}

async function runRouteTests() {
  await withAgent({}, async ({ agent, sent }) => {
    const token = await getToken(agent);
    const response = await postContact(agent, validBody(), token);
    assert.strictEqual(response.res.statusCode, 200);
    assert.deepStrictEqual(parseJson(response), { success: true });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].name, 'Ada Founder');
    assert.strictEqual(sent[0].email, 'ada@example.com');
    assert.strictEqual(sent[0].ip, '127.0.0.1');
  });

  for (const [field, value] of [
    ['name', ''],
    ['message', ''],
    ['email', 'not-an-email'],
    ['subject', '   '],
    ['name', '   ']
  ]) {
    await withAgent({}, async ({ agent, sent }) => {
      const token = await getToken(agent);
      const response = await postContact(agent, validBody({ [field]: value }), token);
      assert.strictEqual(response.res.statusCode, 400, `${field} should be rejected`);
      assert.strictEqual(parseJson(response).error, CONTACT_VALIDATION_ERROR);
      assert.strictEqual(sent.length, 0);
    });
  }

  for (const [field, value] of [
    ['name', 'N'.repeat(CONTACT_FIELD_LIMITS.name + 1)],
    ['email', `${'e'.repeat(CONTACT_FIELD_LIMITS.email)}@example.com`],
    ['subject', 'S'.repeat(CONTACT_FIELD_LIMITS.subject + 1)],
    ['message', 'M'.repeat(CONTACT_FIELD_LIMITS.message + 1)]
  ]) {
    await withAgent({}, async ({ agent, sent }) => {
      const token = await getToken(agent);
      const response = await postContact(agent, validBody({ [field]: value }), token);
      assert.strictEqual(response.res.statusCode, 400, `${field} maximum length should be enforced`);
      assert.strictEqual(sent.length, 0);
    });
  }

  for (const [field, value] of [
    ['email', 'ada@example.com\r\nBcc: attacker@example.com'],
    ['subject', 'Hello\r\nBcc: attacker@example.com'],
    ['name', 'Ada\r\nBcc: attacker@example.com']
  ]) {
    await withAgent({}, async ({ agent, sent }) => {
      const token = await getToken(agent);
      const response = await postContact(agent, validBody({ [field]: value }), token);
      assert.strictEqual(response.res.statusCode, 400, `${field} header injection should be rejected`);
      assert.strictEqual(sent.length, 0);
    });
  }

  await withAgent({}, async ({ agent, sent }) => {
    const response = await request(agent, 'POST', '/contact', {
      headers: { Accept: 'application/json' },
      body: validBody()
    });
    assert.strictEqual(response.res.statusCode, 403);
    assert.strictEqual(sent.length, 0);
  });

  await withAgent({}, async ({ agent, sent }) => {
    const response = await postContact(agent, validBody(), 'invalid-token');
    assert.strictEqual(response.res.statusCode, 403);
    assert.strictEqual(sent.length, 0);
  });

  await withAgent({ max: 3 }, async ({ agent, sent }) => {
    const token = await getToken(agent);
    for (let i = 0; i < 3; i += 1) {
      const response = await postContact(agent, validBody({ subject: `Question ${i}` }), token);
      assert.strictEqual(response.res.statusCode, 200);
    }
    assert.strictEqual(sent.length, 3);

    const limited = await postContact(agent, validBody({ subject: 'Too many' }), token);
    assert.strictEqual(limited.res.statusCode, 429);
    assert.strictEqual(parseJson(limited).error, CONTACT_LIMIT_ERROR);
    assert.strictEqual(sent.length, 3);
  });

  await withAgent({ max: 1 }, async ({ agent, sent }) => {
    const token = await getToken(agent);
    let response = await postContact(agent, validBody({ subject: 'IP 1' }), token, { 'X-Forwarded-For': '198.51.100.10' });
    assert.strictEqual(response.res.statusCode, 200);
    response = await postContact(agent, validBody({ subject: 'IP 1 blocked' }), token, { 'X-Forwarded-For': '198.51.100.10' });
    assert.strictEqual(response.res.statusCode, 429);
    response = await postContact(agent, validBody({ subject: 'IP 2 allowed' }), token, { 'X-Forwarded-For': '198.51.100.20' });
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(sent.length, 2);
  });

  await withAgent({
    sendContactFormEmails: async () => {
      throw new Error('provider exploded with api-key-like internal details');
    }
  }, async ({ agent }) => {
    const token = await getToken(agent);
    const response = await postContact(agent, validBody(), token);
    assert.strictEqual(response.res.statusCode, 500);
    assert.strictEqual(parseJson(response).error, 'Sorry, your message could not be sent. Please try again later.');
    assert.doesNotMatch(response.body, /provider exploded|api-key-like|stack/i);
  });

  await withAgent({}, async ({ agent }) => {
    const token = await getToken(agent);
    const response = await request(agent, 'POST', '/contact', {
      body: { ...validBody(), _csrf: token }
    });
    assert.strictEqual(response.res.statusCode, 200);
    assert.match(response.body, /Message Sent!/);
  });
}

async function runEmailSafetyTest() {
  const sentEmails = [];
  const resendModuleId = require.resolve('resend');
  const emailModuleId = require.resolve('../lib/email');
  const previousResendApiKey = process.env.RESEND_API_KEY;

  require.cache[resendModuleId] = {
    id: resendModuleId,
    filename: resendModuleId,
    loaded: true,
    exports: {
      Resend: class MockResend {
        constructor() {
          this.emails = {
            send: async (payload) => {
              sentEmails.push(payload);
              return { data: { id: `email_${sentEmails.length}` } };
            }
          };
        }
      }
    }
  };
  delete require.cache[emailModuleId];
  process.env.RESEND_API_KEY = 'test-resend-key';

  const { sendContactFormEmails } = require('../lib/email');
  await sendContactFormEmails({
    name: 'Ada',
    email: 'ada@example.com',
    subject: 'Hello\r\nBcc: attacker@example.com',
    message: '<img src=x onerror=alert(1)>\n<script>alert(1)</script>',
    ip: '203.0.113.10',
    userAgent: 'Unit Test'
  });

  assert.strictEqual(sentEmails.length, 2);
  assert.doesNotMatch(sentEmails[0].subject, /[\r\n]/);
  assert.doesNotMatch(sentEmails[0].reply_to, /[\r\n]/);
  assert.match(sentEmails[0].html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(sentEmails[0].html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(sentEmails[0].html, /<img src=x/i);
  assert.doesNotMatch(sentEmails[0].html, /<script>alert/i);
  assert.match(sentEmails[1].text, /<img src=x onerror=alert\(1\)>/);

  delete require.cache[emailModuleId];
  delete require.cache[resendModuleId];
  if (previousResendApiKey === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = previousResendApiKey;
  }
}

async function run() {
  await runRouteTests();
  await runEmailSafetyTest();
  console.log('BUG-002R contact form protection tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
