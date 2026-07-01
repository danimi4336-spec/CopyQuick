const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');

// ====== Welcome / Builder Journey ======
router.get('/welcome', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.builder_goal) return res.redirect('/dashboard');
  res.render('welcome', { title: 'Welcome to CopyQuick', currentPage: 'welcome' });
});

router.post('/welcome', requireAuth, (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.redirect('/welcome');
  const db = getDb();
  db.prepare('UPDATE users SET builder_goal = ? WHERE id = ?').run(goal, req.session.userId);
  // Ensure brand_brain row exists
  const existing = db.prepare('SELECT id FROM brand_brain WHERE user_id = ?').get(req.session.userId);
  if (!existing) {
    db.prepare('INSERT INTO brand_brain (user_id) VALUES (?)').run(req.session.userId);
  }
  res.redirect('/dashboard');
});

// ====== Brand Brain ======
router.get('/brand-brain', requireAuth, (req, res) => {
  const db = getDb();
  let brain = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(req.session.userId);
  if (!brain) {
    db.prepare('INSERT INTO brand_brain (user_id) VALUES (?)').run(req.session.userId);
    brain = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(req.session.userId);
  }
  const fields = ['business_name', 'industry', 'target_audience', 'brand_voice', 'unique_value', 'competitors', 'goals', 'key_messages'];
  const filled = fields.filter(f => brain[f] && brain[f].trim()).length;
  const pct = Math.round((filled / fields.length) * 100);
  res.render('brand-brain', { title: 'Brand Brain - CopyQuick', brain, pct, currentPage: 'brand-brain' });
});

router.post('/brand-brain', requireAuth, (req, res) => {
  const db = getDb();
  const { business_name, industry, target_audience, brand_voice, brand_voice_custom, unique_value, competitors, goals, key_messages } = req.body;
  // Handle custom: if custom selected, store both flag and custom text; if not, store preset value as voice
  const finalVoice = brand_voice === 'custom' ? brand_voice_custom || 'custom' : brand_voice;
  db.prepare(`UPDATE brand_brain SET business_name=?, industry=?, target_audience=?, brand_voice=?, unique_value=?, competitors=?, goals=?, key_messages=?, brand_voice_custom=COALESCE(?, brand_voice_custom), updated_at=datetime('now') WHERE user_id=?`)
    .run(business_name || '', industry || '', target_audience || '', finalVoice, unique_value || '', competitors || '', goals || '', key_messages || '', brand_voice === 'custom' ? brand_voice_custom || '' : null, req.session.userId);
  res.redirect('/brand-brain');
});

// ====== Campaign Studio ======
router.get('/campaign-studio', requireAuth, (req, res) => {
  const db = getDb();
  const brain = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(req.session.userId);
  res.render('campaign-studio', { title: 'Campaign Studio - CopyQuick', brain, currentPage: 'campaign-studio' });
});

module.exports = router;