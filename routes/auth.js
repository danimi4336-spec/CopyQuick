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
const {
  destroyAuthenticatedSession,
  establishAuthenticatedSession
} = require('../lib/authSession');
const { getSessionCookieClearOptions } = require('../lib/sessionConfig');
const { authSuccessPath, normalizeAuthReturnPath } = require('../lib/authReturnPath');
const { writeOperationalEvent } = require('../lib/operationalLogger');

const DUMMY_PASSWORD_HASH = '$2b$10$oQsiX8feR0MdWIyOqAVa5.Uz3SQ1BetDaVSKI1Q4Y6.qavibTRRNq';
const SIGNUP_INTERNAL_ERROR = 'Unable to create your account. Please try again.';

function isDuplicateSignupError(error) {
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

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
    res.render('signup', { title: 'Sign Up - CopyQuick', error: null, currentPage: 'signup', returnTo: normalizeAuthReturnPath(req.query.next) });
  });

  authRouter.post('/signup', signupLimiter, async (req, res) => {
    const { email, password, name } = req.authSignup;
    const returnTo = normalizeAuthReturnPath(req.body.next);
    const db = getDatabase();

    try {
      const passwordHash = await bcryptApi.hash(password, 10);
      const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
        .run(email, passwordHash, name);

      await establishAuthenticatedSession(req, result.lastInsertRowid);
      res.redirect(authSuccessPath(null, returnTo));
    } catch (err) {
      const duplicate = isDuplicateSignupError(err);
      if (!duplicate) {
        writeOperationalEvent({
          event: 'auth_signup_failed',
          requestId: req.requestId,
          method: req.method,
          route: '/signup',
          statusCode: 500,
          code: 'AUTH_SIGNUP_FAILED'
        });
      }
      res.status(duplicate ? 409 : 500).render('signup', {
        title: 'Sign Up - CopyQuick',
        error: duplicate ? SIGNUP_FAILURE_ERROR : SIGNUP_INTERNAL_ERROR,
        currentPage: 'signup',
        returnTo
      });
    }
  });

  // Login
  authRouter.get('/login', (req, res) => {
    res.render('login', { title: 'Login - CopyQuick', error: null, currentPage: 'login', returnTo: normalizeAuthReturnPath(req.query.next) });
  });

  authRouter.post('/login', loginLimiter.middleware, async (req, res) => {
    const { email, password } = req.authLogin;
    const returnTo = normalizeAuthReturnPath(req.body.next);
    const db = getDatabase();

    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const passwordHash = user?.password_hash || DUMMY_PASSWORD_HASH;
      const passwordMatches = await bcryptApi.compare(password, passwordHash);

      if (user && passwordMatches) {
        loginLimiter.recordSuccess(req);
        await establishAuthenticatedSession(req, user.id);
        const db2 = getDatabase();
        const hasGoal = db2.prepare('SELECT builder_goal FROM users WHERE id = ?').get(user.id);
        res.redirect(authSuccessPath(hasGoal, returnTo));
      } else {
        loginLimiter.recordFailure(req);
        res.status(401).render('login', { title: 'Login - CopyQuick', error: LOGIN_FAILURE_ERROR, currentPage: 'login', returnTo });
      }
    } catch (err) {
      writeOperationalEvent({
        event: 'auth_login_failed',
        requestId: req.requestId,
        method: req.method,
        route: '/login',
        statusCode: 500,
        code: 'AUTH_LOGIN_FAILED'
      });
      res.status(500).render('login', { title: 'Login - CopyQuick', error: 'An error occurred. Please try again.', currentPage: 'login', returnTo });
    }
  });

  authRouter.post('/logout', async (req, res) => {
    try {
      await destroyAuthenticatedSession(req, res, {
        cookieOptions: getSessionCookieClearOptions(process.env)
      });
      res.redirect('/');
    } catch (err) {
      writeOperationalEvent({
        event: 'auth_logout_failed',
        requestId: req.requestId,
        method: req.method,
        route: '/logout',
        statusCode: 500,
        code: 'AUTH_LOGOUT_FAILED'
      });
      res.status(500).send('Unable to log out safely. Please try again.');
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

  if (process.env.GOOGLE_CALLBACK_URL && !process.env.GOOGLE_CALLBACK_URL.startsWith('https://')) {
    writeOperationalEvent({
      event: 'auth_google_configuration_failed',
      requestId: req.requestId,
      method: req.method,
      route: '/auth/google',
      statusCode: 500,
      code: 'GOOGLE_CALLBACK_URL_INSECURE'
    });
  }
  const returnTo = normalizeAuthReturnPath(req.query.next);
  if (returnTo) req.session.authReturnTo = returnTo;
  else delete req.session.authReturnTo;
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback',
  (req, res, next) => {
    if (!passport.isGoogleOAuthConfigured()) {
      if (req.session) delete req.session.authReturnTo;
      return res.redirect('/login');
    }

    passport.authenticate('google', { failureRedirect: '/login', failureMessage: true }, (err, user, info) => {
      if (err) {
        if (req.session) delete req.session.authReturnTo;
        writeOperationalEvent({
          event: 'auth_google_callback_failed', requestId: req.requestId, method: req.method,
          route: '/auth/google/callback', statusCode: 500, code: 'GOOGLE_AUTHENTICATION_FAILED'
        });
        return res.status(500).send('Authentication error. Please try again.');
      }
      if (!user) {
        if (req.session) delete req.session.authReturnTo;
        writeOperationalEvent({
          event: 'auth_google_callback_rejected', requestId: req.requestId, method: req.method,
          route: '/auth/google/callback', statusCode: 401, code: 'GOOGLE_USER_UNAVAILABLE'
        });
        return res.redirect('/login');
      }
      const returnTo = normalizeAuthReturnPath(req.session?.authReturnTo);
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          writeOperationalEvent({
            event: 'auth_google_session_failed', requestId: req.requestId, method: req.method,
            route: '/auth/google/callback', statusCode: 500, code: 'GOOGLE_SESSION_FAILED'
          });
          return res.status(500).send('Session error. Please try again.');
        }
        req.session.userId = user.id;
        delete req.session.authReturnTo;
        const dbCb = getDb();
        const hasGoal = dbCb.prepare('SELECT builder_goal FROM users WHERE id = ?').get(user.id);
        return res.redirect(authSuccessPath(hasGoal, returnTo));
      });
    })(req, res, next);
  }
);

module.exports = { createAuthRouter, isDuplicateSignupError, router, requireAuth };
