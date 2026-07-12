const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('../lib/passport');
const { getDb } = require('../db/database');

// Middleware to check if user is logged in
function requireAuth(req, res, next) {
  if (req.session && (req.session.userId || req.session.passport?.user)) {
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
    res.redirect('/welcome');
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
      const db2 = getDb();
      const hasGoal = db2.prepare('SELECT builder_goal FROM users WHERE id = ?').get(user.id);
      res.redirect(hasGoal?.builder_goal ? '/dashboard' : '/welcome');
    } else {
      res.render('login', { title: 'Login - CopyQuick', error: 'Invalid email or password.', currentPage: 'login' });
    }
  } catch (err) {
    console.error(err);
    res.render('login', { title: 'Login - CopyQuick', error: 'An error occurred. Please try again.', currentPage: 'login' });
  }
});

// Google OAuth
router.get('/auth/google', (req, res, next) => {
  if (!passport.isGoogleOAuthConfigured()) {
    return res.status(503).send('Google login is currently unavailable. Please log in with email and password.');
  }

  const configuredURL = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/auth/google/callback`;
  console.log(`🔀 Google OAuth initiating...`);
  console.log(`🔀 Configured callbackURL: "${process.env.GOOGLE_CALLBACK_URL}"`);
  console.log(`🔀 Request host:           "${req.get('host')}"`);
  console.log(`🔀 Request protocol:       "${req.protocol}"`);
  console.log(`🔀 Computed redirect:      "${req.protocol}://${req.get('host')}/auth/google/callback"`);
  console.log(`🔀 Env var callbackURL:    "${process.env.GOOGLE_CALLBACK_URL}"`);
  if (process.env.GOOGLE_CALLBACK_URL && !process.env.GOOGLE_CALLBACK_URL.startsWith('https://')) {
    console.error(`❌ GOOGLE_CALLBACK_URL does NOT start with https:// — Google will reject this!`);
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback',
  (req, res, next) => {
    if (!passport.isGoogleOAuthConfigured()) {
      return res.redirect('/login');
    }

    passport.authenticate('google', { failureRedirect: '/login', failureMessage: true }, (err, user, info) => {
      if (err) {
        console.error('❌ Google OAuth callback error:', err);
        console.error('❌ Stack:', err.stack);
        return res.status(500).send('Authentication error. Please try again.');
      }
      if (!user) {
        console.error('❌ Google OAuth callback: no user returned. Info:', JSON.stringify(info));
        return res.redirect('/login');
      }
      console.log('✅ Google OAuth success for user:', user.id, user.email);
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error('❌ Passport login error:', loginErr);
          console.error('❌ Stack:', loginErr.stack);
          return res.status(500).send('Session error. Please try again.');
        }
        req.session.userId = user.id;
        const dbCb = getDb();
        const hasGoal = dbCb.prepare('SELECT builder_goal FROM users WHERE id = ?').get(user.id);
        console.log('✅ Session set for user:', user.id, 'redirect:', hasGoal?.builder_goal ? '/dashboard' : '/welcome');
        return res.redirect(hasGoal?.builder_goal ? '/dashboard' : '/welcome');
      });
    })(req, res, next);
  }
);

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = { router, requireAuth };
