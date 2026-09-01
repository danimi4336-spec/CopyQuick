const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { isBillingEnabled, createCheckoutSession, createCustomerPortalSession } = require('../lib/stripe');
const { getPublicAppOrigin } = require('../lib/publicAppOrigin');
const { issueCheckoutKeys, validateCheckoutKey } = require('../lib/checkoutIdempotency');
const { canStartSubscriptionCheckout } = require('../lib/subscriptionCheckoutPolicy');
const { getTrustedStripeRedirect } = require('../lib/stripeRedirect');
const { writeOperationalEvent } = require('../lib/operationalLogger');

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
    user: res.locals.user,
    checkoutKeys
  });
});

// Legacy GET links are non-mutating; checkout creation happens only via POST.
router.get('/subscribe', requireAuth, (req, res) => {
  res.redirect('/pricing');
});

// POST /subscribe (alternate version if using form)
router.post('/subscribe', requireAuth, async (req, res) => {
  if (rejectWhenBillingDisabled(res)) return;

  const { price, checkoutKey } = req.body;
  const user = res.locals.user;

  if (!canStartSubscriptionCheckout(user)) {
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
    const publicOrigin = getPublicAppOrigin({ req });
    const session = await createCheckoutSession(
      user.email, 
      priceId, 
      `${publicOrigin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      `${publicOrigin}/pricing`,
      `checkout:${user.id}:${checkoutKey}`,
      user.id
    );
    const redirectUrl = getTrustedStripeRedirect(session.url, 'checkout');
    if (!redirectUrl) {
      logBillingFailure(req, 'billing_checkout_redirect_failed', 'STRIPE_CHECKOUT_REDIRECT_INVALID', 502);
      return res.status(502).send('Billing provider returned an invalid response. Please try again.');
    }
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
router.post('/manage', requireAuth, async (req, res) => {
  if (rejectWhenBillingDisabled(res)) return;

  const user = res.locals.user;
  
  if (!user.stripe_customer_id) {
    return res.redirect('/pricing');
  }

  try {
    const publicOrigin = getPublicAppOrigin({ req });
    const session = await createCustomerPortalSession(
      user.stripe_customer_id,
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
