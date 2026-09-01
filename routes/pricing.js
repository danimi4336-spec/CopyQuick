const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { isBillingEnabled, createCheckoutSession, createCustomerPortalSession } = require('../lib/stripe');
const { getPublicAppOrigin } = require('../lib/publicAppOrigin');
const { issueCheckoutKeys, validateCheckoutKey } = require('../lib/checkoutIdempotency');
const { canStartSubscriptionCheckout } = require('../lib/subscriptionCheckoutPolicy');

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
    res.redirect(session.url);
  } catch (err) {
    if (err?.code === 'BILLING_DISABLED') {
      return res.status(503).send('Billing is unavailable in local development until STRIPE_KEY is configured.');
    }
    console.error('Checkout session creation failed.');
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
    res.redirect(session.url);
  } catch (err) {
    if (err?.code === 'BILLING_DISABLED') {
      return res.status(503).send('Billing is unavailable in local development until STRIPE_KEY is configured.');
    }
    console.error('Customer portal session creation failed.');
    res.status(500).send('Error creating portal session.');
  }
});

module.exports = router;
