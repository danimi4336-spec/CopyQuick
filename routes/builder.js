const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');
const { objectiveUniverse, getObjective } = require('../lib/businessJourneys');
const { normalizeStoredBrandBrain, validateBrandBrain } = require('../lib/brandBrainValidation');

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
  const requestedGoal = typeof req.query.goal === 'string' ? req.query.goal.trim() : '';
  res.render('welcome', {
    title: 'Choose Your Business Objective - CopyQuick',
    currentPage: 'welcome',
    objectives: objectiveUniverse,
    selectedGoal: getObjective(requestedGoal) ? requestedGoal : '',
    error: null
  });
});

router.post('/welcome', requireAuth, (req, res) => {
  const db = getDb();
  const goal = typeof req.body.goal === 'string' ? req.body.goal.trim() : '';
  if (!getObjective(goal)) {
    return res.status(400).render('welcome', {
      title: 'Choose Your Business Objective - CopyQuick',
      currentPage: 'welcome',
      objectives: objectiveUniverse,
      selectedGoal: '',
      error: 'Choose a valid business objective to continue.'
    });
  }
  db.prepare('UPDATE users SET builder_goal = ? WHERE id = ?').run(goal, req.session.userId);
  // Ensure brand_brain row exists
  const existing = db.prepare('SELECT id FROM brand_brain WHERE user_id = ?').get(req.session.userId);
  if (!existing) {
    db.prepare('INSERT INTO brand_brain (user_id) VALUES (?)').run(req.session.userId);
  }
  if (goal === 'launch_product') {
    delete req.session.discoverySession;
    return res.redirect('/discovery');
  }
  return res.redirect('/dashboard');
});

// ====== Brand Brain ======
router.get('/brand-brain', requireAuth, (req, res) => {
  const db = getDb();
  const brain = normalizeStoredBrandBrain(
    db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(req.session.userId) || emptyBrandBrain(req.session.userId)
  );
  const fields = ['business_name', 'industry', 'target_audience', 'brand_voice', 'unique_value', 'competitors', 'goals', 'key_messages'];
  const filled = fields.filter(f => brain[f] && brain[f].trim()).length;
  const pct = Math.round((filled / fields.length) * 100);
  res.render('brand-brain', { title: 'Brand Brain - CopyQuick', brain, pct, currentPage: 'brand-brain' });
});

router.post('/brand-brain', requireAuth, (req, res) => {
  const db = getDb();
  const validation = validateBrandBrain(req.body);
  if (!validation.valid) {
    return res.status(400).render('brand-brain', {
      title: 'Brand Brain - CopyQuick',
      brain: { ...emptyBrandBrain(req.session.userId), ...validation.values },
      pct: 0,
      error: 'Please shorten or correct the highlighted business details and try again.',
      currentPage: 'brand-brain'
    });
  }
  const { business_name, industry, target_audience, brand_voice, brand_voice_custom, unique_value, competitors, goals, key_messages } = validation.values;
  const existing = db.prepare('SELECT id FROM brand_brain WHERE user_id = ?').get(req.session.userId);
  if (existing) {
    db.prepare(`UPDATE brand_brain SET business_name=?, industry=?, target_audience=?, brand_voice=?, unique_value=?, competitors=?, goals=?, key_messages=?, brand_voice_custom=?, updated_at=datetime('now') WHERE user_id=?`)
      .run(business_name || '', industry || '', target_audience || '', brand_voice, unique_value || '', competitors || '', goals || '', key_messages || '', brand_voice_custom || '', req.session.userId);
  } else {
    db.prepare(`
      INSERT INTO brand_brain (
        user_id, business_name, industry, target_audience, brand_voice,
        unique_value, competitors, goals, key_messages, brand_voice_custom
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.session.userId,
      business_name || '',
      industry || '',
      target_audience || '',
      brand_voice,
      unique_value || '',
      competitors || '',
      goals || '',
      key_messages || '',
      brand_voice_custom || ''
    );
  }
  res.redirect('/brand-brain');
});

// ====== Campaign Studio ======
router.get('/campaign-studio', requireAuth, (_req, res) => {
  // Preserve old bookmarks while sending builders into the supported guided
  // objective flow instead of the retired, disabled campaign placeholder.
  res.redirect('/welcome?goal=launch_product');
});

module.exports = router;
