const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { createCheckoutSession, createCustomerPortalSession } = require('../lib/stripe');

router.get('/pricing', (req, res) => {
  res.render('pricing', { 
    title: 'Pricing - CopyQuick',
    user: res.locals.user 
  });
});

// GET /subscribe?price=...
router.get('/subscribe', requireAuth, async (req, res) => {
  const { price } = req.query;
  const user = res.locals.user;
  
  let priceId;
  if (price === 'pro' || price === 'pro_price') {
    priceId = process.env.STRIPE_PRO_PRICE;
  } else if (price === 'unlimited' || price === 'unlimited_price') {
    priceId = process.env.STRIPE_UNLIMITED_PRICE;
  }

  if (!priceId) {
    return res.redirect('/pricing');
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
    console.error(err);
    res.status(500).send('Error creating checkout session.');
  }
});

// POST /subscribe (alternate version if using form)
router.post('/subscribe', requireAuth, async (req, res) => {
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
    console.error(err);
    res.status(500).send('Error creating checkout session.');
  }
});

// POST /manage
router.post('/manage', requireAuth, async (req, res) => {
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
    console.error(err);
    res.status(500).send('Error creating portal session.');
  }
});

module.exports = router;
