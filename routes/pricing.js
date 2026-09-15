const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const {
  isBillingEnabled,
  createCheckoutSession,
  createCustomerPortalSession,
  retrieveCheckoutSession
} = require('../lib/stripe');
const { getPublicAppOrigin } = require('../lib/publicAppOrigin');
const { issueCheckoutKeys, validateCheckoutKey } = require('../lib/checkoutIdempotency');
const { resolveSubscriptionCheckoutPolicy } = require('../lib/subscriptionCheckoutPolicy');
const { getTrustedStripeRedirect } = require('../lib/stripeRedirect');
const { writeOperationalEvent } = require('../lib/operationalLogger');
const { getDb } = require('../db/database');
const {
  acquireSubscriptionCheckoutIntent,
  canReplaceCompletedCheckoutIntent,
  clearSubscriptionCheckoutIntentIfMatches,
  getConflictingSubscriptionCheckoutIntent,
  recordSubscriptionCheckoutSession
} = require('../lib/subscriptionCheckoutIntent');
const {
  createBillingReturnNotice,
  inspectBillingCheckoutReturn
} = require('../lib/billingCheckoutReturn');
const { resolveOwnedPortalCustomerId } = require('../lib/billingPortalAccess');
const { billingActionRateLimit } = require('../lib/billingRateLimit');
const { pricingReturn } = require('../lib/pricingReturn');

function logBillingFailure(req, event, code, statusCode) {
  writeOperationalEvent({
    event,
    requestId: req.requestId,
    method: req.method,
    route: req.route?.path || 'unmatched',
    statusCode,
    code
  });
}

function rejectWhenBillingDisabled(res) {
  if (isBillingEnabled !== false) return false;
  res.status(503).send('Billing is unavailable in local development until STRIPE_KEY is configured.');
  return true;
}

router.get('/pricing', (req, res) => {
  const checkoutKeys = req.session ? issueCheckoutKeys(req.session) : {};
  res.render('pricing', { 
    title: 'Pricing - CopyQuick',
    currentPage: 'pricing',
    user: res.locals.user,
    checkoutKeys,
    returnLink: pricingReturn(req.query.returnTo)
  });
});

// Legacy GET links are non-mutating; checkout creation happens only via POST.
router.get('/subscribe', requireAuth, (req, res) => {
  res.redirect('/pricing');
});

router.get('/billing/return', requireAuth, billingActionRateLimit, async (req, res) => {
  const user = res.locals.user;
  const db = req.app.locals.copyquickDb || getDb();
  const result = await inspectBillingCheckoutReturn({
    db,
    user,
    sessionId: req.query.session_id,
    retrieveSession: retrieveCheckoutSession
  });
  req.session.billingReturnNotice = createBillingReturnNotice(result.status);
  if (result.status === 'unavailable') {
    logBillingFailure(req, 'billing_checkout_return_unverified', 'STRIPE_CHECKOUT_RETURN_UNVERIFIED', 303);
  }
  return res.redirect(303, '/dashboard');
});

// POST /subscribe (alternate version if using form)
router.post('/subscribe', requireAuth, billingActionRateLimit, async (req, res) => {
  if (rejectWhenBillingDisabled(res)) return;

  const { price, checkoutKey } = req.body;
  const user = res.locals.user;
  const db = req.app.locals.copyquickDb || getDb();

  const checkoutPolicy = resolveSubscriptionCheckoutPolicy(user, db);
  if (!checkoutPolicy.allowed) {
    return res.redirect(303, '/profile');
  }
  
  let priceId;
  if (price === 'pro' || price === 'pro_price') {
    priceId = process.env.STRIPE_PRO_PRICE;
  } else if (price === 'unlimited' || price === 'unlimited_price') {
    priceId = process.env.STRIPE_UNLIMITED_PRICE;
  }

  if (!priceId) {
    return res.status(400).send('Invalid price selected.');
  }
  if (!validateCheckoutKey(req.session, checkoutKey, price === 'pro_price' ? 'pro' : price === 'unlimited_price' ? 'unlimited' : price)) {
    return res.status(400).send('Invalid checkout request. Please return to pricing and try again.');
  }

  try {
    const planTier = price === 'pro_price' ? 'pro' : price === 'unlimited_price' ? 'unlimited' : price;
    const conflictingIntent = getConflictingSubscriptionCheckoutIntent(db, {
      userId: user.id,
      planTier
    });
    if (conflictingIntent) {
      if (!conflictingIntent.stripeCheckoutSessionId) {
        return res.redirect(303, '/profile?billing=pending');
      }
      const conflictingSession = await retrieveCheckoutSession(conflictingIntent.stripeCheckoutSessionId);
      if (conflictingSession?.id !== conflictingIntent.stripeCheckoutSessionId) {
        logBillingFailure(req, 'billing_checkout_state_unresolved', 'STRIPE_CHECKOUT_STATE_UNKNOWN', 502);
        return res.status(502).send('Billing status could not be verified safely. Please try again later.');
      }
      if (conflictingSession?.status === 'complete') {
        const conflictingSubscriptionId = typeof conflictingSession.subscription === 'string'
          ? conflictingSession.subscription
          : conflictingSession.subscription?.id;
        if (!conflictingSubscriptionId || !canReplaceCompletedCheckoutIntent(db, {
          userId: user.id,
          stripeSubscriptionId: conflictingSubscriptionId
        }) || !clearSubscriptionCheckoutIntentIfMatches(db, {
          userId: user.id,
          planTier: conflictingIntent.planTier,
          idempotencyKey: conflictingIntent.idempotencyKey,
          stripeCheckoutSessionId: conflictingIntent.stripeCheckoutSessionId
        })) {
          return res.redirect(303, '/profile?billing=pending');
        }
      }
      else if (conflictingSession?.status === 'open') {
        const conflictingRedirect = getTrustedStripeRedirect(conflictingSession.url, 'checkout');
        if (!conflictingRedirect) {
          logBillingFailure(req, 'billing_checkout_redirect_failed', 'STRIPE_CHECKOUT_REDIRECT_INVALID', 502);
          return res.status(502).send('Billing provider returned an invalid response. Please try again.');
        }
        return res.redirect(conflictingRedirect);
      }
      else if (conflictingSession?.status !== 'expired' || !clearSubscriptionCheckoutIntentIfMatches(db, {
        userId: user.id,
        planTier: conflictingIntent.planTier,
        idempotencyKey: conflictingIntent.idempotencyKey,
        stripeCheckoutSessionId: conflictingIntent.stripeCheckoutSessionId
      })) {
        logBillingFailure(req, 'billing_checkout_state_unresolved', 'STRIPE_CHECKOUT_STATE_UNKNOWN', 409);
        return res.status(409).send('Billing status could not be verified safely. Please try again later.');
      }
    }
    let checkoutIntent = acquireSubscriptionCheckoutIntent(db, {
      userId: user.id,
      planTier,
      priceId
    });
    if (checkoutIntent.requiresInspection) {
      if (!checkoutIntent.stripeCheckoutSessionId) {
        logBillingFailure(req, 'billing_checkout_state_unresolved', 'STRIPE_CHECKOUT_STATE_UNKNOWN', 409);
        return res.status(409).send('A previous billing request still needs review. Please contact support before trying again.');
      }
      const previousSession = await retrieveCheckoutSession(checkoutIntent.stripeCheckoutSessionId);
      if (previousSession?.status === 'complete') {
        const previousSubscriptionId = typeof previousSession.subscription === 'string'
          ? previousSession.subscription
          : previousSession.subscription?.id;
        if (!canReplaceCompletedCheckoutIntent(db, {
          userId: user.id,
          stripeSubscriptionId: previousSubscriptionId
        })) {
          return res.redirect(303, '/profile?billing=pending');
        }
        checkoutIntent = acquireSubscriptionCheckoutIntent(db, {
          userId: user.id,
          planTier,
          priceId,
          allowExpiredReplacement: true
        });
      }
      else if (previousSession?.status === 'open') {
        const previousRedirect = getTrustedStripeRedirect(previousSession.url, 'checkout');
        if (!previousRedirect) {
          logBillingFailure(req, 'billing_checkout_redirect_failed', 'STRIPE_CHECKOUT_REDIRECT_INVALID', 502);
          return res.status(502).send('Billing provider returned an invalid response. Please try again.');
        }
        return res.redirect(previousRedirect);
      }
      else if (previousSession?.status !== 'expired') {
        logBillingFailure(req, 'billing_checkout_state_unresolved', 'STRIPE_CHECKOUT_STATE_UNKNOWN', 502);
        return res.status(502).send('Billing status could not be verified safely. Please try again later.');
      }
      else {
        checkoutIntent = acquireSubscriptionCheckoutIntent(db, {
          userId: user.id,
          planTier,
          priceId,
          allowExpiredReplacement: true
        });
      }
    }
    const currentCheckoutPolicy = resolveSubscriptionCheckoutPolicy(user, db);
    if (!currentCheckoutPolicy.allowed) {
      return res.redirect(303, '/profile');
    }
    const publicOrigin = getPublicAppOrigin({ req });
    const session = await createCheckoutSession(
      user.email, 
      priceId, 
      `${publicOrigin}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      `${publicOrigin}/pricing`,
      `checkout:${user.id}:${checkoutIntent.idempotencyKey}`,
      user.id,
      Math.floor(checkoutIntent.expiresAt.getTime() / 1000),
      currentCheckoutPolicy.customerId
    );
    const redirectUrl = getTrustedStripeRedirect(session.url, 'checkout');
    if (!redirectUrl || typeof session.id !== 'string') {
      logBillingFailure(req, 'billing_checkout_redirect_failed', 'STRIPE_CHECKOUT_REDIRECT_INVALID', 502);
      return res.status(502).send('Billing provider returned an invalid response. Please try again.');
    }
    recordSubscriptionCheckoutSession(db, {
      userId: user.id,
      planTier,
      idempotencyKey: checkoutIntent.idempotencyKey,
      stripeCheckoutSessionId: session.id
    });
    res.redirect(redirectUrl);
  } catch (err) {
    if (err?.code === 'BILLING_DISABLED') {
      return res.status(503).send('Billing is unavailable in local development until STRIPE_KEY is configured.');
    }
    logBillingFailure(req, 'billing_checkout_failed', 'STRIPE_CHECKOUT_SESSION_FAILED', 500);
    res.status(500).send('Error creating checkout session.');
  }
});

// POST /manage
router.post('/manage', requireAuth, billingActionRateLimit, async (req, res) => {
  if (rejectWhenBillingDisabled(res)) return;

  const user = res.locals.user;
  const db = req.app.locals.copyquickDb || getDb();
  const portalCustomerId = resolveOwnedPortalCustomerId(db, user);
  if (!portalCustomerId) {
    logBillingFailure(req, 'billing_portal_relationship_rejected', 'STRIPE_CUSTOMER_RELATIONSHIP_INVALID', 302);
    return res.redirect('/pricing');
  }

  try {
    const publicOrigin = getPublicAppOrigin({ req });
    const session = await createCustomerPortalSession(
      portalCustomerId,
      `${publicOrigin}/profile`
    );
    const redirectUrl = getTrustedStripeRedirect(session.url, 'portal');
    if (!redirectUrl) {
      logBillingFailure(req, 'billing_portal_redirect_failed', 'STRIPE_PORTAL_REDIRECT_INVALID', 502);
      return res.status(502).send('Billing provider returned an invalid response. Please try again.');
    }
    res.redirect(redirectUrl);
  } catch (err) {
    if (err?.code === 'BILLING_DISABLED') {
      return res.status(503).send('Billing is unavailable in local development until STRIPE_KEY is configured.');
    }
    logBillingFailure(req, 'billing_portal_failed', 'STRIPE_PORTAL_SESSION_FAILED', 500);
    res.status(500).send('Error creating portal session.');
  }
});

module.exports = router;
