const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const discoveryRoutes = require('../routes/discovery');

function known(value, label = value, confidence = 1) {
  return { value, label, confidence, source: 'user_confirmed' };
}

function completeUnderstanding() {
  return {
    businessType: known('physical_product'),
    targetAudience: known('consumers'),
    customerMotivation: known('solve_problem'),
    salesChannel: known('amazon'),
    competitiveDifferentiation: known('partial'),
    launchStage: known('development'),
    brand: known('in_progress'),
    budget: known('1000_5000'),
    timeline: known('one_to_three_months')
  };
}

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
  const complete = analyzeDiscovery({
    objective: 'launch_product',
    understanding: completeUnderstanding(),
    unknowns: [],
    answers: {}
  });
  assert.strictEqual(complete.completion, 100, 'all known domains should produce full weighted completion');
  assert.strictEqual(complete.nextQuestion, null);
  assert.strictEqual(complete.remainingKnowledgeGaps.length, 0);

  const empty = analyzeDiscovery({
    objective: 'launch_product',
    understanding: {},
    unknowns: [],
    answers: {}
  });
  assert.strictEqual(empty.completion, 0);
  assert.strictEqual(empty.nextQuestion.id, 'business_type');
  assert.strictEqual(empty.nextQuestion.domain, 'Product');
  assert(!Array.isArray(empty.nextQuestion), 'the engine must return one question, not a questionnaire');

  const priorityUnderstanding = completeUnderstanding();
  delete priorityUnderstanding.customerMotivation;
  delete priorityUnderstanding.salesChannel;
  const priority = analyzeDiscovery({
    objective: 'launch_product',
    understanding: priorityUnderstanding,
    unknowns: ['customerMotivation', 'salesChannel'],
    answers: {}
  });
  assert.strictEqual(priority.nextQuestion.id, 'customer_motivation');
  assert.strictEqual(priority.nextQuestion.importance, 95);

  const confidenceUnderstanding = completeUnderstanding();
  confidenceUnderstanding.targetAudience = known('consumers', 'Consumers', 0.5);
  confidenceUnderstanding.salesChannel = known('amazon', 'Amazon', 0.2);
  const confidenceWeighted = analyzeDiscovery({
    objective: 'launch_product',
    understanding: confidenceUnderstanding,
    unknowns: ['targetAudience', 'salesChannel'],
    answers: {}
  });
  assert.strictEqual(confidenceWeighted.knowledgeDomains.Customer.status, 'partial');
  assert.strictEqual(confidenceWeighted.knowledgeDomains['Sales Channel'].confidence, 0.2);
  assert.strictEqual(confidenceWeighted.nextQuestion.id, 'sales_channel');

  const knownProduct = analyzeDiscovery({
    objective: 'launch_product',
    understanding: { businessType: known('physical_product') },
    unknowns: [],
    answers: {}
  });
  assert(knownProduct.reasoning.some(function(item) {
    return item.skippedDomain === 'Product'
      && item.reason === 'Already understood from previous answers.';
  }));
  assert.notStrictEqual(knownProduct.nextQuestion.domain, 'Product');

  const answeredUnknown = analyzeDiscovery({
    objective: 'launch_product',
    understanding: {
      businessType: known('physical_product'),
      targetAudience: known('unsure', "I'm not sure yet")
    },
    unknowns: ['targetAudience'],
    answers: { target_audience: 'unsure' }
  });
  assert(answeredUnknown.remainingKnowledgeGaps.includes('Customer'));
  assert.strictEqual(answeredUnknown.nextQuestion.id, 'customer_motivation');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-3-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate', (req, res) => {
    req.session.userId = 33;
    res.redirect('/discovery');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.use(discoveryRoutes);

  const server = await listen(app);
  const anonymous = { server, cookie: '' };
  const authenticated = { server, cookie: '' };
  try {
    const denied = await request(anonymous, 'GET', '/discovery');
    assert.strictEqual(denied.res.statusCode, 302);
    assert.strictEqual(denied.res.headers.location, '/login');

    await request(authenticated, 'GET', '/test/authenticate');
    const initial = await request(authenticated, 'GET', '/discovery');
    const token = initial.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const submitted = await request(authenticated, 'POST', '/discovery', {
      _csrf: token,
      questionId: 'initial_description',
      whatBuilding: 'Organic turmeric supplement'
    });
    assert.strictEqual(submitted.res.statusCode, 303);

    const stored = JSON.parse((await request(authenticated, 'GET', '/test/session')).body);
    assert.strictEqual(stored.knowledgeDomains.Product.status, 'known');
    assert.strictEqual(stored.nextQuestion.id, 'target_audience');
    assert.strictEqual(typeof stored.completion, 'number');
    assert(stored.remainingKnowledgeGaps.includes('Customer'));

    const rendered = await request(authenticated, 'GET', '/discovery');
    assert.match(rendered.body, /Understanding your business\.\.\./);
    assert.match(rendered.body, /Who is this product primarily for\?/);
    assert.strictEqual((rendered.body.match(/<fieldset/g) || []).length, 1);
    assert(!rendered.body.includes(`${stored.completion}%`), 'raw completion must remain internal');

    const blocked = await request(authenticated, 'POST', '/discovery', {
      questionId: 'target_audience',
      choice: 'consumers'
    });
    assert.strictEqual(blocked.res.statusCode, 403);

    console.log('Story 3.3 Discovery Intelligence Engine tests passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
