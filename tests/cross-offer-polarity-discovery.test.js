const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const Database = require('better-sqlite3');

process.env.AI_DISCOVERY_ENABLED = 'false';
process.env.AI_STRATEGY_ENABLED = 'false';

const { createCsrfProtection } = require('../lib/csrf');
const { runMigrationEngine } = require('../db/migrations');
const discoveryRoutes = require('../routes/discovery');
const { hasPositiveMatch } = require('../lib/discoveryPolarity');
const { understandBusiness } = require('../lib/businessUnderstanding');
const {
  activeMemory,
  guardObjectiveSubjectResolution,
  memoryUnderstanding,
  promoteObjectiveMemory,
  resolveObjectiveSubjects
} = require('../lib/businessMemory');

const confirmed = (value, label = value) => ({ value, label, source: 'user_confirmed', confidence: 1 });
const CONTAMINATED_DISPLAY = /Using what CopyQuick remembers about Residential Remodeling|Consultation-led remodeling services|Booked call or appointment|Book a consultation/i;
const SAAS_DESCRIPTION = [
  'We offer B2B SaaS project-management software for small professional-services teams.',
  'Customers start a self-service free trial and create an online account.',
  'They do not book a consultation or sales conversation.',
  'Do not reuse residential remodeling, homeowner, referral, consultation, or booked-appointment context.'
].join(' ');

function fixtureDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrationEngine(db, { logger() {} });
  const userId = Number(db.prepare(`INSERT INTO users(email,name,builder_goal)
    VALUES ('polarity-discovery@example.com','Polarity Discovery','increase_conversion_rates')`).run().lastInsertRowid);
  const remodeling = promoteObjectiveMemory(db, {
    userId,
    objective: 'get_more_customers',
    referenceId: 'approved-remodeling-plan',
    answers: { initial_description: 'Residential remodeling consultations for homeowners planning major renovations.' },
    understanding: {
      businessType: confirmed('service', 'Service Business'),
      industry: confirmed('home_services', 'Home Services'),
      category: confirmed('residential_remodeling', 'Residential Remodeling'),
      targetAudience: confirmed('homeowners', 'Homeowners planning major renovations'),
      currentOffer: confirmed('remodeling_consultations', 'Consultation-led remodeling services'),
      currentAcquisitionChannel: confirmed('referrals', 'Referrals')
    }
  });
  return { db, userId, remodeling };
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
      hostname: '127.0.0.1', port: agent.port, method, path: url, headers
    }, (res) => {
      const cookies = res.headers['set-cookie'];
      if (cookies) agent.cookie = cookies.map(cookie => cookie.split(';')[0]).join('; ');
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function token(body) {
  const value = body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  assert(value, 'rendered form must include a CSRF token');
  return value;
}

async function unitAcceptance() {
  const { db, userId, remodeling } = fixtureDb();
  try {
    for (const excluded of [
      'do not reuse residential remodeling',
      'do not use residential remodeling',
      'not a residential remodeling service',
      'does not use residential remodeling',
      'different from residential remodeling',
      'unlike residential remodeling',
      'exclude residential remodeling',
      'should not inherit residential remodeling'
    ]) {
      const resolution = resolveObjectiveSubjects(db, {
        userId,
        initialDescription: `B2B SaaS project-management software for professional-services teams; ${excluded}.`
      });
      assert.strictEqual(resolution.selection, 'new', `${excluded} must not select the remembered offer`);
      assert.strictEqual(resolution.offer, null);
    }

    for (const wording of [
      'This is not a residential remodeling service, but a project-management software platform.',
      'This company does not use residential remodeling and this company offers project-management software.',
      'Exclude residential remodeling; this is project-management software.',
      'DO NOT REUSE RESIDENTIAL-REMODELING CONTEXT. We offer PROJECT-MANAGEMENT SOFTWARE.',
      'This is unlike residential remodeling. It is project-management software.'
    ]) {
      assert.strictEqual(
        hasPositiveMatch(wording, /project[- ]management\s+(?:software|app|platform|application)/i),
        true,
        `positive current-offer evidence must survive a bounded exclusion: ${wording}`
      );
      const resolution = resolveObjectiveSubjects(db, { userId, initialDescription: wording });
      assert.strictEqual(resolution.selection, 'new', 'positive software evidence must outrank excluded old-offer terms');
      assert.strictEqual(resolution.offer, null);
    }
    assert.strictEqual(
      hasPositiveMatch(
        'Do not reuse residential remodeling, homeowners, referrals, consultation, or booked appointments.',
        /residential[- ]remodel(?:ing)?/i
      ),
      false,
      'a coordinated exclusion list must stay negative'
    );
    const amplifiedInput = `${'This neutral sentence adds bounded context. '.repeat(45)} We offer project-management software.`;
    assert.strictEqual(
      hasPositiveMatch(amplifiedInput, /project[- ]management\s+(?:software|app|platform|application)/i),
      true,
      'bounded scanning must preserve late positive evidence'
    );

    for (const wording of [
      'Residential remodeling for homeowners who are planning major renovations.',
      'We provide home remodeling consultations for homeowners.'
    ]) {
      const resolution = resolveObjectiveSubjects(db, { userId, initialDescription: wording });
      assert.strictEqual(resolution.offer.id, remodeling.subjects.offer.id, 'positive same-offer language preserves continuity');
    }

    const rawResolution = resolveObjectiveSubjects(db, { userId, initialDescription: SAAS_DESCRIPTION });
    const current = await understandBusiness({ objective: 'increase_conversion_rates', answer: SAAS_DESCRIPTION, env: {} });
    const guarded = guardObjectiveSubjectResolution(rawResolution, {
      initialDescription: SAAS_DESCRIPTION,
      understanding: current.understanding
    });
    assert.strictEqual(rawResolution.selection, 'new');
    assert.strictEqual(guarded.offer, null);
    assert.strictEqual(current.understanding.businessType.value, 'software');
    assert.strictEqual(current.understanding.industry.value, 'technology');
    assert.strictEqual(current.understanding.currentOffer.label, 'Project management software');
    assert.strictEqual(current.understanding.targetAudience.label, 'Small professional-services teams');
    assert.strictEqual(current.understanding.funnelType.value, 'trial_signup');
    assert.strictEqual(current.understanding.primaryCta.label, 'Start a free trial');

    const remembered = memoryUnderstanding(db, {
      userId,
      objective: 'increase_conversion_rates',
      initialDescription: SAAS_DESCRIPTION,
      subjectId: guarded.offer?.id
    });
    assert.strictEqual(remembered.records.filter(record => record.scope_type === 'offer').length, 0);
    assert.strictEqual(remembered.understanding.currentOffer, undefined);
    assert.strictEqual(remembered.understanding.trafficSource, undefined);
    assert.strictEqual(remembered.understanding.currentAcquisitionChannel, undefined);

    const approvedSaas = promoteObjectiveMemory(db, {
      userId,
      objective: 'increase_conversion_rates',
      referenceId: 'approved-polarity-plan',
      answers: { initial_description: SAAS_DESCRIPTION },
      understanding: current.understanding
    });
    assert.strictEqual(approvedSaas.subjects.offer.canonical_key, 'project management software');
    const approvedOfferRecords = activeMemory(db, {
      userId,
      subjectType: 'offer',
      subjectId: approvedSaas.subjects.offer.id,
      includePending: true
    });
    assert(approvedOfferRecords.length > 0, 'approved positive SaaS facts should be promoted');
    assert.doesNotMatch(
      approvedOfferRecords.map(record => `${record.value} ${record.label}`).join(' '),
      /residential|homeowner|referral|consultation|booked appointment/i,
      'raw exclusions must not become durable business facts'
    );

    const negativeConversion = await understandBusiness({
      objective: 'increase_conversion_rates',
      answer: 'This software does not book a consultation, schedule an appointment, use a sales call, use checkout, start a trial, create an account, support signup, make a purchase, or offer a download.',
      env: {}
    });
    assert.strictEqual(negativeConversion.understanding.funnelType, undefined);
    assert.strictEqual(negativeConversion.understanding.primaryCta, undefined);

    promoteObjectiveMemory(db, {
      userId,
      objective: 'increase_conversion_rates',
      referenceId: 'approved-project-management-plan',
      answers: { initial_description: 'B2B project-management software for professional-services teams.' },
      understanding: {
        currentOffer: confirmed('project_management_software', 'Project management software'),
        targetAudience: confirmed('professional_services_teams', 'Small professional-services teams'),
        funnelType: confirmed('trial_signup', 'Start a trial or account')
      }
    });
    promoteObjectiveMemory(db, {
      userId,
      objective: 'increase_conversion_rates',
      referenceId: 'approved-accounting-plan',
      answers: { initial_description: 'Accounting software for small businesses.' },
      understanding: { currentOffer: confirmed('accounting_software', 'Accounting software') }
    });
    const ambiguous = resolveObjectiveSubjects(db, { userId, initialDescription: 'Improve conversion for our software.' });
    assert.strictEqual(ambiguous.requiresSelection, true, 'multiple compatible software subjects require a customer choice');
    assert.strictEqual(ambiguous.offer, null);
  } finally {
    db.close();
  }
}

async function renderedAcceptance() {
  const { db, userId } = fixtureDb();
  const app = express();
  app.locals.copyquickDb = db;
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'cross-offer-polarity-test-secret', resave: false, saveUninitialized: true }));
  app.get('/test/authenticate', (req, res) => {
    req.session.userId = userId;
    res.redirect('/discovery');
  });
  app.get('/test/reset-discovery', (req, res) => {
    req.session.discoverySession = null;
    res.redirect('/discovery');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.use(discoveryRoutes);

  const server = await listen(app);
  const agent = { server, port: server.address().port, cookie: '' };
  const beforeRecords = activeMemory(db, { userId, includePending: true }).length;
  try {
    await request(agent, 'GET', '/test/authenticate');
    const initialPage = await request(agent, 'GET', '/discovery');
    const submitted = await request(agent, 'POST', '/discovery', {
      _csrf: token(initialPage.body),
      questionId: 'initial_description',
      whatBuilding: SAAS_DESCRIPTION
    });
    assert.strictEqual(submitted.res.statusCode, 303);
    assert.strictEqual(submitted.res.headers.location, '/discovery');

    let stored = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert.strictEqual(stored.memorySubjectIds.offer, null);
    assert.strictEqual(stored.memoryContext, null);
    assert.strictEqual(stored.understanding.businessType.label, 'Software / SaaS');
    assert.strictEqual(stored.understanding.industry.label, 'Technology');
    assert.strictEqual(stored.understanding.targetAudience.label, 'Small professional-services teams');
    assert.strictEqual(stored.understanding.funnelType.value, 'trial_signup');
    assert.strictEqual(stored.understanding.primaryCta.label, 'Start a free trial');
    assert.strictEqual(stored.understanding.trafficSource, undefined);
    assert.strictEqual(stored.understanding.currentAcquisitionChannel, undefined);

    const discoveryPage = await request(agent, 'GET', '/discovery');
    assert.strictEqual(discoveryPage.res.statusCode, 200);
    const summary = discoveryPage.body.match(/<ul class="discovery-understanding-list"[\s\S]*?<\/ul>/)?.[0] || '';
    assert.match(summary, /Software \/ SaaS/);
    assert.match(summary, /Technology/);
    assert.match(summary, /Small professional-services teams/);
    assert.match(summary, /Start a trial or account/);
    assert.match(summary, /Start a free trial/);
    assert.doesNotMatch(summary, CONTAMINATED_DISPLAY);
    assert.doesNotMatch(discoveryPage.body, /Using what CopyQuick remembers about/);
    assert.strictEqual((summary.match(/Referrals/gi) || []).length, 0);

    const freeTextAnswers = {
      conversion_page: 'The self-service signup page explains the workflow and invites visitors to start a trial.',
      conversion_evidence: 'No measured conversion baseline has been confirmed yet.',
      conversion_friction: 'Some visitors ask what happens after account creation.'
    };
    for (let step = 0; step < 10; step += 1) {
      stored = JSON.parse((await request(agent, 'GET', '/test/session')).body);
      if (stored.discoveryCompleteForNow) break;
      const question = stored.nextQuestion;
      assert(question, 'Discovery should provide the next bounded question');
      const page = await request(agent, 'GET', '/discovery');
      const body = { _csrf: token(page.body), questionId: question.id };
      if (question.type === 'free_text') {
        body.freeTextAnswer = freeTextAnswers[question.id] || 'No additional confirmed detail is available.';
      } else if (question.type === 'multi_choice') {
        body.choices = question.options.find(option => option.value === 'unsure')?.value || question.options[0].value;
      } else {
        body.choice = question.options.find(option => option.value === 'unsure')?.value || question.options[0].value;
      }
      const response = await request(agent, 'POST', '/discovery', body);
      assert.strictEqual(response.res.statusCode, 303);
    }

    stored = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert.strictEqual(stored.discoveryCompleteForNow, true);
    assert.strictEqual(stored.planningReadiness.ready, true);
    assert.strictEqual(activeMemory(db, { userId, includePending: true }).length, beforeRecords, 'Discovery must not promote durable memory');

    const reflection = await request(agent, 'GET', '/discovery/reflection');
    assert.strictEqual(reflection.res.statusCode, 200);
    assert.match(reflection.body, /Project management software/);
    assert.match(reflection.body, /Small professional-services teams/);
    assert.match(reflection.body, /Start a trial or account/);
    assert.doesNotMatch(reflection.body, /<strong>(?:Consultation-led remodeling services|Booked call or appointment|Book a consultation)<\/strong>|Using what CopyQuick remembers/i);

    const planned = await request(agent, 'POST', '/discovery/reflection/plan', { _csrf: token(reflection.body) });
    assert.strictEqual(planned.res.statusCode, 303);
    assert.strictEqual(planned.res.headers.location, '/discovery/strategy');
    const strategy = await request(agent, 'GET', '/discovery/strategy');
    assert.strictEqual(strategy.res.statusCode, 200);
    assert.match(strategy.body, /trial/i);
    assert.doesNotMatch(strategy.body, CONTAMINATED_DISPLAY);

    const buildPlan = await request(agent, 'GET', '/discovery/build-plan');
    assert.strictEqual(buildPlan.res.statusCode, 200);
    assert.match(buildPlan.body, /trial/i);
    assert.doesNotMatch(buildPlan.body, CONTAMINATED_DISPLAY);
    stored = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert.strictEqual(stored.buildPlan.summary.conversionMode, 'SAAS_TRIAL_SIGNUP');
    assert.strictEqual(stored.memorySubjectIds.offer, null);
    assert.strictEqual(Boolean(stored.approvedProductionSet), false);
    assert.strictEqual(activeMemory(db, { userId, includePending: true }).length, beforeRecords, 'Build Plan viewing must not promote durable memory');

    await request(agent, 'GET', '/test/reset-discovery');
    const sameOfferInitial = await request(agent, 'GET', '/discovery');
    const sameOfferDescription = 'Residential remodeling consultations for homeowners planning major renovations. Most of our work comes from referrals. Visitors book a consultation.';
    const sameOfferPost = await request(agent, 'POST', '/discovery', {
      _csrf: token(sameOfferInitial.body),
      questionId: 'initial_description',
      whatBuilding: sameOfferDescription
    });
    assert.strictEqual(sameOfferPost.res.statusCode, 303);
    const sameOfferPage = await request(agent, 'GET', '/discovery');
    const sameOfferSummary = sameOfferPage.body.match(/<ul class="discovery-understanding-list"[\s\S]*?<\/ul>/)?.[0] || '';
    assert.strictEqual((sameOfferPage.body.match(/Using what CopyQuick remembers about/g) || []).length, 1);
    assert.strictEqual((sameOfferSummary.match(/Referrals/g) || []).length, 1, 'one remembered channel produces one summary chip');
    const sameOfferSession = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert(sameOfferSession.memorySubjectIds.offer, 'positive same-offer input retains compatible memory');
    assert.strictEqual(activeMemory(db, { userId, includePending: true }).length, beforeRecords, 'same-offer Discovery still does not promote memory');

    promoteObjectiveMemory(db, {
      userId,
      objective: 'increase_conversion_rates',
      referenceId: 'rendered-project-management-plan',
      answers: { initial_description: 'Project-management software for professional-services teams.' },
      understanding: { currentOffer: confirmed('project_management_software', 'Project management software') }
    });
    promoteObjectiveMemory(db, {
      userId,
      objective: 'increase_conversion_rates',
      referenceId: 'rendered-accounting-plan',
      answers: { initial_description: 'Accounting software for small businesses.' },
      understanding: { currentOffer: confirmed('accounting_software', 'Accounting software') }
    });
    await request(agent, 'GET', '/test/reset-discovery');
    const ambiguousInitial = await request(agent, 'GET', '/discovery');
    const ambiguousPost = await request(agent, 'POST', '/discovery', {
      _csrf: token(ambiguousInitial.body),
      questionId: 'initial_description',
      whatBuilding: 'Improve conversion for our software.'
    });
    assert.strictEqual(ambiguousPost.res.statusCode, 303);
    const ambiguousPage = await request(agent, 'GET', '/discovery');
    const ambiguousSession = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert.strictEqual(ambiguousSession.offerSelectionPending, true);
    assert.strictEqual(ambiguousSession.memoryContext, undefined);
    assert.match(ambiguousPage.body, /Project Management Software/);
    assert.match(ambiguousPage.body, /Accounting Software/);
    assert.match(ambiguousPage.body, /different or new offer/i);
    assert.doesNotMatch(ambiguousPage.body, /Using what CopyQuick remembers about/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

Promise.resolve()
  .then(unitAcceptance)
  .then(renderedAcceptance)
  .then(() => console.log('Cross-offer polarity-aware Discovery tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
