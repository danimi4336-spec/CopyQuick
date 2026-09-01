const crypto = require('crypto');
const KEY_TTL_MS = 60 * 60 * 1000;
const MAX_KEYS = 10;

function issueCheckoutKeys(session, options = {}) {
  const now = options.now || Date.now();
  const uuid = options.randomUUID || crypto.randomUUID;
  const existing = Array.isArray(session.checkoutKeys) ? session.checkoutKeys : [];
  const active = existing.filter(item => item.createdAt > now - KEY_TTL_MS).slice(-(MAX_KEYS - 2));
  const keys = { pro: uuid(), unlimited: uuid() };
  session.checkoutKeys = active.concat([
    { key: keys.pro, price: 'pro', createdAt: now },
    { key: keys.unlimited, price: 'unlimited', createdAt: now }
  ]);
  return keys;
}

function validateCheckoutKey(session, key, price, options = {}) {
  const now = options.now || Date.now();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(key || ''))) return false;
  return (session.checkoutKeys || []).some(item => item.key === key && item.price === price && item.createdAt > now - KEY_TTL_MS);
}

module.exports = { KEY_TTL_MS, MAX_KEYS, issueCheckoutKeys, validateCheckoutKey };
