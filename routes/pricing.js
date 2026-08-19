const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { isBillingEnabled, createCheckoutSession, createCustomerPortalSession } = require('../lib/stripe');

function rejectWhenBillingDisabled(res) {
  if (isBillingEnabled !== false) return false;
  res.status(503).send('Billing is unavailable in local development until STRIPE_KEY is configured.');
  return true;
}

router.get('/pricing', (req, res) => {
  res.render('pricing', { 
    title: 'Pricing - CopyQuick',
    user: res.locals.user 
  });
});

// Legacy GET links are non-mutating; checkout creation happens only via POST.
router.get('/subscribe', requireAuth, (req, res) => {
  res.redirect('/pricing');
});

// POST /subscribe (alternate version if using form)
router.post('/subscribe', requireAuth, async (req, res) => {
  if (rejectWhenBillingDisabled(res)) return;

  const { price } = req.body;
  const user = res.locals.user;
  
  let priceId;
  if (price === 'pro' || price === 'pro_price') {
    priceId = process.env.STRIPE_PRO_PRICE;
  } else if (price === 'unlimited' || price === 'unlimited_price') {
    priceId = process.env.STRIPE_UNLIMITED_PRICE;
  }

  if (!priceId) {
    return res.status(400).send('Invalid price selected.');
  }

  try {
    const session = await createCheckoutSession(
      user.email, 
      priceId, 
      `${req.protocol}://${req.get('host')}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      `${req.protocol}://${req.get('host')}/pricing`
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
    const session = await createCustomerPortalSession(
      user.stripe_customer_id,
      `${req.protocol}://${req.get('host')}/profile`
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
