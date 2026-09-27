const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');
const { objectiveUniverse, getAvailableObjective } = require('../lib/businessJourneys');
const { normalizeStoredBrandBrain, validateBrandBrain } = require('../lib/brandBrainValidation');
const { applyApprovedBrandBrainProposal, loadBrandObjectiveProposal } = require('../lib/brandObjectiveIntegration');
const { getSavedPlan, resumeSavedPlan, syncSavedPlanLifecycle } = require('../lib/savedBuildPlans');
const { brandBrainProjection, reconcileMemory, resetMemory, syncBrandBrainMemory } = require('../lib/businessMemory');

function emptyBrandBrain(userId) {
  return {
    id: null,
    user_id: userId,
    business_name: '',
    industry: '',
    target_audience: '',
    brand_voice: 'professional',
    brand_voice_custom: '',
    unique_value: '',
    competitors: '',
    goals: '',
    tone: 'professional',
    key_messages: ''
  };
}

// ====== Welcome / Builder Journey ======
router.get('/welcome', requireAuth, (req, res) => {
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const requestedGoal = typeof req.query.goal === 'string' ? req.query.goal.trim() : '';
  const storedGoal = db.prepare('SELECT builder_goal FROM users WHERE id = ?').get(userId)?.builder_goal;
  const savedObjective = getAvailableObjective(requestedGoal)?.id || getAvailableObjective(storedGoal)?.id || 'launch_product';
  const existing = getSavedPlan(db, { userId, objective: savedObjective });
  const lifecycle = existing
    ? syncSavedPlanLifecycle(db, { userId, planFingerprint: existing.planFingerprint })
    : null;
  const savedPlan = lifecycle?.status === 'completed' ? null : getSavedPlan(db, { userId, objective: savedObjective });
  res.render('welcome', {
    title: 'Choose Your Business Objective - CopyQuick',
    currentPage: 'welcome',
    objectives: objectiveUniverse,
    selectedGoal: getAvailableObjective(requestedGoal) ? requestedGoal : '',
    savedPlan,
    error: null
  });
});

router.post('/saved-plan/resume', requireAuth, (req, res) => {
  const db = req.app.locals.copyquickDb || getDb();
  const userId = req.session.userId || req.session.passport?.user;
  const objective = getAvailableObjective(req.body.objective)?.id || 'launch_product';
  const result = resumeSavedPlan(db, { userId, objective });
  if (!result.valid) {
    const requestedGoal = typeof req.query.goal === 'string' ? req.query.goal.trim() : '';
    return res.status(409).render('welcome', {
      title: 'Choose Your Business Objective - CopyQuick', currentPage: 'welcome',
      objectives: objectiveUniverse,
      selectedGoal: getAvailableObjective(requestedGoal) ? requestedGoal : '',
      savedPlan: null,
      error: result.reason
    });
  }
  req.session.discoverySession = result.discoverySession;
  req.session.discoverySession.buildPlanNotice = 'Saved plan restored. Your selections and completed work are preserved.';
  return res.redirect(303, '/discovery/build-plan');
});

router.post('/welcome', requireAuth, (req, res) => {
  const db = req.app.locals.copyquickDb || getDb();
  const goal = typeof req.body.goal === 'string' ? req.body.goal.trim() : '';
  if (!getAvailableObjective(goal)) {
    return res.status(400).render('welcome', {
      title: 'Choose Your Business Objective - CopyQuick',
      currentPage: 'welcome',
      objectives: objectiveUniverse,
      selectedGoal: '',
      savedPlan: getSavedPlan(db, { userId: req.session.userId || req.session.passport?.user }),
      error: 'Choose an available business objective to continue.'
    });
  }
  db.prepare('UPDATE users SET builder_goal = ? WHERE id = ?').run(goal, req.session.userId);
  delete req.session.discoverySession;
  return res.redirect('/discovery');
});

// ====== Brand Brain ======
router.get('/brand-brain', requireAuth, (req, res) => {
  const db = req.app.locals.copyquickDb || getDb();
  const brain = normalizeStoredBrandBrain(
    db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(req.session.userId) || emptyBrandBrain(req.session.userId)
  );
  const enrichment = req.query.fromRun
    ? loadBrandObjectiveProposal(db, { userId: req.session.userId, productionRunId: req.query.fromRun, existing: brain })
    : null;
  const memory = brandBrainProjection(db, { userId: req.session.userId });
  const pct = memory.confirmedCoverage;
  res.render('brand-brain', { title: 'Brand Brain - CopyQuick', brain, pct, memory, enrichment, saved: req.query.saved === '1', currentPage: 'brand-brain' });
});

function saveBrandBrain(db, userId, values) {
  const { business_name, industry, target_audience, brand_voice, brand_voice_custom, unique_value, competitors, goals, key_messages } = values;
  const existing = db.prepare('SELECT id FROM brand_brain WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(`UPDATE brand_brain SET business_name=?, industry=?, target_audience=?, brand_voice=?, unique_value=?, competitors=?, goals=?, key_messages=?, brand_voice_custom=?, updated_at=datetime('now') WHERE user_id=?`)
      .run(business_name || '', industry || '', target_audience || '', brand_voice, unique_value || '', competitors || '', goals || '', key_messages || '', brand_voice_custom || '', userId);
  } else {
    db.prepare(`INSERT INTO brand_brain (user_id, business_name, industry, target_audience, brand_voice, unique_value, competitors, goals, key_messages, brand_voice_custom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, business_name || '', industry || '', target_audience || '', brand_voice, unique_value || '', competitors || '', goals || '', key_messages || '', brand_voice_custom || '');
  }
}

router.post('/brand-brain/enrich/:productionRunId', requireAuth, (req, res) => {
  const db = req.app.locals.copyquickDb || getDb();
  const brain = normalizeStoredBrandBrain(db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(req.session.userId) || emptyBrandBrain(req.session.userId));
  const enrichment = loadBrandObjectiveProposal(db, { userId: req.session.userId, productionRunId: req.params.productionRunId, existing: brain });
  if (!enrichment) return res.status(404).send('Not found');
  const approvedFields = Array.isArray(req.body.approvedFields) ? req.body.approvedFields : req.body.approvedFields ? [req.body.approvedFields] : [];
  const values = applyApprovedBrandBrainProposal({ existing: brain, proposal: enrichment.proposal, approvedFields });
  saveBrandBrain(db, req.session.userId, values);
  syncBrandBrainMemory(db, { userId: req.session.userId, values });
  return res.redirect(303, '/brand-brain?saved=1');
});

router.post('/brand-brain', requireAuth, (req, res) => {
  const db = req.app.locals.copyquickDb || getDb();
  const validation = validateBrandBrain(req.body);
  if (!validation.valid) {
    return res.status(400).render('brand-brain', {
      title: 'Brand Brain - CopyQuick',
      brain: { ...emptyBrandBrain(req.session.userId), ...validation.values },
      pct: 0,
      memory: brandBrainProjection(db, { userId: req.session.userId }),
      error: 'Please shorten or correct the highlighted business details and try again.',
      currentPage: 'brand-brain'
    });
  }
  saveBrandBrain(db, req.session.userId, validation.values);
  syncBrandBrainMemory(db, { userId: req.session.userId, values: validation.values });
  res.redirect('/brand-brain');
});

router.post('/brand-brain/memory/:recordId/remove', requireAuth, (req, res) => {
  const db = req.app.locals.copyquickDb || getDb();
  const result = reconcileMemory(db, { userId: req.session.userId, recordId: req.params.recordId, action: 'remove' });
  if (!result.valid) return res.status(404).send('Not found');
  return res.redirect(303, '/brand-brain');
});

router.post('/brand-brain/memory/reset', requireAuth, (req, res) => {
  const db = req.app.locals.copyquickDb || getDb();
  resetMemory(db, { userId: req.session.userId });
  return res.redirect(303, '/brand-brain');
});

// ====== Campaign Studio ======
router.get('/campaign-studio', requireAuth, (_req, res) => {
  // Preserve old bookmarks while sending builders into the supported guided
  // objective flow instead of the retired, disabled campaign placeholder.
  res.redirect('/welcome?goal=launch_product');
});

module.exports = router;
