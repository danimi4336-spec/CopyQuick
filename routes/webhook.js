const express = require('express');
const router = express.Router();
const { stripe } = require('../lib/stripe');
const { getDb } = require('../db/database');
const { getPlanConfigFromPriceId, getSubscriptionSyncIssues, syncSubscriptionRecord } = require('../lib/subscriptions');

function findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId) {
  let user = null;

  if (stripeCustomerId) {
    user = db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(stripeCustomerId);
  }

  if (!user && stripeSubscriptionId) {
    user = db.prepare(`
      SELECT users.*
      FROM users
      JOIN subscriptions ON subscriptions.user_id = users.id
      WHERE subscriptions.stripe_subscription_id = ?
    `).get(stripeSubscriptionId);
  }

  return user;
}

function warnSkippedSync(context, details) {
  console.warn(`Skipping local subscription sync for ${context}: ${details.join(', ')}`);
}

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
      const stripeSubscriptionId = session.subscription;
      
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const priceId = lineItems.data[0]?.price?.id || null;
      const { planTier, monthlyLimit } = getPlanConfigFromPriceId(priceId);

      db.prepare(`
        UPDATE users 
        SET plan_tier = ?, monthly_limit = ?, stripe_customer_id = ? 
        WHERE email = ?
      `).run(planTier, monthlyLimit, stripeCustomerId, customerEmail);

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(customerEmail);
      if (user && stripeSubscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const syncIssues = getSubscriptionSyncIssues({
          stripeCustomerId,
          stripeSubscriptionId,
          status: subscription?.status,
          priceId,
          currentPeriodStart: subscription?.current_period_start,
          currentPeriodEnd: subscription?.current_period_end
        });

        if (syncIssues.length > 0) {
          warnSkippedSync('checkout.session.completed', syncIssues);
          break;
        }

        syncSubscriptionRecord({
          userId: user.id,
          stripeCustomerId,
          stripeSubscriptionId,
          status: subscription.status,
          planTier,
          priceId,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at,
          endedAt: subscription.ended_at,
          monthlyLimit
        });
      } else if (user && !stripeSubscriptionId) {
        warnSkippedSync('checkout.session.completed', ['missing stripe_subscription_id']);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const stripeCustomerId = subscription.customer;
      const stripeSubscriptionId = subscription.id;
      const priceId = subscription.items?.data?.[0]?.price?.id || null;
      const { planTier, monthlyLimit } = getPlanConfigFromPriceId(priceId);
      const user = findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId);

      if (!user) {
        console.warn('Subscription update received for unknown user:', stripeSubscriptionId);
        break;
      }

      db.prepare(`
        UPDATE users
        SET plan_tier = ?, monthly_limit = ?, stripe_customer_id = ?
        WHERE id = ?
      `).run(planTier, monthlyLimit, stripeCustomerId, user.id);

      const syncIssues = getSubscriptionSyncIssues({
        stripeCustomerId,
        stripeSubscriptionId,
        status: subscription.status,
        priceId,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end
      });

      if (syncIssues.length > 0) {
        warnSkippedSync('customer.subscription.updated', syncIssues);
        break;
      }

      syncSubscriptionRecord({
        userId: user.id,
        stripeCustomerId,
        stripeSubscriptionId,
        status: subscription.status,
        planTier,
        priceId,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at,
        endedAt: subscription.ended_at,
        monthlyLimit
      });
      break;
    }
    
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const stripeCustomerId = subscription.customer;
      const stripeSubscriptionId = subscription.id;
      const priceId = subscription.items?.data?.[0]?.price?.id || null;
      const { planTier } = getPlanConfigFromPriceId(priceId);
      const user = findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId);

      if (!user) {
        console.warn('Subscription deletion received for unknown user:', stripeSubscriptionId);
        break;
      }

      const syncIssues = getSubscriptionSyncIssues({
        stripeCustomerId,
        stripeSubscriptionId,
        status: subscription.status || 'canceled',
        priceId,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end
      });

      if (syncIssues.length > 0) {
        warnSkippedSync('customer.subscription.deleted', syncIssues);
      } else {
        syncSubscriptionRecord({
          userId: user.id,
          stripeCustomerId,
          stripeSubscriptionId,
          status: subscription.status || 'canceled',
          planTier,
          priceId,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at,
          endedAt: subscription.ended_at,
          monthlyLimit: getPlanConfigFromPriceId(priceId).monthlyLimit
        });
      }
      
      db.prepare(`
        UPDATE users 
        SET plan_tier = 'free', monthly_limit = 10, stripe_customer_id = ?
        WHERE id = ?
      `).run(stripeCustomerId, user.id);
      break;
    }
  }

  res.json({ received: true });
});

module.exports = router;
