const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const discoveryRoutes = require('../routes/discovery');

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function request(agent, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : '';
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
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
      const cookies = res.headers['set-cookie'];
      if (cookies) agent.cookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function run() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-1-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate', (req, res) => {
    req.session.userId = 42;
    res.redirect('/discovery');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.use(discoveryRoutes);

  const server = await listen(app);
  const anonymous = { server, cookie: '' };
  const authenticated = { server, cookie: '' };

  try {
    const unauthenticated = await request(anonymous, 'GET', '/discovery');
    assert.strictEqual(unauthenticated.res.statusCode, 302);
    assert.strictEqual(unauthenticated.res.headers.location, '/login');

    const login = await request(authenticated, 'GET', '/test/authenticate');
    assert.strictEqual(login.res.statusCode, 302);

    const page = await request(authenticated, 'GET', '/discovery');
    assert.strictEqual(page.res.statusCode, 200);
    assert.match(page.body, /Let's Build Something Amazing/);
    assert.match(page.body, /What are you building\?/);
    assert.match(page.body, /Understanding your business\.\.\./);
    assert.strictEqual((page.body.match(/class="discovery-example"/g) || []).length, 5);
    const csrfToken = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    assert(csrfToken, 'Discovery form should include a CSRF token');

    const empty = await request(authenticated, 'POST', '/discovery', {
      _csrf: csrfToken,
      whatBuilding: '   '
    });
    assert.strictEqual(empty.res.statusCode, 400);
    assert.match(empty.body, /Tell us what you are building to continue\./);

    const refreshedPage = await request(authenticated, 'GET', '/discovery');
    const refreshedToken = refreshedPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const submitted = await request(authenticated, 'POST', '/discovery', {
      _csrf: refreshedToken,
      whatBuilding: '  Organic turmeric supplement  '
    });
    assert.strictEqual(submitted.res.statusCode, 303);
    assert.strictEqual(submitted.res.headers.location, '/discovery');

    const saved = await request(authenticated, 'GET', '/test/session');
    const savedSession = JSON.parse(saved.body);
    assert.strictEqual(savedSession.objective, 'launch_product');
    assert.strictEqual(savedSession.answers.initial_description, 'Organic turmeric supplement');
    assert.deepStrictEqual(savedSession.completedQuestions, ['initial_description']);
    assert.strictEqual(savedSession.understanding.businessType.value, 'physical_product');
    assert.strictEqual(savedSession.understanding.category.value, 'dietary_supplement');
    assert.strictEqual(savedSession.nextQuestion.id, 'target_audience');
    assert.strictEqual(typeof savedSession.completion, 'number');
    assert.strictEqual(savedSession.knowledgeDomains.Product.status, 'known');
    assert(savedSession.reasoning.some((item) => item.skippedDomain === 'Product'));
    assert.match(savedSession.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(savedSession.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const nextState = await request(authenticated, 'GET', '/discovery');
    assert.strictEqual(nextState.res.statusCode, 200);
    assert.match(nextState.body, /Here’s what I understand so far/);
    assert.match(nextState.body, /Physical Product/);
    assert.match(nextState.body, /Health &amp; Wellness/);
    assert.match(nextState.body, /Dietary Supplement/);
    assert.match(nextState.body, /Who is this product primarily for\?/);
    assert.match(nextState.body, /value="consumers"/);
    assert.match(nextState.body, /value="other"/);
    const nextToken = nextState.body.match(/name="_csrf" value="([^"]+)"/)?.[1];

    const missingCsrf = await request(authenticated, 'POST', '/discovery', {
      questionId: 'target_audience',
      choice: 'consumers'
    });
    assert.strictEqual(missingCsrf.res.statusCode, 403);

    const structuredSubmission = await request(authenticated, 'POST', '/discovery', {
      _csrf: nextToken,
      questionId: 'target_audience',
      choice: 'consumers'
    });
    assert.strictEqual(structuredSubmission.res.statusCode, 303);
    assert.strictEqual(structuredSubmission.res.headers.location, '/discovery');

    const updated = JSON.parse((await request(authenticated, 'GET', '/test/session')).body);
    assert.strictEqual(updated.answers.target_audience, 'consumers');
    assert.strictEqual(updated.understanding.targetAudience.source, 'user_confirmed');
    assert.strictEqual(updated.understanding.targetAudience.confidence, 1);
    assert(updated.completedQuestions.includes('target_audience'));
    assert.strictEqual(updated.nextQuestion.id, 'customer_motivation');

    const targetPage = await request(authenticated, 'GET', '/discovery');
    const targetToken = targetPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const emptyOther = await request(authenticated, 'POST', '/discovery', {
      _csrf: targetToken,
      questionId: 'customer_motivation',
      choice: 'other',
      otherAnswer: '   '
    });
    assert.strictEqual(emptyOther.res.statusCode, 400);
    assert.match(emptyOther.body, /Tell us a little more about your/);

    console.log('Story 3.1 Intelligent Discovery tests passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
