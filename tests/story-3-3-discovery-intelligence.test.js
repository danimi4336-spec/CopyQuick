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
  assert.strictEqual(complete.planningReadiness.ready, true);

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
  assert.strictEqual(confidenceWeighted.nextQuestion, null, 'user-confirmed answers are established even when a legacy confidence is low');

  const knownProduct = analyzeDiscovery({
    objective: 'launch_product',
    understanding: { businessType: known('physical_product') },
    unknowns: [],
    answers: {}
  });
  assert(knownProduct.reasoning.some(function(item) {
    return item.requirementId === 'product_context'
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
  assert.notStrictEqual(answeredUnknown.nextQuestion?.id, 'target_audience');
  assert(answeredUnknown.planningReadiness.unresolvedRequiredDomains.includes('Customer'));

  const requiredUncertaintyCases = [
    ['business_type', 'businessType', 'Product'],
    ['target_audience', 'targetAudience', 'Customer'],
    ['customer_motivation', 'customerMotivation', 'Customer Need / Desired Outcome'],
    ['sales_channel', 'salesChannel', 'Sales Channel'],
    ['competitive_differentiation', 'competitiveDifferentiation', 'Competitive Context'],
    ['launch_stage', 'launchStage', 'Launch Stage']
  ];
  requiredUncertaintyCases.forEach(function([questionId, field, domain]) {
    const understanding = completeUnderstanding();
    understanding[field] = known('unsure', "I'm not sure yet");
    const result = analyzeDiscovery({
      objective: 'launch_product',
      understanding,
      unknowns: [field],
      answers: { [questionId]: 'unsure' }
    });
    assert.notStrictEqual(result.nextQuestion?.id, questionId, `${questionId} must not repeat`);
    assert(result.remainingKnowledgeGaps.includes(domain));
    if (!['Sales Channel', 'Competitive Context'].includes(domain)) {
      assert(result.planningReadiness.unresolvedRequiredDomains.includes(domain));
    } else {
      assert(result.planningReadiness.unresolvedNonBlockingRequirements.some((item) => item.domain === domain));
    }
  });

  const allRequiredUncertain = analyzeDiscovery({
    objective: 'launch_product',
    understanding: Object.fromEntries(requiredUncertaintyCases.map(function([, field]) {
      return [field, known('unsure', "I'm not sure yet")];
    })),
    unknowns: requiredUncertaintyCases.map(function([, field]) { return field; }),
    answers: Object.fromEntries(requiredUncertaintyCases.map(function([questionId]) { return [questionId, 'unsure']; }))
  });
  assert.strictEqual(allRequiredUncertain.nextQuestion, null);
  assert.strictEqual(allRequiredUncertain.planningReadiness.ready, false);
  assert.deepStrictEqual(allRequiredUncertain.planningReadiness.unsatisfiedRequiredDomains, []);
  assert.strictEqual(allRequiredUncertain.planningReadiness.unresolvedBlockingRequirements.length, 4);
  assert.strictEqual(allRequiredUncertain.planningReadiness.unresolvedNonBlockingRequirements.length, 2);

  const otherAnswer = analyzeDiscovery({
    objective: 'launch_product',
    understanding: { ...completeUnderstanding(), customerMotivation: known('reduce daily friction', 'Reduce daily friction') },
    unknowns: [],
    answers: { customer_motivation: { value: 'other', detail: 'Reduce daily friction' } }
  });
  assert.notStrictEqual(otherAnswer.nextQuestion?.id, 'customer_motivation');
  assert(!otherAnswer.remainingKnowledgeGaps.includes('Customer Need / Desired Outcome'));

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
    assert.strictEqual(stored.nextQuestion.id, 'supplement_intended_outcome');
    assert.strictEqual(typeof stored.completion, 'number');
    assert(stored.remainingKnowledgeGaps.includes('Customer'));

    const rendered = await request(authenticated, 'GET', '/discovery');
    assert.match(rendered.body, /Understanding your business\.\.\./);
    assert.match(rendered.body, /What would you most like this supplement to help people with\?/);
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
