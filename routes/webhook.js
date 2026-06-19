const express = require('express');
const router = express.Router();
const { stripe } = require('../lib/stripe');
const { getDb } = require('../db/database');

// Use express.raw() for webhook route to verify signature
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getDb();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerEmail = session.customer_email;
      const stripeCustomerId = session.customer;
      
      // Determine plan from line items or metadata (simplified here)
      // In a real app, you'd map priceId to plan name
      // For this MVP, we'll look at the price in the session
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const priceId = lineItems.data[0].price.id;
      
      let planTier = 'free';
      let monthlyLimit = 10;
      
      if (priceId === process.env.STRIPE_PRO_PRICE) {
        planTier = 'pro';
        monthlyLimit = 200;
      } else if (priceId === process.env.STRIPE_UNLIMITED_PRICE) {
        planTier = 'unlimited';
        monthlyLimit = 999999;
      }

      db.prepare(`
        UPDATE users 
        SET plan_tier = ?, monthly_limit = ?, stripe_customer_id = ? 
        WHERE email = ?
      `).run(planTier, monthlyLimit, stripeCustomerId, customerEmail);
      break;
    }
    
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const stripeCustomerId = subscription.customer;
      
      db.prepare(`
        UPDATE users 
        SET plan_tier = 'free', monthly_limit = 10 
        WHERE stripe_customer_id = ?
      `).run(stripeCustomerId);
      break;
    }

    // Add other cases like customer.subscription.updated if needed
  }

  res.json({ received: true });
});

module.exports = router;
