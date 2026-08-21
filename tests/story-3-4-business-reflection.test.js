const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { applyReflectionEdit, buildBusinessReflection } = require('../lib/businessReflection');
const discoveryRoutes = require('../routes/discovery');

function confirmed(value, label = value) {
  return { value, label, confidence: 1, source: 'user_confirmed' };
}

function requiredUnderstanding() {
  return {
    businessType: confirmed('physical_product', 'Physical Product'),
    targetAudience: confirmed('consumers', 'Individual consumers'),
    customerMotivation: confirmed('solve_problem', 'It solves a clear problem'),
    salesChannel: confirmed('amazon', 'Amazon'),
    competitiveDifferentiation: confirmed('partial', 'It is different in a few ways'),
    launchStage: confirmed('development', 'In development')
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

async function createReadySession() {
  const initialDescription = 'Organic turmeric supplement';
  const confirmedRequired = requiredUnderstanding();
  delete confirmedRequired.businessType;
  const business = await understandBusiness({
    objective: 'launch_product',
    answer: initialDescription,
    existingUnderstanding: confirmedRequired
  });
  const answers = {
    initial_description: initialDescription,
    target_audience: 'consumers',
    customer_motivation: 'solve_problem',
    sales_channel: 'amazon',
    competitive_differentiation: 'partial',
    launch_stage: 'development'
  };
  const intelligence = analyzeDiscovery({
    objective: 'launch_product',
    understanding: business.understanding,
    unknowns: business.unknowns,
    answers
  });
  return {
    objective: 'launch_product',
    answers,
    understanding: business.understanding,
    unknowns: business.unknowns,
    completedQuestions: Object.keys(answers),
    completion: intelligence.completion,
    knowledgeDomains: intelligence.knowledgeDomains,
    nextQuestion: intelligence.nextQuestion,
    reasoning: intelligence.reasoning,
    remainingKnowledgeGaps: intelligence.remainingKnowledgeGaps,
    planningReadiness: intelligence.planningReadiness,
    reflectionStartedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function run() {
  const optionalMissing = analyzeDiscovery({
    objective: 'launch_product',
    understanding: requiredUnderstanding(),
    unknowns: ['brand', 'budget', 'timeline'],
    answers: {}
  });
  assert.strictEqual(optionalMissing.planningReadiness.ready, true);
  assert.deepStrictEqual(optionalMissing.planningReadiness.optionalKnowledgeGaps, ['Brand', 'Budget', 'Timeline']);
  assert.strictEqual(optionalMissing.nextQuestion, null, 'optional domains must not block or add required questions');

  const missingRequired = requiredUnderstanding();
  delete missingRequired.targetAudience;
  const blockedReadiness = analyzeDiscovery({
    objective: 'launch_product',
    understanding: missingRequired,
    unknowns: ['targetAudience'],
    answers: {}
  });
  assert.strictEqual(blockedReadiness.planningReadiness.ready, false);
  assert(blockedReadiness.planningReadiness.unsatisfiedRequiredDomains.includes('Customer'));

  const reflection = buildBusinessReflection({
    answers: { initial_description: 'Organic turmeric supplement' },
    understanding: requiredUnderstanding(),
    planningReadiness: optionalMissing.planningReadiness
  });
  assert(reflection.groups.some((group) => group.domain === 'Product'));
  assert(reflection.groups.flatMap((group) => group.fields).every((field) => field.key && field.confidenceMessage));
  assert(reflection.groups.flatMap((group) => group.fields).every((field) => !field.confidenceMessage.includes('%')));

  const edit = applyReflectionEdit({
    answers: { initial_description: 'Original product' },
    understanding: requiredUnderstanding(),
    field: 'targetAudience',
    value: 'Independent wellness retailers'
  });
  assert.strictEqual(edit.existingUnderstanding.targetAudience.value, 'Independent wellness retailers');
  assert.strictEqual(edit.existingUnderstanding.targetAudience.source, 'user_confirmed');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-4-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate', async (req, res) => {
    req.session.userId = 34;
    req.session.discoverySession = await createReadySession();
    res.redirect('/discovery/reflection');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.use(discoveryRoutes);

  const server = await listen(app);
  const anonymous = { server, cookie: '' };
  const authenticated = { server, cookie: '' };
  try {
    const denied = await request(anonymous, 'GET', '/discovery/reflection');
    assert.strictEqual(denied.res.statusCode, 302);
    assert.strictEqual(denied.res.headers.location, '/login');

    await request(authenticated, 'GET', '/test/authenticate');
    const page = await request(authenticated, 'GET', '/discovery/reflection');
    assert.strictEqual(page.res.statusCode, 200);
    assert.match(page.body, /Here's what I've learned about your business\./);
    assert.match(page.body, /Physical Product/);
    assert.match(page.body, /Areas I'd still like to improve/);
    assert.match(page.body, /Build My Personalized Plan/);
    assert.doesNotMatch(page.body, /\d+%/);
    assert.match(page.body, /name="field" value="initial_description"/);
    assert.match(page.body, /name="field" value="targetAudience"/);
    const token = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];

    const missingCsrf = await request(authenticated, 'POST', '/discovery/reflection/edit', {
      field: 'initial_description',
      value: 'AI appointment scheduling software for dentists'
    });
    assert.strictEqual(missingCsrf.res.statusCode, 403);

    const edited = await request(authenticated, 'POST', '/discovery/reflection/edit', {
      _csrf: token,
      field: 'initial_description',
      value: 'AI appointment scheduling software for dentists'
    });
    assert.strictEqual(edited.res.statusCode, 303);
    assert.strictEqual(edited.res.headers.location, '/discovery/reflection');

    const editedSession = JSON.parse((await request(authenticated, 'GET', '/test/session')).body);
    assert.strictEqual(editedSession.answers.initial_description, 'AI appointment scheduling software for dentists');
    assert.strictEqual(editedSession.understanding.businessType.value, 'software');
    assert.strictEqual(editedSession.understanding.industry.value, 'technology');
    assert.strictEqual(editedSession.planningReadiness.ready, true);
    assert.strictEqual(editedSession.planningConfirmedAt, null);

    const refreshed = await request(authenticated, 'GET', '/discovery/reflection');
    assert.match(refreshed.body, /Software \/ SaaS/);
    const refreshedToken = refreshed.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const confirmedPlan = await request(authenticated, 'POST', '/discovery/reflection/plan', { _csrf: refreshedToken });
    assert.strictEqual(confirmedPlan.res.statusCode, 303);
    assert.match(JSON.parse((await request(authenticated, 'GET', '/test/session')).body).planningConfirmedAt, /^\d{4}-/);

    const confirmedPage = await request(authenticated, 'GET', '/discovery/reflection');
    assert.match(confirmedPage.body, /confirmed and ready for planning/);
    const confirmedToken = confirmedPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const madeUncertain = await request(authenticated, 'POST', '/discovery/reflection/edit', {
      _csrf: confirmedToken,
      field: 'targetAudience',
      value: 'unsure'
    });
    assert.strictEqual(madeUncertain.res.statusCode, 303);

    const blockedPage = await request(authenticated, 'GET', '/discovery/reflection');
    assert.match(blockedPage.body, /A few essentials still need attention\./);
    assert.match(blockedPage.body, /disabled aria-disabled="true"/);
    const blockedToken = blockedPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const blockedPlan = await request(authenticated, 'POST', '/discovery/reflection/plan', { _csrf: blockedToken });
    assert.strictEqual(blockedPlan.res.statusCode, 409);

    console.log('Story 3.4 Business Reflection tests passed');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
