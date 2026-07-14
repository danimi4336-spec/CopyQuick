const express = require('express');
const bcrypt = require('bcrypt');
const passport = require('../lib/passport');
const { getDb } = require('../db/database');
const {
  LOGIN_FAILURE_ERROR,
  SIGNUP_FAILURE_ERROR,
  createLoginRateLimiter,
  createSignupRateLimiter
} = require('../lib/authProtection');

const DUMMY_PASSWORD_HASH = '$2b$10$oQsiX8feR0MdWIyOqAVa5.Uz3SQ1BetDaVSKI1Q4Y6.qavibTRRNq';

// Middleware to check if user is logged in
function requireAuth(req, res, next) {
  if (req.session && (req.session.userId || req.session.passport?.user)) {
    return next();
  }
  res.redirect('/login');
}

function createAuthRouter(options = {}) {
  const authRouter = express.Router();
  const loginLimiter = options.loginLimiter || createLoginRateLimiter(options.loginLimiterOptions);
  const signupLimiter = options.signupLimiter || createSignupRateLimiter(options.signupLimiterOptions);
  const bcryptApi = options.bcrypt || bcrypt;
  const getDatabase = options.getDb || getDb;

  // Signup
  authRouter.get('/signup', (req, res) => {
    res.render('signup', { title: 'Sign Up - CopyQuick', error: null, currentPage: 'signup' });
  });

  authRouter.post('/signup', signupLimiter, async (req, res) => {
    const { email, password, name } = req.authSignup;
    const db = getDatabase();

    try {
      const passwordHash = await bcryptApi.hash(password, 10);
      const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
        .run(email, passwordHash, name);

      req.session.userId = result.lastInsertRowid;
      res.redirect('/welcome');
    } catch (err) {
      console.error(err);
      res.render('signup', { title: 'Sign Up - CopyQuick', error: SIGNUP_FAILURE_ERROR, currentPage: 'signup' });
    }
  });

  // Login
  authRouter.get('/login', (req, res) => {
    res.render('login', { title: 'Login - CopyQuick', error: null, currentPage: 'login' });
  });

  authRouter.post('/login', loginLimiter.middleware, async (req, res) => {
    const { email, password } = req.authLogin;
    const db = getDatabase();

    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const passwordHash = user?.password_hash || DUMMY_PASSWORD_HASH;
      const passwordMatches = await bcryptApi.compare(password, passwordHash);

      if (user && passwordMatches) {
        loginLimiter.recordSuccess(req);
        req.session.userId = user.id;
        const db2 = getDatabase();
        const hasGoal = db2.prepare('SELECT builder_goal FROM users WHERE id = ?').get(user.id);
        res.redirect(hasGoal?.builder_goal ? '/dashboard' : '/welcome');
      } else {
        loginLimiter.recordFailure(req);
        res.render('login', { title: 'Login - CopyQuick', error: LOGIN_FAILURE_ERROR, currentPage: 'login' });
      }
    } catch (err) {
      console.error(err);
      res.render('login', { title: 'Login - CopyQuick', error: 'An error occurred. Please try again.', currentPage: 'login' });
    }
  });

  return authRouter;
}

const router = createAuthRouter();

// Google OAuth
router.get('/auth/google', (req, res, next) => {
  if (!passport.isGoogleOAuthConfigured()) {
    return res.status(503).send('Google login is currently unavailable. Please log in with email and password.');
  }

  const hasGoogleCallbackUrl = Boolean(String(process.env.GOOGLE_CALLBACK_URL || '').trim());
  console.log(`🔀 Google OAuth initiating...`);
  console.log(`🔀 GOOGLE_CALLBACK_URL: ${hasGoogleCallbackUrl ? 'present' : 'missing'}`);
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

module.exports = { createAuthRouter, router, requireAuth };
