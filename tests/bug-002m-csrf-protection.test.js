const assert = require('assert');
const bcrypt = require('bcrypt');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002m-test.sqlite');
process.env.SESSION_SECRET = 'bug-002m-session-secret';
process.env.STRIPE_KEY = 'sk_test_bug_002m';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_bug_002m';
process.env.STRIPE_PRO_PRICE = 'price_test_pro';
process.env.STRIPE_UNLIMITED_PRICE = 'price_test_unlimited';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

function installMocks() {
  const generatorModuleId = require.resolve('../lib/generator');
  const contentTypes = require('../lib/contentTypes').contentTypes;
  const generatorCalls = [];
  require.cache[generatorModuleId] = {
    id: generatorModuleId,
    filename: generatorModuleId,
    loaded: true,
    exports: {
      generateCopy: (input) => {
        generatorCalls.push(input);
        return [{ text: 'Generated safe copy', tone: input.tone || 'professional' }];
      },
      getContentTypes: () => ({ ...contentTypes }),
      getTones: () => ['professional', 'casual', 'urgent', 'humorous', 'inspirational']
    }
  };

  const stripeModuleId = require.resolve('../lib/stripe');
  const checkoutCalls = [];
  const portalCalls = [];
  const webhookConstructCalls = [];
  require.cache[stripeModuleId] = {
    id: stripeModuleId,
    filename: stripeModuleId,
    loaded: true,
    exports: {
      createCheckoutSession: async (customerEmail, priceId, successUrl, cancelUrl) => {
        checkoutCalls.push({ customerEmail, priceId, successUrl, cancelUrl });
        return { url: '/mock-checkout-session' };
      },
      createCustomerPortalSession: async (customerId, returnUrl) => {
        portalCalls.push({ customerId, returnUrl });
        return { url: '/mock-portal-session' };
      },
      stripe: {
        webhooks: {
          constructEvent: (body, signature, secret) => {
            webhookConstructCalls.push({ body, signature, secret });
            throw new Error('signature verification failed');
          }
        },
        checkout: {
          sessions: {
            listLineItems: async () => ({ data: [{ price: { id: process.env.STRIPE_PRO_PRICE } }] })
          }
        },
        subscriptions: {
          retrieve: async () => ({
            status: 'active',
            current_period_start: 1767225600,
            current_period_end: 1769904000,
            cancel_at_period_end: false,
            canceled_at: null,
            ended_at: null
          })
        }
      }
    }
  };

  return { generatorCalls, checkoutCalls, portalCalls, webhookConstructCalls };
}

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

async function getToken(agent) {
  const response = await request(agent, 'GET', '/csrf-token');
  assert.strictEqual(response.res.statusCode, 200);
  return parseJson(response).csrfToken;
}

function insertGeneration(db, userId) {
  return db.prepare(`
    INSERT INTO generations (user_id, title, input_text, content_type, tone, results, word_count, generation_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    'Original title',
    'Original product',
    'subject_line',
    'professional',
    JSON.stringify([{ text: 'Original copy', tone: 'professional' }]),
    2,
    'quick'
  ).lastInsertRowid;
}

async function run() {
  const mocks = installMocks();
  const { initDb } = require('../db/init');
  const { getDb } = require('../db/database');
  const { createCsrfProtection } = require('../lib/csrf');
  const webhookRoutes = require('../routes/webhook');
  const generationRoutes = require('../routes/generations');
  const pricingRoutes = require('../routes/pricing');
  const builderRoutes = require('../routes/builder');
  const { router: authRoutes } = require('../routes/auth');

  initDb();
  const db = getDb();
  const passwordHash = bcrypt.hashSync('correct-password', 10);
  const userId = db.prepare(`
    INSERT INTO users (email, password_hash, name, plan_tier, monthly_limit, generations_used, stripe_customer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('owner@example.com', passwordHash, 'Owner', 'pro', 200, 0, 'cus_owner_123').lastInsertRowid;
  const generationId = insertGeneration(db, userId);
  let currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', webhookRoutes);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  }));
  app.use((req, res, next) => {
    if (currentUser) {
      req.session.userId = currentUser.id;
      res.locals.user = currentUser;
    } else {
      res.locals.user = null;
    }
    next();
  });
  app.use(createCsrfProtection());
  app.get('/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });
  app.use(authRoutes);
  app.use(generationRoutes);
  app.use(pricingRoutes);
  app.use(builderRoutes);

  const server = await listen(app);
  const agent = { server, cookie: '' };

  try {
    const initialGenerationCount = db.prepare('SELECT COUNT(*) AS count FROM generations').get().count;
    const initialUsageEvents = db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count;
    const initialUsagePeriods = db.prepare('SELECT COUNT(*) AS count FROM usage_periods').get().count;
    const initialUser = db.prepare('SELECT generations_used, current_period_used FROM users WHERE id = ?').get(userId);

    const pricingPage = await request(agent, 'GET', '/pricing');
    assert.strictEqual(pricingPage.res.statusCode, 200);
    assert.match(pricingPage.body, /name="_csrf"/);

    let blocked = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json' },
      body: { productDescription: 'Acme', contentType: 'subject_line', tone: 'professional', generationType: 'quick' }
    });
    assert.strictEqual(blocked.res.statusCode, 403);
    assert.strictEqual(parseJson(blocked).error, 'Invalid CSRF token');
    assert.strictEqual(mocks.generatorCalls.length, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations').get().count, initialGenerationCount);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count, initialUsageEvents);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_periods').get().count, initialUsagePeriods);
    assert.deepStrictEqual(db.prepare('SELECT generations_used, current_period_used FROM users WHERE id = ?').get(userId), initialUser);

    blocked = await request(agent, 'POST', `/generation/${generationId}/regenerate`, {
      headers: { Accept: 'application/json' }
    });
    assert.strictEqual(blocked.res.statusCode, 403);
    assert.strictEqual(mocks.generatorCalls.length, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count, initialUsageEvents);

    for (const pathToPost of [
      `/generation/${generationId}/delete`,
      `/generation/${generationId}/favorite`,
      '/subscribe',
      '/manage',
      '/logout',
      '/brand-brain'
    ]) {
      const response = await request(agent, 'POST', pathToPost, {
        headers: { Accept: 'application/json' },
        body: pathToPost === '/subscribe' ? { price: 'pro' } : {}
      });
      assert.strictEqual(response.res.statusCode, 403, `${pathToPost} should reject a missing token`);
      assert.strictEqual(parseJson(response).error, 'Invalid CSRF token');
    }

    const htmlRejected = await request(agent, 'POST', '/brand-brain', {
      body: { business_name: 'No Token Co' }
    });
    assert.strictEqual(htmlRejected.res.statusCode, 403);
    assert.match(htmlRejected.body, /Forbidden/);
    assert.doesNotMatch(htmlRejected.body, /csrfSecret|stack|Error:/);

    const invalidToken = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json', 'X-CSRF-Token': 'not-a-valid-token' },
      body: { productDescription: 'Acme', contentType: 'subject_line', tone: 'professional', generationType: 'quick' }
    });
    assert.strictEqual(invalidToken.res.statusCode, 403);
    assert.strictEqual(mocks.generatorCalls.length, 0);

    let token = await getToken(agent);
    let valid = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      body: { productDescription: 'Acme', contentType: 'subject_line', tone: 'professional', generationType: 'quick' }
    });
    assert.strictEqual(valid.res.statusCode, 200);
    assert.strictEqual(mocks.generatorCalls.length, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations').get().count, initialGenerationCount + 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE event_type = ?').get('generation').count, 1);

    token = await getToken(agent);
    valid = await request(agent, 'POST', `/generation/${generationId}/regenerate`, {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token }
    });
    assert.strictEqual(valid.res.statusCode, 200);
    assert.strictEqual(mocks.generatorCalls.length, 2);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE event_type = ?').get('regeneration').count, 1);

    token = await getToken(agent);
    valid = await request(agent, 'POST', `/generation/${generationId}/favorite`, {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token }
    });
    assert.strictEqual(valid.res.statusCode, 200);
    assert.strictEqual(parseJson(valid).favorite, true);

    token = await getToken(agent);
    valid = await request(agent, 'POST', `/generation/${generationId}/tags`, {
      contentType: 'application/json',
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      body: { tags: 'csrf-safe' }
    });
    assert.strictEqual(valid.res.statusCode, 200);
    assert.strictEqual(db.prepare('SELECT tags FROM generations WHERE id = ?').get(generationId).tags, 'csrf-safe');

    token = await getToken(agent);
    valid = await request(agent, 'POST', `/generation/${generationId}/title`, {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      body: { title: 'CSRF-safe title' }
    });
    assert.strictEqual(valid.res.statusCode, 200);
    assert.strictEqual(db.prepare('SELECT title FROM generations WHERE id = ?').get(generationId).title, 'CSRF-safe title');

    token = await getToken(agent);
    valid = await request(agent, 'POST', `/generation/${generationId}/delete`, {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token }
    });
    assert.strictEqual(valid.res.statusCode, 200);
    assert.strictEqual(db.prepare('SELECT is_deleted FROM generations WHERE id = ?').get(generationId).is_deleted, 1);

    token = await getToken(agent);
    valid = await request(agent, 'POST', `/generation/${generationId}/restore`, {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token }
    });
    assert.strictEqual(valid.res.statusCode, 200);
    assert.strictEqual(db.prepare('SELECT is_deleted FROM generations WHERE id = ?').get(generationId).is_deleted, 0);

    const checkoutBeforeGet = mocks.checkoutCalls.length;
    const subscribeGet = await request(agent, 'GET', '/subscribe?price=pro');
    assert.strictEqual(subscribeGet.res.statusCode, 302);
    assert.strictEqual(subscribeGet.res.headers.location, '/pricing');
    assert.strictEqual(mocks.checkoutCalls.length, checkoutBeforeGet);

    token = await getToken(agent);
    valid = await request(agent, 'POST', '/subscribe', {
      body: { price: 'pro', _csrf: token }
    });
    assert.strictEqual(valid.res.statusCode, 302);
    assert.strictEqual(valid.res.headers.location, '/mock-checkout-session');
    assert.strictEqual(mocks.checkoutCalls.length, checkoutBeforeGet + 1);
    assert.strictEqual(mocks.checkoutCalls.at(-1).priceId, process.env.STRIPE_PRO_PRICE);

    token = await getToken(agent);
    valid = await request(agent, 'POST', '/manage', {
      body: { _csrf: token }
    });
    assert.strictEqual(valid.res.statusCode, 302);
    assert.strictEqual(valid.res.headers.location, '/mock-portal-session');
    assert.strictEqual(mocks.portalCalls.at(-1).customerId, 'cus_owner_123');

    token = await getToken(agent);
    valid = await request(agent, 'POST', '/brand-brain', {
      body: { business_name: 'CSRF Co', brand_voice: 'professional' },
      headers: { 'X-CSRF-Token': token }
    });
    assert.strictEqual(valid.res.statusCode, 302);
    assert.strictEqual(valid.res.headers.location, '/brand-brain');

    token = await getToken(agent);
    valid = await request(agent, 'POST', '/welcome', {
      body: { goal: 'launch_product', _csrf: token }
    });
    assert.strictEqual(valid.res.statusCode, 302);
    assert.strictEqual(valid.res.headers.location, '/dashboard');

    token = await getToken(agent);
    valid = await request(agent, 'POST', '/logout', {
      body: { _csrf: token }
    });
    assert.strictEqual(valid.res.statusCode, 302);
    assert.strictEqual(valid.res.headers.location, '/');

    const webhook = await request(agent, 'POST', '/stripe/webhook', {
      contentType: 'application/json',
      body: { id: 'evt_missing_signature' }
    });
    assert.strictEqual(webhook.res.statusCode, 400);
    assert.match(webhook.body, /Webhook signature verification failed/);
    assert.strictEqual(mocks.webhookConstructCalls.length, 1);

    token = await getToken(agent);
    const login = await request(agent, 'POST', '/login', {
      body: { email: 'owner@example.com', password: 'correct-password', _csrf: token }
    });
    assert.strictEqual(login.res.statusCode, 302);
    assert.match(login.res.headers.location, /^\/(dashboard|welcome)$/);

    const googleStart = await request(agent, 'GET', '/auth/google');
    assert.strictEqual(googleStart.res.statusCode, 302);

    const googleCallback = await request(agent, 'GET', '/auth/google/callback');
    assert.strictEqual(googleCallback.res.statusCode, 302);
  } finally {
    server.close();
  }
}

run()
  .then(() => {
    console.log('BUG-002M CSRF protection tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
