const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { createCsrfProtection } = require('../lib/csrf');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { validateApprovedProductionSession } = require('../lib/productionInitialization');
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
    const req = http.request({ hostname: '127.0.0.1', port: agent.server.address().port, method, path: url, headers }, (res) => {
      if (res.headers['set-cookie']) agent.cookie = res.headers['set-cookie'].map((item) => item.split(';')[0]).join('; ');
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function sessionState(agent) {
  return JSON.parse((await request(agent, 'GET', '/test/session')).body);
}

async function answerCurrent(agent, choice, otherAnswer) {
  const page = await request(agent, 'GET', '/discovery');
  const token = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  const state = await sessionState(agent);
  assert(state.nextQuestion, 'an active discovery question is required');
  return request(agent, 'POST', '/discovery', {
    _csrf: token,
    questionId: state.nextQuestion.id,
    choice,
    ...(otherAnswer ? { otherAnswer } : {})
  });
}

async function begin(agent) {
  await request(agent, 'GET', '/test/authenticate');
  const page = await request(agent, 'GET', '/discovery');
  const token = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  await request(agent, 'POST', '/discovery', {
    _csrf: token,
    questionId: 'initial_description',
    whatBuilding: 'an herbal supplement'
  });
  return sessionState(agent);
}

async function run() {
  const inferredOnly = analyzeDiscovery({
    objective: 'launch_product',
    understanding: {
      businessType: { value: 'physical_product', label: 'Physical Product', confidence: 0.95, source: 'inference' },
      category: { value: 'dietary_supplement', label: 'Dietary Supplement', confidence: 0.96, source: 'inference' }
    },
    answers: { initial_description: 'an herbal supplement' }
  });
  assert.strictEqual(inferredOnly.nextQuestion.id, 'supplement_intended_outcome');
  assert.strictEqual(inferredOnly.planningReadiness.ready, false);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'story-3-22-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate', (req, res) => { req.session.userId = 322; res.redirect('/discovery'); });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.get('/test/invalidate-essential-readiness', (req, res) => {
    req.session.discoverySession.understanding.intendedOutcome = { value: 'unsure', label: "I'm not sure yet", confidence: 1, source: 'user_confirmed' };
    req.session.discoverySession.answers.supplement_intended_outcome = 'unsure';
    req.session.discoverySession.answers.supplement_outcome_exploration = 'unsure';
    req.session.discoverySession.planningReadiness = { ready: true };
    res.sendStatus(204);
  });
  app.use(discoveryRoutes);
  const server = await listen(app);

  try {
    const blocked = { server, cookie: '' };
    let state = await begin(blocked);
    assert.strictEqual(state.nextQuestion.id, 'supplement_intended_outcome');
    assert.strictEqual(state.understanding.intendedOutcome, undefined, 'suggested directions must not become facts before selection');

    const intendedOutcomePage = await request(blocked, 'GET', '/discovery');
    assert.match(intendedOutcomePage.body, /What is the primary wellness goal this supplement is intended to support\?/);
    assert.match(intendedOutcomePage.body, /Choose the closest direction for now\. You can refine it later\./);
    for (const value of ['everyday_wellness', 'energy_focus', 'digestive_wellness', 'sleep_stress_support', 'mobility_active_lifestyle', 'immune_health', 'healthy_aging']) {
      assert.match(intendedOutcomePage.body, new RegExp(`value="${value}"`));
    }

    await answerCurrent(blocked, 'unsure');
    state = await sessionState(blocked);
    assert.strictEqual(state.answers.supplement_intended_outcome, 'unsure');
    assert.strictEqual(state.nextQuestion.id, 'supplement_outcome_exploration');
    assert.strictEqual(state.nextQuestion.guidedExploration, true);
    assert.strictEqual(state.nextQuestion.prompt, 'Which wellness goal feels most useful to explore first?');
    assert(state.nextQuestion.options.some((option) => option.value === 'immune_wellness_exploration'));
    assert(state.nextQuestion.options.some((option) => option.value === 'healthy_aging_exploration'));

    await answerCurrent(blocked, 'unsure');
    state = await sessionState(blocked);
    assert.strictEqual(state.understanding.intendedOutcome.value, 'unsure');
    assert.notStrictEqual(state.nextQuestion.id, 'supplement_outcome_exploration');
    assert.strictEqual(state.nextQuestion.id, 'supplement_concept_maturity');

    await answerCurrent(blocked, 'idea_only');
    assert.strictEqual((await sessionState(blocked)).nextQuestion.id, 'target_audience');
    await answerCurrent(blocked, 'consumers');
    assert.strictEqual((await sessionState(blocked)).nextQuestion.id, 'launch_stage');
    await answerCurrent(blocked, 'idea');
    assert.strictEqual((await sessionState(blocked)).nextQuestion.id, 'sales_channel');
    const completed = await answerCurrent(blocked, 'amazon');
    assert.strictEqual(completed.res.headers.location, '/discovery/reflection');
    state = await sessionState(blocked);
    assert.strictEqual(state.nextQuestion, null);
    assert.strictEqual(state.discoveryCompleteForNow, true);
    assert.strictEqual(state.planningReadiness.ready, false);
    assert(state.planningReadiness.unresolvedBlockingRequirements.some((item) => item.id === 'intended_outcome'));
    assert(!state.answers.competitive_differentiation, 'differentiation must be deferred without a known product purpose');

    const reflection = await request(blocked, 'GET', '/discovery/reflection');
    assert.strictEqual(reflection.res.statusCode, 200);
    assert.match(reflection.body, /Intended Customer Outcome/);
    assert.match(reflection.body, /important decision is still open/);
    assert.doesNotMatch(reflection.body, /We know enough to build a useful strategy/);
    assert.match(reflection.body, /disabled aria-disabled="true"/);
    const reflectionToken = reflection.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    assert.strictEqual((await request(blocked, 'POST', '/discovery/reflection/plan', { _csrf: reflectionToken })).res.statusCode, 409);
    assert.strictEqual((await request(blocked, 'GET', '/discovery/strategy')).res.headers.location, '/discovery/reflection');
    assert.strictEqual((await request(blocked, 'GET', '/discovery/build-plan')).res.headers.location, '/discovery/reflection');
    assert.strictEqual(validateApprovedProductionSession(state).valid, false);

    const customOutcome = { server, cookie: '' };
    await begin(customOutcome);
    const emptyCustomOutcome = await answerCurrent(customOutcome, 'other');
    assert.strictEqual(emptyCustomOutcome.res.statusCode, 400);
    state = await sessionState(customOutcome);
    assert.strictEqual(state.nextQuestion.id, 'supplement_intended_outcome');
    await answerCurrent(customOutcome, 'other', 'Menopause wellness support');
    state = await sessionState(customOutcome);
    assert.deepStrictEqual(state.answers.supplement_intended_outcome, {
      value: 'other', detail: 'Menopause wellness support'
    });
    assert.strictEqual(state.understanding.intendedOutcome.value, 'Menopause wellness support');
    assert.strictEqual(state.understanding.intendedOutcome.label, 'Menopause wellness support');
    assert.strictEqual(state.nextQuestion.id, 'supplement_concept_maturity');

    const ready = { server, cookie: '' };
    await begin(ready);
    await answerCurrent(ready, 'digestive_wellness');
    state = await sessionState(ready);
    assert.strictEqual(state.understanding.intendedOutcome.value, 'digestive_wellness');
    assert.strictEqual(state.understanding.intendedOutcome.label, 'Digestive health');
    assert.strictEqual(state.nextQuestion.id, 'supplement_concept_maturity');
    await answerCurrent(ready, 'direction_no_formula');
    await answerCurrent(ready, 'consumers');
    await answerCurrent(ready, 'idea');
    await answerCurrent(ready, 'amazon');
    state = await sessionState(ready);
    assert.strictEqual(state.nextQuestion.id, 'competitive_differentiation');
    const readyRedirect = await answerCurrent(ready, 'unsure');
    assert.strictEqual(readyRedirect.res.headers.location, '/discovery/reflection');
    state = await sessionState(ready);
    assert.strictEqual(state.planningReadiness.ready, true, 'nonessential differentiation uncertainty must not block planning');
    assert(state.planningReadiness.unresolvedNonBlockingRequirements.some((item) => item.id === 'competitive_context'));
    assert.strictEqual(state.understanding.ingredients, undefined);
    assert.strictEqual(state.understanding.claimsEvidence, undefined);

    const readyReflection = await request(ready, 'GET', '/discovery/reflection');
    assert.match(readyReflection.body, /We know enough to build a useful strategy/);
    assert.match(readyReflection.body, /Intended Customer Outcome/);
    assert.match(readyReflection.body, /Digestive health/);
    assert.doesNotMatch(readyReflection.body, /digestive_wellness/);
    const readyToken = readyReflection.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const planned = await request(ready, 'POST', '/discovery/reflection/plan', { _csrf: readyToken });
    assert.strictEqual(planned.res.statusCode, 303);
    assert.strictEqual(planned.res.headers.location, '/discovery/strategy');
    assert.strictEqual((await request(ready, 'GET', '/discovery/strategy')).res.statusCode, 200);
    const buildPlanPage = await request(ready, 'GET', '/discovery/build-plan');
    assert.strictEqual(buildPlanPage.res.statusCode, 200);
    const approvalToken = buildPlanPage.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    await request(ready, 'GET', '/test/invalidate-essential-readiness');
    const blockedApproval = await request(ready, 'POST', '/discovery/build-plan/approve', { _csrf: approvalToken });
    assert.strictEqual(blockedApproval.res.headers.location, '/discovery/build-plan');
    assert.strictEqual(Boolean((await sessionState(ready)).approvedProductionSet), false);

    console.log('Story 3.22 Adaptive Product Discovery & Meaningful Readiness tests passed');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
