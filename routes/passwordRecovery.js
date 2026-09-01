const express = require('express');
const { getDb } = require('../db/database');
const { normalizeEmail } = require('../lib/authProtection');
const { createPasswordResetToken, resetPassword, validateNewPassword, validatePasswordResetToken } = require('../lib/passwordRecovery');
const { getPublicAppOrigin } = require('../lib/publicAppOrigin');
const { sendPasswordResetEmail } = require('../lib/email');
const { createExpiringBucketStore } = require('../lib/authProtection');
const { destroyAuthenticatedSession } = require('../lib/authSession');
const { getSessionCookieClearOptions } = require('../lib/sessionConfig');
const { defaultEmailDeliveryTracker } = require('../lib/emailDeliveryTracker');
const { writeOperationalEvent } = require('../lib/operationalLogger');

const GENERIC_REQUEST_MESSAGE = 'If an account exists for that email, a password reset link has been sent.';
const DEFAULT_REQUEST_RESPONSE_DELAY_MS = 750;

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function createPasswordRecoveryRouter(options = {}) {
  const router = express.Router();
  const database = options.getDb || getDb;
  const sendResetEmail = options.sendPasswordResetEmail || sendPasswordResetEmail;
  const emailDeliveryTracker = options.emailDeliveryTracker || defaultEmailDeliveryTracker;
  const operationalLogger = options.operationalLogger || writeOperationalEvent;
  const responseDelayMs = Number.isFinite(options.responseDelayMs)
    ? Math.max(0, options.responseDelayMs)
    : DEFAULT_REQUEST_RESPONSE_DELAY_MS;
  const wait = options.sleep || sleep;
  const requestBuckets = createExpiringBucketStore({
    windowMs: options.windowMs || 60 * 60 * 1000,
    maxKeys: options.maxKeys,
    now: options.now
  });
  const maxRequests = options.maxRequests || 5;
  const maxEmailRequests = options.maxEmailRequests || maxRequests;

  function logDeliveryFailure(req) {
    operationalLogger({
      event: 'password_reset_delivery_failed',
      requestId: req.requestId,
      method: req.method,
      route: req.route?.path || 'unmatched',
      statusCode: 500,
      code: 'PASSWORD_RESET_DELIVERY_FAILED'
    });
  }

  router.get('/forgot-password', (req, res) => res.render('forgot-password', {
    title: 'Reset Password - CopyQuick', currentPage: 'login', message: null
  }));

  router.post('/forgot-password', async (req, res) => {
    const ipKey = `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const email = normalizeEmail(req.body.email);
    const emailKey = `email:${email || 'invalid'}`;
    if (requestBuckets.isLimited(ipKey, maxRequests) || requestBuckets.isLimited(emailKey, maxEmailRequests)) {
      return res.status(429).render('forgot-password', {
        title: 'Reset Password - CopyQuick', currentPage: 'login', message: GENERIC_REQUEST_MESSAGE
      });
    }
    requestBuckets.increment(ipKey);
    requestBuckets.increment(emailKey);
    try {
      const db = database();
      const user = email.length <= 254
        ? db.prepare('SELECT id, email, password_hash, google_id FROM users WHERE email = ?').get(email)
        : null;
      if (user) {
        const token = createPasswordResetToken(user, { env: options.env || process.env });
        const origin = options.publicOrigin || getPublicAppOrigin({ env: options.env || process.env, req });
        const delivery = Promise.resolve().then(() => sendResetEmail({
          email: user.email,
          resetUrl: `${origin}/reset-password?token=${encodeURIComponent(token)}`
        }, options.emailOptions));
        void emailDeliveryTracker.track('password_reset', delivery).catch(() => {
          logDeliveryFailure(req);
        });
      }
    } catch (err) {
      logDeliveryFailure(req);
    }
    await wait(responseDelayMs);
    res.render('forgot-password', {
      title: 'Reset Password - CopyQuick', currentPage: 'login', message: GENERIC_REQUEST_MESSAGE
    });
  });

  router.get('/reset-password', (req, res) => {
    const token = String(req.query.token || '');
    const valid = Boolean(validatePasswordResetToken(database(), token, { env: options.env || process.env }));
    res.status(valid ? 200 : 400).render('reset-password', {
      title: 'Choose New Password - CopyQuick', currentPage: 'login', token: valid ? token : '',
      error: valid ? null : 'This password reset link is invalid or has expired.', success: false
    });
  });

  router.post('/reset-password', async (req, res) => {
    const token = String(req.body.token || '');
    const password = req.body.password;
    if (!validateNewPassword(password)) {
      return res.status(400).render('reset-password', {
        title: 'Choose New Password - CopyQuick', currentPage: 'login', token,
        error: 'Use at least 8 characters for your new password.', success: false
      });
    }
    try {
      const result = await resetPassword(database(), token, password, {
        env: options.env || process.env, bcrypt: options.bcrypt
      });
      if (!result.ok) throw new Error(result.code);
      await destroyAuthenticatedSession(req, res, {
        cookieOptions: getSessionCookieClearOptions(options.env || process.env)
      });
      return res.render('reset-password', {
        title: 'Password Updated - CopyQuick', currentPage: 'login', token: '', error: null, success: true
      });
    } catch (err) {
      return res.status(400).render('reset-password', {
        title: 'Choose New Password - CopyQuick', currentPage: 'login', token: '',
        error: 'This password reset link is invalid or has expired.', success: false
      });
    }
  });

  return router;
}

module.exports = {
  DEFAULT_REQUEST_RESPONSE_DELAY_MS,
  GENERIC_REQUEST_MESSAGE,
  createPasswordRecoveryRouter
};
