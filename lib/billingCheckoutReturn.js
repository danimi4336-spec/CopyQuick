const { resolveCheckoutUser } = require('./checkoutIdentity');

const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{3,255}$/;
const BILLING_RETURN_NOTICES = Object.freeze({
  active: 'Your paid plan is active.',
  processing: 'Payment was received. Your plan is being activated now.',
  incomplete: 'Checkout was not completed. Your current plan has not changed.',
  unavailable: 'Billing confirmation is temporarily unavailable. Your current plan has not changed.'
});

async function inspectBillingCheckoutReturn({ db, user, sessionId, retrieveSession }) {
  if (user?.plan_tier && user.plan_tier !== 'free') return { status: 'active' };
  if (!db || !Number.isSafeInteger(user?.id) || !CHECKOUT_SESSION_ID.test(String(sessionId || ''))) {
    return { status: 'unavailable' };
  }
  const intent = db.prepare(`
    SELECT stripe_checkout_session_id
    FROM subscription_checkout_intents
    WHERE user_id = ? AND stripe_checkout_session_id = ?
    LIMIT 1
  `).get(user.id, sessionId);
  if (!intent) return { status: 'unavailable' };

  try {
    const checkoutSession = await retrieveSession(sessionId);
    if (checkoutSession?.id !== sessionId) return { status: 'unavailable' };
    const identity = resolveCheckoutUser(db, checkoutSession);
    if (!identity.valid || identity.legacy || identity.user?.id !== user.id) {
      return { status: 'unavailable' };
    }
    return { status: checkoutSession.status === 'complete' ? 'processing' : 'incomplete' };
  } catch {
    return { status: 'unavailable' };
  }
}

function createBillingReturnNotice(status) {
  return Object.hasOwn(BILLING_RETURN_NOTICES, status)
    ? { status, message: BILLING_RETURN_NOTICES[status] }
    : null;
}

function consumeBillingReturnNotice(session) {
  const notice = createBillingReturnNotice(session?.billingReturnNotice?.status);
  if (session) delete session.billingReturnNotice;
  return notice;
}

module.exports = {
  BILLING_RETURN_NOTICES,
  consumeBillingReturnNotice,
  createBillingReturnNotice,
  inspectBillingCheckoutReturn
};
