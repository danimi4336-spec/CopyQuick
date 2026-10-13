const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const Database = require('better-sqlite3');
const { assertIsolatedTestDatabase } = require('./helpers/isolatedTestDatabase');

assertIsolatedTestDatabase();

process.env.AI_DISCOVERY_ENABLED = 'false';
process.env.AI_STRATEGY_ENABLED = 'false';

const { createCsrfProtection } = require('../lib/csrf');
const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { runMigrationEngine } = require('../db/migrations');
const builderRoutes = require('../routes/builder');
const discoveryRoutes = require('../routes/discovery');
const { hasPositiveMatch } = require('../lib/discoveryPolarity');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { isReadyToUseAsset, productionBillingUnits } = require('../lib/productionArtifactPolicy');
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

const unsure = (label = "I'm not sure yet") => ({
  value: 'unsure', label, confidence: 1, source: 'user_confirmed'
});

function summaryFixture(name) {
  const base = {
    objective: 'increase_conversion_rates',
    answers: { initial_description: 'A sanitized software conversion fixture.' },
    understanding: {},
    unknowns: [],
    completedQuestions: ['initial_description'],
    stepHistory: [],
    startedAt: '2026-10-12T12:00:00.000Z',
    updatedAt: '2026-10-12T12:00:00.000Z'
  };
  if (name === 'four-open') {
    base.answers = {
      ...base.answers,
      conversion_traffic: 'unsure', conversion_page: 'unsure',
      conversion_evidence: 'unsure', conversion_friction: 'unsure'
    };
    base.understanding = {
      businessType: confirmed('software', 'Software / SaaS'),
      industry: confirmed('technology', 'Technology'),
      currentOffer: confirmed('project_management_software', 'Project management software'),
      funnelType: confirmed('trial_signup', 'Start a trial or account'),
      primaryCta: confirmed('start_free_trial', 'Start a free trial'),
      trafficSource: unsure(), pageExperience: unsure(),
      conversionEvidence: unsure(), conversionFriction: unsure()
    };
  } else if (name === 'facts-only') {
    base.understanding = { currentOffer: confirmed('software', 'Project management software') };
  } else if (name === 'open-only') {
    base.answers.conversion_traffic = 'unsure';
    base.understanding = { trafficSource: unsure() };
  } else if (name === 'fallback') {
    base.understanding = { legacyPrivateMetric: unsure() };
  } else if (name === 'open-aliases') {
    base.understanding = {
      currentAcquisitionChannel: unsure(), salesChannel: unsure(), trafficSource: unsure()
    };
  } else if (name === 'fact-aliases') {
    base.understanding = {
      trafficSource: confirmed('referrals', 'Referrals'),
      currentAcquisitionChannel: confirmed('referrals', 'Referrals'),
      salesChannel: confirmed('referrals', 'Referrals')
    };
  } else if (name === 'multi-choice') {
    base.objective = 'launch_product';
    base.understanding = {
      businessType: confirmed('physical_product', 'Physical Product'),
      category: confirmed('dietary_supplement', 'Dietary Supplement'),
      intendedOutcome: confirmed('digestive_wellness', 'Digestive health'),
      conceptMaturity: confirmed('idea_only', 'I only have the product idea'),
      productExplorationDirections: unsure()
    };
  } else if (name === 'supplement-variant') {
    base.objective = 'launch_product';
    base.answers.supplement_intended_outcome = 'unsure';
    base.understanding = {
      businessType: confirmed('physical_product', 'Physical Product'),
      category: confirmed('dietary_supplement', 'Dietary Supplement'),
      intendedOutcome: unsure("I'm still not sure yet")
    };
  } else if (name === 'many-open') {
    base.understanding = {
      targetAudience: unsure(), trafficSource: unsure(), funnelType: unsure(),
      pageExperience: unsure(), primaryCta: unsure(), conversionEvidence: unsure(),
      conversionFriction: unsure()
    };
  }
  base.unknowns = Object.entries(base.understanding)
    .filter(([, field]) => field.value === 'unsure')
    .map(([fieldKey]) => fieldKey);
  return base;
}

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
    const parameters = new URLSearchParams();
    Object.entries(body || {}).forEach(([key, value]) => {
      (Array.isArray(value) ? value : [value]).forEach(item => parameters.append(key, item));
    });
    const payload = parameters.toString();
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

function persistenceSideEffects(db, userId) {
  return {
    savedPlans: db.prepare('SELECT COUNT(*) AS count FROM saved_build_plan_states WHERE user_id = ?').get(userId).count,
    runs: db.prepare('SELECT COUNT(*) AS count FROM production_runs WHERE user_id = ?').get(userId).count,
    jobs: db.prepare(`SELECT COUNT(*) AS count FROM production_jobs
      WHERE production_run_id IN (SELECT id FROM production_runs WHERE user_id = ?)`).get(userId).count,
    generations: db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(userId).count,
    generationRequests: db.prepare('SELECT COUNT(*) AS count FROM generation_requests WHERE user_id = ?').get(userId).count,
    usagePeriods: db.prepare('SELECT COUNT(*) AS count FROM usage_periods WHERE user_id = ?').get(userId).count,
    usageEvents: db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count,
    memorySubjects: db.prepare('SELECT COUNT(*) AS count FROM business_memory_subjects WHERE user_id = ?').get(userId).count,
    memoryRows: db.prepare('SELECT COUNT(*) AS count FROM business_memory_records WHERE user_id = ?').get(userId).count,
    memoryRecords: activeMemory(db, { userId, includePending: true }).length,
    generationsUsed: db.prepare('SELECT generations_used FROM users WHERE id = ?').get(userId).generations_used
  };
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
  initDb();
  const routeDb = getDb();
  routeDb.prepare('INSERT OR IGNORE INTO users(id, email, name, monthly_limit) VALUES (?, ?, ?, ?)')
    .run(userId, 'polarity-route@example.com', 'Polarity Route', 5);
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
  app.get('/test/summary-fixture/:name', (req, res) => {
    req.session.discoverySession = summaryFixture(req.params.name);
    res.redirect('/discovery');
  });
  app.use(createCsrfProtection());
  app.get('/test/session', (req, res) => res.json(req.session.discoverySession || null));
  app.use(discoveryRoutes);
  app.use(builderRoutes);

  const server = await listen(app);
  const agent = { server, port: server.address().port, cookie: '' };
  const beforeRecords = activeMemory(db, { userId, includePending: true }).length;
  try {
    await request(agent, 'GET', '/test/authenticate');
    await request(agent, 'GET', '/test/summary-fixture/four-open');
    const fourOpen = await request(agent, 'GET', '/discovery');
    assert.strictEqual(fourOpen.res.statusCode, 200);
    const fourEstablished = fourOpen.body.match(/<ul class="discovery-understanding-list"[\s\S]*?<\/ul>/)?.[0] || '';
    const fourOpenSection = fourOpen.body.match(/<section class="discovery-open-inputs"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(fourEstablished, /Software \/ SaaS/);
    assert.doesNotMatch(fourEstablished, /I(?:&#39;|')m (?:still )?not sure yet/i);
    assert.match(fourOpenSection, /<h2[^>]*>Still open<\/h2>/);
    assert.match(fourOpenSection, /<details>/);
    assert.match(fourOpenSection, /<summary>4 planning inputs remain open<\/summary>/);
    assert.match(fourOpenSection, /<ul aria-label="Open planning inputs">/);
    for (const item of [
      'Traffic source — Not established',
      'Page experience — Not established',
      'Conversion evidence — Not established',
      'Customer friction — Not established'
    ]) {
      const renderedItem = `<li><span>${item.replace(' — ', '</span> — ')}</li>`;
      assert.strictEqual((fourOpenSection.match(new RegExp(renderedItem, 'g')) || []).length, 1, `${item} must appear once`);
    }
    for (const rejected of ['Traffic Source', 'Current Page Experience', 'Conversion Evidence', 'Friction &amp; Objections']) {
      assert.doesNotMatch(fourOpenSection, new RegExp(rejected), `${rejected} must not appear in the open-input presentation`);
    }
    assert.strictEqual((fourOpenSection.match(/<li>/g) || []).length, 4);
    assert.doesNotMatch(fourOpenSection, /I(?:&#39;|')m (?:still )?not sure yet/i);
    assert.doesNotMatch(fourOpenSection, /Scroll to review/);
    assert.doesNotMatch(fourOpen.body, /discovery-conservative-note/);
    const fourOpenState = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert.deepStrictEqual(
      ['trafficSource', 'pageExperience', 'conversionEvidence', 'conversionFriction'].map(function(key) {
        return [key, fourOpenState.understanding[key].value];
      }),
      [
        ['trafficSource', 'unsure'],
        ['pageExperience', 'unsure'],
        ['conversionEvidence', 'unsure'],
        ['conversionFriction', 'unsure']
      ]
    );
    assert.deepStrictEqual(
      Object.fromEntries(fourOpenState.planningReadiness.requirements
        .filter(function(requirement) { return ['traffic', 'page', 'evidence', 'friction'].includes(requirement.id); })
        .map(function(requirement) { return [requirement.id, { domain: requirement.domain, openInputLabel: requirement.openInputLabel }]; })),
      {
        traffic: { domain: 'Traffic Source', openInputLabel: 'Traffic source' },
        page: { domain: 'Current Page Experience', openInputLabel: 'Page experience' },
        evidence: { domain: 'Conversion Evidence', openInputLabel: 'Conversion evidence' },
        friction: { domain: 'Friction & Objections', openInputLabel: 'Customer friction' }
      }
    );

    await request(agent, 'GET', '/test/summary-fixture/many-open');
    const manyOpen = await request(agent, 'GET', '/discovery');
    const manyOpenSection = manyOpen.body.match(/<section class="discovery-open-inputs"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(manyOpenSection, /7 planning inputs remain open/);
    assert.match(manyOpenSection, /Scroll to review all 7 open inputs\./);
    assert.match(manyOpenSection, /<ul aria-label="Open planning inputs" aria-describedby="discovery-open-inputs-hint">/);
    assert.strictEqual((manyOpenSection.match(/<li>/g) || []).length, 7);

    await request(agent, 'GET', '/test/summary-fixture/facts-only');
    const factsOnly = await request(agent, 'GET', '/discovery');
    assert.match(factsOnly.body, /Established business details/);
    assert.doesNotMatch(factsOnly.body, /discovery-open-inputs|discovery-conservative-note/);

    await request(agent, 'GET', '/test/summary-fixture/open-only');
    const openOnly = await request(agent, 'GET', '/discovery');
    assert.doesNotMatch(openOnly.body, /discovery-understanding-list|discovery-conservative-note/);
    assert.match(openOnly.body, /1 planning input remains open/);
    assert.match(openOnly.body, /Traffic source/);

    await request(agent, 'GET', '/test/summary-fixture/empty');
    const empty = await request(agent, 'GET', '/discovery');
    assert.match(empty.body, /discovery-conservative-note/);
    assert.doesNotMatch(empty.body, /discovery-understanding-list|discovery-open-inputs/);

    await request(agent, 'GET', '/test/summary-fixture/fallback');
    const fallback = await request(agent, 'GET', '/discovery');
    assert.match(fallback.body, /Planning input 1/);
    assert.doesNotMatch(fallback.body, /legacyPrivateMetric/);

    await request(agent, 'GET', '/test/summary-fixture/open-aliases');
    const openAliases = await request(agent, 'GET', '/discovery');
    assert.match(openAliases.body, /1 planning input remains open/);
    assert.strictEqual((openAliases.body.match(/Traffic source/g) || []).length, 1);

    await request(agent, 'GET', '/test/summary-fixture/fact-aliases');
    const factAliases = await request(agent, 'GET', '/discovery');
    const aliasFacts = factAliases.body.match(/<ul class="discovery-understanding-list"[\s\S]*?<\/ul>/)?.[0] || '';
    assert.strictEqual((aliasFacts.match(/Referrals/g) || []).length, 1);

    await request(agent, 'GET', '/test/summary-fixture/multi-choice');
    const multiChoice = await request(agent, 'GET', '/discovery');
    assert.match(multiChoice.body, /Product Exploration/);
    assert.match(multiChoice.body, /1 planning input remains open/);

    await request(agent, 'GET', '/test/summary-fixture/supplement-variant');
    const supplementVariant = await request(agent, 'GET', '/discovery');
    const supplementOpen = supplementVariant.body.match(/<section class="discovery-open-inputs"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(supplementOpen, /Customer Need \/ Desired Outcome/);
    assert.doesNotMatch(supplementOpen, /I(?:&#39;|')m (?:still )?not sure yet/i);

    await request(agent, 'GET', '/test/reset-discovery');
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

    const unsureFreeTextQuestions = new Set([
      'conversion_page', 'conversion_evidence', 'conversion_friction'
    ]);
    let replayedPageUncertainty = false;
    for (let step = 0; step < 10; step += 1) {
      stored = JSON.parse((await request(agent, 'GET', '/test/session')).body);
      if (stored.discoveryCompleteForNow) break;
      const question = stored.nextQuestion;
      assert(question, 'Discovery should provide the next bounded question');
      const page = await request(agent, 'GET', '/discovery');
      const body = { _csrf: token(page.body), questionId: question.id };
      if (question.type === 'free_text') {
        if (unsureFreeTextQuestions.has(question.id)) body.unsure = 'unsure';
        else body.freeTextAnswer = 'No additional confirmed detail is available.';
      } else if (question.type === 'multi_choice') {
        body.choices = question.options.find(option => option.value === 'unsure')?.value || question.options[0].value;
      } else {
        body.choice = question.options.find(option => option.value === 'unsure')?.value || question.options[0].value;
      }
      const response = await request(agent, 'POST', '/discovery', body);
      assert.strictEqual(response.res.statusCode, 303);
      if (question.id === 'conversion_page' && !replayedPageUncertainty) {
        const afterPage = await request(agent, 'GET', '/discovery');
        assert.match(afterPage.body, /2 planning inputs remain open/);
        const back = await request(agent, 'POST', '/discovery/back', { _csrf: token(afterPage.body) });
        assert.strictEqual(back.res.statusCode, 303);
        const restoredPage = await request(agent, 'GET', '/discovery');
        assert.match(restoredPage.body, /1 planning input remains open/);
        const replay = await request(agent, 'POST', '/discovery', {
          _csrf: token(restoredPage.body), questionId: 'conversion_page', unsure: 'unsure'
        });
        assert.strictEqual(replay.res.statusCode, 303);
        const replayedPage = await request(agent, 'GET', '/discovery');
        assert.match(replayedPage.body, /2 planning inputs remain open/);
        const replayedOpen = replayedPage.body.match(/<section class="discovery-open-inputs"[\s\S]*?<\/section>/)?.[0] || '';
        assert.strictEqual((replayedOpen.match(/Page experience/g) || []).length, 1);
        replayedPageUncertainty = true;
      }
    }

    stored = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert.strictEqual(stored.discoveryCompleteForNow, true);
    assert.strictEqual(stored.planningReadiness.ready, true);
    for (const fieldKey of ['trafficSource', 'pageExperience', 'conversionEvidence', 'conversionFriction']) {
      assert.strictEqual(stored.understanding[fieldKey].value, 'unsure');
      assert(stored.planningReadiness.requirements.some(function(requirement) {
        return requirement.fields.includes(fieldKey) && requirement.state === 'unresolved_nonblocking';
      }));
    }
    assert.strictEqual(activeMemory(db, { userId, includePending: true }).length, beforeRecords, 'Discovery must not promote durable memory');

    const reflection = await request(agent, 'GET', '/discovery/reflection');
    assert.strictEqual(reflection.res.statusCode, 200);
    assert.match(reflection.body, /Project management software/);
    assert.match(reflection.body, /Small professional-services teams/);
    assert.match(reflection.body, /Start a trial or account/);
    for (const label of ['Primary Traffic Source', 'Current Page or Funnel', 'Builder-Provided Measurements', 'Observed Friction or Objections']) {
      assert.match(reflection.body, new RegExp(label));
    }
    assert.strictEqual((reflection.body.match(/<strong>Not established yet<\/strong>/g) || []).length, 4);
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

    const selectedIds = stored.buildPlanSelection.selectedDeliverableIds;
    const selectedItems = stored.buildPlan.phases.flatMap(phase => phase.deliverables)
      .filter(item => selectedIds.includes(item.id));
    assert.deepStrictEqual(selectedItems.map(item => item.title), [
      'Conversion Diagnostic Brief',
      'Trial-Signup Conversion Brief',
      'Conversion Measurement Plan'
    ]);
    assert.strictEqual(selectedItems.filter(isReadyToUseAsset).length, 0);
    assert.strictEqual(selectedItems.reduce((sum, item) => sum + productionBillingUnits(item), 0), 0);
    const effectsBeforeSave = persistenceSideEffects(db, userId);
    assert.strictEqual(effectsBeforeSave.savedPlans, 0);

    const buildPlanToken = token(buildPlan.body);
    const tamperedSave = await request(agent, 'POST', '/discovery/build-plan/selection', {
      _csrf: buildPlanToken,
      selectedDeliverableIds: selectedIds.concat('unknown_customer_deliverable')
    });
    assert.strictEqual(tamperedSave.res.statusCode, 409);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM saved_build_plan_states WHERE user_id = ?').get(userId).count, 0);

    const firstSave = await request(agent, 'POST', '/discovery/build-plan/selection', {
      _csrf: buildPlanToken,
      selectedDeliverableIds: selectedIds
    });
    assert.strictEqual(firstSave.res.statusCode, 303);
    assert.strictEqual(firstSave.res.headers.location, '/discovery/build-plan');
    const savedRows = db.prepare('SELECT * FROM saved_build_plan_states WHERE user_id = ?').all(userId);
    assert.strictEqual(savedRows.length, 1);
    assert.strictEqual(savedRows[0].objective, 'increase_conversion_rates');
    assert.strictEqual(savedRows[0].status, 'saved');
    assert.strictEqual(savedRows[0].state_version, 1);
    const savedWorkflow = JSON.parse(savedRows[0].workflow_state);
    assert.deepStrictEqual(savedWorkflow.buildPlanSelection.selectedDeliverableIds, selectedIds);
    for (const fieldKey of ['trafficSource', 'pageExperience', 'conversionEvidence', 'conversionFriction']) {
      assert.strictEqual(savedWorkflow.understanding[fieldKey].value, 'unsure');
    }

    const confirmation = await request(agent, 'GET', '/discovery/build-plan');
    assert.strictEqual(confirmation.res.statusCode, 200);
    assert.match(confirmation.body, /Plan saved\./);
    assert.match(confirmation.body, /No Production credits were used\./);
    assert.match(confirmation.body, /Start an Objective → Saved Plan/);
    const repeatedSave = await request(agent, 'POST', '/discovery/build-plan/selection', {
      _csrf: token(confirmation.body),
      selectedDeliverableIds: selectedIds
    });
    assert.strictEqual(repeatedSave.res.statusCode, 303);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM saved_build_plan_states WHERE user_id = ?').get(userId).count, 1);

    const effectsAfterSave = persistenceSideEffects(db, userId);
    assert.deepStrictEqual(effectsAfterSave, { ...effectsBeforeSave, savedPlans: 1 });

    await request(agent, 'GET', '/test/reset-discovery');
    const savedPlanEntry = await request(agent, 'GET', '/welcome?goal=increase_conversion_rates');
    assert.strictEqual(savedPlanEntry.res.statusCode, 200);
    assert.match(savedPlanEntry.body, /Saved Plan/);
    assert.match(savedPlanEntry.body, /Resume Saved Plan/);
    const resumed = await request(agent, 'POST', '/saved-plan/resume', {
      _csrf: token(savedPlanEntry.body),
      objective: 'increase_conversion_rates'
    });
    assert.strictEqual(resumed.res.statusCode, 303);
    assert.strictEqual(resumed.res.headers.location, '/discovery/build-plan');
    const resumedPlan = await request(agent, 'GET', '/discovery/build-plan');
    assert.strictEqual(resumedPlan.res.statusCode, 200);
    assert.match(resumedPlan.body, /Saved plan restored/);
    const resumedState = JSON.parse((await request(agent, 'GET', '/test/session')).body);
    assert.deepStrictEqual(resumedState.buildPlanSelection.selectedDeliverableIds, selectedIds);
    for (const fieldKey of ['trafficSource', 'pageExperience', 'conversionEvidence', 'conversionFriction']) {
      assert.strictEqual(resumedState.understanding[fieldKey].value, 'unsure');
    }
    assert.strictEqual(activeMemory(db, { userId, includePending: true }).length, beforeRecords, 'save and resume must not promote durable memory');

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
    routeDb.close();
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
