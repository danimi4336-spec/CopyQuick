const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');
const { generateCopy, getContentTypes, getTones } = require('../lib/generator');

router.get('/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const user = res.locals.user;
  
  const history = db.prepare(`
    SELECT * FROM generations 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT 20
  `).all(user.id);

  res.render('dashboard', { 
    title: 'Dashboard - CopyQuick',
    contentTypes: getContentTypes(),
    tones: getTones(),
    history: history,
    results: null,
    currentPage: 'dashboard'
  });
});

router.post('/dashboard/generate', requireAuth, (req, res) => {
  const { productDescription, targetAudience, contentType, tone } = req.body;
  const db = getDb();
  const user = res.locals.user;

  // Check usage limit
  if (user.generations_used >= user.monthly_limit) {
    return res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(),
      tones: getTones(),
      history: db.prepare('SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id),
      results: null,
      error: 'Monthly generation limit reached. <a href="/pricing">Upgrade your plan</a> to continue.'
    });
  }

  try {
    const results = generateCopy({ productDescription, targetAudience, contentType, tone });
    const resultsJson = JSON.stringify(results);

    // Save to DB
    db.prepare(`
      INSERT INTO generations (user_id, input_text, content_type, tone, results)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, productDescription, contentType, tone, resultsJson);

    // Update user usage
    db.prepare('UPDATE users SET generations_used = generations_used + 1 WHERE id = ?').run(user.id);

    const history = db.prepare(`
      SELECT * FROM generations 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 20
    `).all(user.id);

    // Re-fetch user for updated usage
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.locals.user = updatedUser;

    res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(),
      tones: getTones(),
      history: history,
      results: results,
      input: { productDescription, targetAudience, contentType, tone }
    });
  } catch (err) {
    console.error(err);
    res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(),
      tones: getTones(),
      history: db.prepare('SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id),
      results: null,
      error: 'An error occurred during generation. Please try again.'
    });
  }
});

router.get('/profile', requireAuth, (req, res) => {
  res.render('profile', { title: 'My Profile - CopyQuick', currentPage: 'profile' });
});

module.exports = router;
