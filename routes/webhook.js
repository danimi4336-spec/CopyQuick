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

function getEventCreated(event) {
  return Number.isFinite(Number(event?.created)) ? Number(event.created) : 0;
}

function claimWebhookEvent(db, event) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type, stripe_created, status)
    VALUES (?, ?, ?, 'processing')
  `).run(event.id, event.type, getEventCreated(event));

  return result.changes === 1;
}

function finishWebhookEvent(db, event, status) {
  db.prepare(`
    UPDATE stripe_webhook_events
    SET status = ?, processed_at = CURRENT_TIMESTAMP
    WHERE event_id = ?
  `).run(status, event.id);
}

function getSubscriptionOrdering(db, stripeSubscriptionId) {
  if (!stripeSubscriptionId) return null;
  return db.prepare(`
    SELECT latest_stripe_event_created, latest_stripe_event_id
    FROM subscriptions
    WHERE stripe_subscription_id = ?
  `).get(stripeSubscriptionId);
}

function isStaleSubscriptionEvent(db, event, stripeSubscriptionId) {
  const existing = getSubscriptionOrdering(db, stripeSubscriptionId);
  if (!existing) return false;

  const eventCreated = getEventCreated(event);
  const latestCreated = Number(existing.latest_stripe_event_created || 0);
  const latestEventId = existing.latest_stripe_event_id || '';

  if (eventCreated < latestCreated) return true;
  if (eventCreated === latestCreated && latestEventId && event.id <= latestEventId) return true;

  return false;
}

function runWebhookTransaction(db, event, processEvent) {
  return db.transaction(() => {
    if (!claimWebhookEvent(db, event)) {
      return { duplicate: true, status: 'duplicate' };
    }

    const result = processEvent();
    finishWebhookEvent(db, event, result.status || 'processed');
    return result;
  })();
}

function syncSubscriptionRecordForEvent(event, params) {
  return syncSubscriptionRecord({
    ...params,
    latestStripeEventCreated: getEventCreated(event),
    latestStripeEventId: event.id
  });
}

function hasProcessedWebhookEvent(db, eventId) {
  return Boolean(db.prepare('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?').get(eventId));
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
  if (hasProcessedWebhookEvent(db, event.id)) {
    return res.json({ received: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_email;
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;

        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const priceId = lineItems.data[0]?.price?.id || null;
        const { planTier, monthlyLimit } = getPlanConfigFromPriceId(priceId);
        let subscription = null;

        if (stripeSubscriptionId) {
          subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        }

        runWebhookTransaction(db, event, () => {
          if (isStaleSubscriptionEvent(db, event, stripeSubscriptionId)) {
            return { status: 'stale' };
          }

          db.prepare(`
            UPDATE users
            SET plan_tier = ?, monthly_limit = ?, stripe_customer_id = ?
            WHERE email = ?
          `).run(planTier, monthlyLimit, stripeCustomerId, customerEmail);

          const user = db.prepare('SELECT * FROM users WHERE email = ?').get(customerEmail);
          if (user && stripeSubscriptionId) {
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
              return { status: 'processed' };
            }

            syncSubscriptionRecordForEvent(event, {
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

          return { status: 'processed' };
        });
        break;
      }

      case 'customer.subscription.updated': {
        const subscriptionEvent = event.data.object;
        const stripeCustomerId = subscriptionEvent.customer;
        const stripeSubscriptionId = subscriptionEvent.id;
        const priceId = subscriptionEvent.items?.data?.[0]?.price?.id || null;
        const { planTier, monthlyLimit } = getPlanConfigFromPriceId(priceId);

        runWebhookTransaction(db, event, () => {
          if (isStaleSubscriptionEvent(db, event, stripeSubscriptionId)) {
            return { status: 'stale' };
          }

          const user = findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId);

          if (!user) {
            console.warn('Subscription update received for unknown user:', stripeSubscriptionId);
            return { status: 'processed' };
          }

          db.prepare(`
            UPDATE users
            SET plan_tier = ?, monthly_limit = ?, stripe_customer_id = ?
            WHERE id = ?
          `).run(planTier, monthlyLimit, stripeCustomerId, user.id);

          const syncIssues = getSubscriptionSyncIssues({
            stripeCustomerId,
            stripeSubscriptionId,
            status: subscriptionEvent.status,
            priceId,
            currentPeriodStart: subscriptionEvent.current_period_start,
            currentPeriodEnd: subscriptionEvent.current_period_end
          });

          if (syncIssues.length > 0) {
            warnSkippedSync('customer.subscription.updated', syncIssues);
            return { status: 'processed' };
          }

          syncSubscriptionRecordForEvent(event, {
            userId: user.id,
            stripeCustomerId,
            stripeSubscriptionId,
            status: subscriptionEvent.status,
            planTier,
            priceId,
            currentPeriodStart: subscriptionEvent.current_period_start,
            currentPeriodEnd: subscriptionEvent.current_period_end,
            cancelAtPeriodEnd: subscriptionEvent.cancel_at_period_end,
            canceledAt: subscriptionEvent.canceled_at,
            endedAt: subscriptionEvent.ended_at,
            monthlyLimit
          });

          return { status: 'processed' };
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const stripeCustomerId = subscription.customer;
        const stripeSubscriptionId = subscription.id;
        const priceId = subscription.items?.data?.[0]?.price?.id || null;
        const { planTier } = getPlanConfigFromPriceId(priceId);

        runWebhookTransaction(db, event, () => {
          if (isStaleSubscriptionEvent(db, event, stripeSubscriptionId)) {
            return { status: 'stale' };
          }

          const user = findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId);

          if (!user) {
            console.warn('Subscription deletion received for unknown user:', stripeSubscriptionId);
            return { status: 'processed' };
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
            syncSubscriptionRecordForEvent(event, {
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

          return { status: 'processed' };
        });
        break;
      }

      default: {
        runWebhookTransaction(db, event, () => ({ status: 'ignored' }));
      }
    }
  } catch (err) {
    console.error('Stripe webhook processing failed:', err);
    return res.status(500).send('Webhook processing failed');
  }

  res.json({ received: true });
});

module.exports = router;
