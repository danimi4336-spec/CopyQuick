const express = require('express');
const router = express.Router();
const { stripe, isBillingEnabled } = require('../lib/stripe');
const { getDb } = require('../db/database');
const { syncSubscriptionRecord } = require('../lib/subscriptions');
const { BillingPolicyError, evaluateStripeEntitlement } = require('../lib/billingEntitlement');
const { resolveCheckoutUser } = require('../lib/checkoutIdentity');
const { clearSubscriptionCheckoutIntents } = require('../lib/subscriptionCheckoutIntent');
const { STRIPE_WEBHOOK_BODY_LIMIT } = require('../lib/requestBodyLimits');
const { writeOperationalEvent } = require('../lib/operationalLogger');
const { isStripeCustomerExclusivelyOwned } = require('../lib/billingCustomerOwnership');

const MAX_SIBLING_SUBSCRIPTIONS = 5;

function logWebhookEvent(event, code, statusCode, operation) {
  const normalizedOperation = typeof operation === 'string' ? operation.replaceAll('.', '_') : 'unknown';
  writeOperationalEvent({ event, code, statusCode, operation: normalizedOperation });
}

function findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId) {
  if (stripeSubscriptionId) {
    const boundUser = db.prepare(`
      SELECT users.*
      FROM users
      JOIN subscriptions ON subscriptions.user_id = users.id
      WHERE subscriptions.stripe_subscription_id = ?
    `).get(stripeSubscriptionId);
    if (boundUser) return boundUser;
  }
  if (!stripeCustomerId) return null;
  const customerUsers = db.prepare(`
    SELECT * FROM users WHERE stripe_customer_id = ? ORDER BY id LIMIT 2
  `).all(stripeCustomerId);
  return customerUsers.length === 1 ? customerUsers[0] : null;
}

function getEventCreated(event) {
  const created = event?.created;
  return Number.isInteger(created) && created >= 0 ? created : null;
}

function requireEventCreated(event) {
  const created = getEventCreated(event);
  if (created === null) {
    throw new Error(`Invalid Stripe event.created for ${event?.type || 'unknown event'}`);
  }
  return created;
}

function claimWebhookEvent(db, event) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type, stripe_created, status)
    VALUES (?, ?, ?, 'processing')
  `).run(event.id, event.type, getEventCreated(event) || 0);

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

  const eventCreated = requireEventCreated(event);
  const latestCreated = Number(existing.latest_stripe_event_created || 0);

  if (eventCreated < latestCreated) return true;

  return false;
}

function isEqualTimestampSubscriptionEvent(db, event, stripeSubscriptionId) {
  const existing = getSubscriptionOrdering(db, stripeSubscriptionId);
  if (!existing) return false;

  return requireEventCreated(event) === Number(existing.latest_stripe_event_created || 0);
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

function syncSubscriptionRecordForEvent(db, event, params) {
  return syncSubscriptionRecord({
    db,
    ...params,
    latestStripeEventCreated: requireEventCreated(event),
    latestStripeEventId: event.id
  });
}

function hasProcessedWebhookEvent(db, eventId) {
  return Boolean(db.prepare('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?').get(eventId));
}

function isMissingStripeSubscriptionError(err) {
  return err?.statusCode === 404 || err?.code === 'resource_missing';
}

async function retrieveCurrentSubscriptionState(stripeSubscriptionId) {
  try {
    return {
      found: true,
      subscription: await stripe.subscriptions.retrieve(stripeSubscriptionId)
    };
  } catch (err) {
    if (isMissingStripeSubscriptionError(err)) {
      return { found: false, subscription: null };
    }
    throw err;
  }
}

function subscriptionMayRemoveEntitlement(subscription) {
  return !['active', 'trialing'].includes(subscription?.status);
}

async function retrieveAuthoritativeSiblingEntitlement(db, user, excludedSubscriptionId) {
  if (!user) return null;
  const siblings = db.prepare(`
    SELECT stripe_subscription_id, past_due_since
    FROM subscriptions
    WHERE user_id = ? AND stripe_subscription_id != ?
    ORDER BY id DESC
    LIMIT ?
  `).all(user.id, excludedSubscriptionId, MAX_SIBLING_SUBSCRIPTIONS + 1);
  if (siblings.length > MAX_SIBLING_SUBSCRIPTIONS) {
    throw new Error('Subscription relationship bound exceeded.');
  }
  const states = await Promise.all(siblings.map(sibling =>
    retrieveCurrentSubscriptionState(sibling.stripe_subscription_id)
  ));
  let strongest = null;
  for (let index = 0; index < siblings.length; index += 1) {
    const sibling = siblings[index];
    const state = states[index];
    if (!state.found) continue;
    const decision = evaluateStripeEntitlement(state.subscription, {
      expectedCustomerId: user.stripe_customer_id || undefined,
      expectedSubscriptionId: sibling.stripe_subscription_id,
      pastDueSince: sibling.past_due_since
    });
    if (decision.entitled && (!strongest || decision.monthlyLimit > strongest.monthlyLimit)) {
      strongest = decision;
    }
  }
  return strongest;
}

function shouldDowngradeForSubscriptionState(subscriptionState) {
  return !subscriptionState?.found || subscriptionState.subscription?.status === 'canceled';
}

function existingPastDueSince(db, subscriptionId, status, event) {
  if (status !== 'past_due') return null;
  const existing = db.prepare(`
    SELECT status, past_due_since FROM subscriptions WHERE stripe_subscription_id = ?
  `).get(subscriptionId);
  if (existing?.status === 'past_due' && existing.past_due_since) return existing.past_due_since;
  const previousStatus = event?.data?.previous_attributes?.status;
  if (typeof previousStatus === 'string' && previousStatus !== 'past_due') {
    return new Date(requireEventCreated(event) * 1000).toISOString();
  }
  return null;
}

function applyValidatedSubscription(db, event, user, subscription, entitlementOverride = null) {
  const pastDueSince = existingPastDueSince(db, subscription?.id, subscription?.status, event);
  const decision = evaluateStripeEntitlement(subscription, {
    expectedCustomerId: user.stripe_customer_id || undefined,
    expectedSubscriptionId: subscription?.id,
    pastDueSince
  });
  if (!isStripeCustomerExclusivelyOwned(db, { userId: user.id, customerId: decision.customerId })) {
    throw new BillingPolicyError('CUSTOMER_SUBSCRIPTION_MISMATCH');
  }
  if (decision.issueCode) {
    logWebhookEvent('stripe_subscription_sync_issue', decision.issueCode, 422, 'subscription_sync');
  }
  syncSubscriptionRecordForEvent(db, event, {
    userId: user.id,
    stripeCustomerId: decision.customerId,
    stripeSubscriptionId: decision.id,
    status: decision.status,
    planTier: decision.plan.planTier,
    priceId: decision.priceId,
    currentPeriodStart: decision.currentPeriodStart,
    currentPeriodEnd: decision.currentPeriodEnd,
    cancelAtPeriodEnd: decision.cancelAtPeriodEnd,
    canceledAt: decision.canceledAt,
    endedAt: decision.endedAt,
    monthlyLimit: decision.plan.monthlyLimit,
    pastDueSince: decision.pastDueSince
  });
  const effectiveDecision = entitlementOverride?.entitled ? entitlementOverride : decision;
  if (entitlementOverride?.entitled && !decision.entitled) {
    logWebhookEvent('stripe_sibling_entitlement_preserved', 'AUTHORITATIVE_SIBLING_ENTITLED', 200, 'subscription_sync');
  }
  db.prepare(`
    UPDATE users SET plan_tier = ?, monthly_limit = ?, stripe_customer_id = ? WHERE id = ?
  `).run(effectiveDecision.planTier, effectiveDecision.monthlyLimit, effectiveDecision.customerId, user.id);
  clearSubscriptionCheckoutIntents(db, { userId: user.id });
  return decision;
}

function downgradeUserForSubscription(db, user, stripeCustomerId) {
  db.prepare(`
    UPDATE users
    SET plan_tier = 'free', monthly_limit = 10, stripe_customer_id = ?
    WHERE id = ?
  `).run(stripeCustomerId, user.id);
  clearSubscriptionCheckoutIntents(db, { userId: user.id });
}

function applyAuthoritativeSubscriptionState(db, event, {
  subscriptionState,
  stripeCustomerId,
  stripeSubscriptionId,
  context,
  siblingEntitlement = null
}) {
  const currentSubscription = subscriptionState?.subscription || null;
  const effectiveCustomerId = currentSubscription?.customer || stripeCustomerId;
  const user = findUserForSubscription(db, effectiveCustomerId, stripeSubscriptionId);

  if (!user) {
    logWebhookEvent('stripe_webhook_user_unresolved', 'LOCAL_SUBSCRIPTION_MISSING', 200, context);
    return;
  }

  if (currentSubscription && currentSubscription.status === 'canceled') {
    applyValidatedSubscription(db, event, user, currentSubscription, siblingEntitlement);
    return;
  }

  if (shouldDowngradeForSubscriptionState(subscriptionState)) {
    if (siblingEntitlement?.entitled) {
      db.prepare(`UPDATE users SET plan_tier = ?, monthly_limit = ?, stripe_customer_id = ? WHERE id = ?`)
        .run(siblingEntitlement.planTier, siblingEntitlement.monthlyLimit, siblingEntitlement.customerId, user.id);
      return;
    }
    downgradeUserForSubscription(db, user, effectiveCustomerId);
    return;
  }

  applyValidatedSubscription(db, event, user, currentSubscription, siblingEntitlement);
}

function safelyApplySubscription(db, event, user, subscription, entitlementOverride = null) {
  try {
    applyValidatedSubscription(db, event, user, subscription, entitlementOverride);
    return { status: 'processed' };
  } catch (error) {
    if (!(error instanceof BillingPolicyError)) throw error;
    logWebhookEvent('stripe_subscription_sync_rejected', error.code, 422, 'subscription_sync');
    return { status: 'invalid' };
  }
}

// Use express.raw() for webhook route to verify signature
router.post('/stripe/webhook', express.raw({
  type: 'application/json',
  limit: STRIPE_WEBHOOK_BODY_LIMIT
}), async (req, res) => {
  // Undefined preserves compatibility with injected Stripe test implementations.
  if (isBillingEnabled === false) {
    return res.status(503).send('Stripe billing is disabled until STRIPE_KEY is configured.');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logWebhookEvent('stripe_webhook_signature_rejected', 'STRIPE_SIGNATURE_INVALID', 400, 'signature_verification');
    return res.status(400).send('Webhook signature verification failed');
  }

  const db = getDb();
  if (hasProcessedWebhookEvent(db, event.id)) {
    return res.json({ received: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        requireEventCreated(event);
        const session = event.data.object;
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;

        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const priceId = lineItems.data[0]?.price?.id || null;
        let subscription = null;

        if (stripeSubscriptionId) {
          subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        }

        runWebhookTransaction(db, event, () => {
          if (isStaleSubscriptionEvent(db, event, stripeSubscriptionId)) {
            return { status: 'stale' };
          }

          const checkoutIdentity = resolveCheckoutUser(db, session);
          if (checkoutIdentity.legacy && checkoutIdentity.valid) {
            writeOperationalEvent({ event: 'stripe_checkout_legacy_identity', outcome: 'accepted' });
          }
          const user = checkoutIdentity.user;
          if (!checkoutIdentity.valid || !user || !stripeSubscriptionId || !subscription || subscription.customer !== stripeCustomerId ||
              subscription.items?.data?.[0]?.price?.id !== priceId) {
            logWebhookEvent('stripe_subscription_sync_rejected', 'STRIPE_RECORD_INCOMPLETE', 422, 'checkout_sync');
            return { status: 'invalid' };
          }
          return safelyApplySubscription(db, event, user, subscription);
        });
        break;
      }

      case 'customer.subscription.updated': {
        requireEventCreated(event);
        const subscriptionEvent = event.data.object;
        const stripeCustomerId = subscriptionEvent.customer;
        const stripeSubscriptionId = subscriptionEvent.id;
        const isEqualTimestamp = isEqualTimestampSubscriptionEvent(db, event, stripeSubscriptionId);
        const currentSubscriptionState = isEqualTimestamp
          ? await retrieveCurrentSubscriptionState(stripeSubscriptionId)
          : null;
        const eventUser = findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId);
        const effectiveSubscription = isEqualTimestamp
          ? currentSubscriptionState?.subscription
          : subscriptionEvent;
        const siblingEntitlement = eventUser && !isStaleSubscriptionEvent(db, event, stripeSubscriptionId) &&
          subscriptionMayRemoveEntitlement(effectiveSubscription)
          ? await retrieveAuthoritativeSiblingEntitlement(db, eventUser, stripeSubscriptionId)
          : null;

        runWebhookTransaction(db, event, () => {
          if (isStaleSubscriptionEvent(db, event, stripeSubscriptionId)) {
            return { status: 'stale' };
          }

          if (isEqualTimestampSubscriptionEvent(db, event, stripeSubscriptionId)) {
            if (!currentSubscriptionState) {
              throw new Error('Missing authoritative Stripe subscription state for equal-timestamp event');
            }

            applyAuthoritativeSubscriptionState(db, event, {
              subscriptionState: currentSubscriptionState,
              stripeCustomerId,
              stripeSubscriptionId,
              context: 'customer.subscription.updated',
              siblingEntitlement
            });
            return { status: 'processed' };
          }

          const user = findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId);

          if (!user) {
            logWebhookEvent('stripe_webhook_user_unresolved', 'LOCAL_SUBSCRIPTION_MISSING', 200, event.type);
            return { status: 'processed' };
          }

          return safelyApplySubscription(db, event, user, subscriptionEvent, siblingEntitlement);
        });
        break;
      }

      case 'customer.subscription.deleted': {
        requireEventCreated(event);
        const subscription = event.data.object;
        const stripeCustomerId = subscription.customer;
        const stripeSubscriptionId = subscription.id;
        const isEqualTimestamp = isEqualTimestampSubscriptionEvent(db, event, stripeSubscriptionId);
        const currentSubscriptionState = isEqualTimestamp
          ? await retrieveCurrentSubscriptionState(stripeSubscriptionId)
          : null;
        const eventUser = findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId);
        const effectiveSubscription = isEqualTimestamp
          ? currentSubscriptionState?.subscription
          : subscription;
        const siblingEntitlement = eventUser && !isStaleSubscriptionEvent(db, event, stripeSubscriptionId) &&
          subscriptionMayRemoveEntitlement(effectiveSubscription)
          ? await retrieveAuthoritativeSiblingEntitlement(db, eventUser, stripeSubscriptionId)
          : null;

        runWebhookTransaction(db, event, () => {
          if (isStaleSubscriptionEvent(db, event, stripeSubscriptionId)) {
            return { status: 'stale' };
          }

          if (isEqualTimestampSubscriptionEvent(db, event, stripeSubscriptionId)) {
            if (!currentSubscriptionState) {
              throw new Error('Missing authoritative Stripe subscription state for equal-timestamp event');
            }

            applyAuthoritativeSubscriptionState(db, event, {
              subscriptionState: currentSubscriptionState,
              stripeCustomerId,
              stripeSubscriptionId,
              context: 'customer.subscription.deleted',
              siblingEntitlement
            });
            return { status: 'processed' };
          }

          const user = findUserForSubscription(db, stripeCustomerId, stripeSubscriptionId);

          if (!user) {
            logWebhookEvent('stripe_webhook_user_unresolved', 'LOCAL_SUBSCRIPTION_MISSING', 200, event.type);
            return { status: 'processed' };
          }

          return safelyApplySubscription(db, event, user, {
            ...subscription,
            status: subscription.status || 'canceled'
          }, siblingEntitlement);
        });
        break;
      }

      default: {
        runWebhookTransaction(db, event, () => ({ status: 'ignored' }));
      }
    }
  } catch (err) {
    logWebhookEvent('stripe_webhook_processing_failed', 'STRIPE_WEBHOOK_PROCESSING_FAILED', 500, event?.type || 'unknown');
    return res.status(500).send('Webhook processing failed');
  }

  res.json({ received: true });
});

module.exports = router;
