const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');

// Middleware to check if user is logged in
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect('/login');
}

// Signup
router.get('/signup', (req, res) => {
  res.render('signup', { title: 'Sign Up - CopyQuick', error: null, currentPage: 'signup' });
});

router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  const db = getDb();

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(email, passwordHash, name);
    
    req.session.userId = result.lastInsertRowid;
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.render('signup', { title: 'Sign Up - CopyQuick', error: 'Email already exists or invalid data.', currentPage: 'signup' });
  }
});

// Login
router.get('/login', (req, res) => {
  res.render('login', { title: 'Login - CopyQuick', error: null, currentPage: 'login' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const db = getDb();

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user && await bcrypt.compare(password, user.password_hash)) {
      req.session.userId = user.id;
      res.redirect('/dashboard');
    } else {
      res.render('login', { title: 'Login - CopyQuick', error: 'Invalid email or password.', currentPage: 'login' });
    }
  } catch (err) {
    console.error(err);
    res.render('login', { title: 'Login - CopyQuick', error: 'An error occurred. Please try again.', currentPage: 'login' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = { router, requireAuth };
