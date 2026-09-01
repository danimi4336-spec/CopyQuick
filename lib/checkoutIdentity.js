function parseUserReference(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const userId = Number(value);
  return Number.isSafeInteger(userId) ? userId : null;
}

function resolveCheckoutUser(db, checkoutSession) {
  const clientReference = checkoutSession?.client_reference_id;
  const metadataReference = checkoutSession?.metadata?.copyquick_user_id;
  const hasIdentityBinding = clientReference !== undefined || metadataReference !== undefined;

  if (hasIdentityBinding) {
    const clientUserId = parseUserReference(clientReference);
    const metadataUserId = parseUserReference(metadataReference);
    if (!clientUserId || clientUserId !== metadataUserId) {
      return { valid: false, legacy: false, user: null };
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(clientUserId);
    return { valid: Boolean(user), legacy: false, user: user || null };
  }

  const email = typeof checkoutSession?.customer_email === 'string'
    ? checkoutSession.customer_email.trim().toLowerCase()
    : '';
  const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  const sessionId = typeof checkoutSession?.id === 'string' &&
    /^cs_[A-Za-z0-9_]{3,255}$/.test(checkoutSession.id)
    ? checkoutSession.id
    : null;
  const ownedIntent = user && sessionId
    ? db.prepare(`
      SELECT 1 FROM subscription_checkout_intents
      WHERE user_id = ? AND stripe_checkout_session_id = ?
      LIMIT 1
    `).get(user.id, sessionId)
    : null;
  return { valid: Boolean(user && ownedIntent), legacy: true, user: ownedIntent ? user : null };
}

module.exports = { parseUserReference, resolveCheckoutUser };
